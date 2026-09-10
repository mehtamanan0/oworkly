// Media upload/download for VIDEO / AUDIO / IMAGE question responses.
// Flow: client asks for an upload ticket -> PUTs the file straight to the
// bucket (or, with the local driver, back to this API) -> confirms -> the
// evidence_file row flips to `ready` and can be attached to a
// question_response. Downloads are short-lived presigned GETs.
//
// Two routers are exported:
//   * mediaRouter — the real API surface, mounted behind `authenticate`.
//   * mediaLocalRouter — the dev/CI `local` driver's stand-in "bucket"
//     (PUT/GET of raw bytes). Mounted UNauthenticated because a raw
//     <img>/<video> src or a presigned-style PUT carries no bearer token; it
//     404s whenever a real S3/R2 driver is configured.
import { Router, raw } from "express";
import { pool, queryOne } from "../db.js";
import { asyncHandler, ApiError } from "../lib/asyncHandler.js";
import { recordAudit } from "../infrastructure/database/audit.js";
import { config } from "../config/index.js";
import {
  presignUpload, presignDownload, buildStorageKey,
  localDriverActive, localWrite, localRead,
} from "../infrastructure/storage/objectStore.js";

export const mediaRouter = Router();
export const mediaLocalRouter = Router();

// kind -> (evidence_file.file_type, allowed mime prefix)
const KIND = {
  image: { fileType: "photo", mime: "image/" },
  video: { fileType: "video", mime: "video/" },
  audio: { fileType: "audio", mime: "audio/" },
} as const;
type Kind = keyof typeof KIND;

function scopedCompanyId(req: any): string {
  const cid = req.currentUser?.companyId;
  if (!cid) throw new ApiError(400, "A company-scoped user is required to upload media");
  return cid;
}

async function loadFileScoped(req: any, id: string) {
  const row = await queryOne<any>(`SELECT * FROM evidence_file WHERE evidence_file_id = $1`, [id]);
  if (!row) throw new ApiError(404, "Evidence file not found");
  if (req.currentUser?.companyId && row.company_id && req.currentUser.companyId !== row.company_id) {
    throw new ApiError(403, "Cross-company access is not permitted");
  }
  return row;
}

mediaRouter.post(
  "/media/uploads",
  asyncHandler(async (req, res) => {
    const companyId = scopedCompanyId(req);
    const kind = String(req.body?.kind ?? "").toLowerCase() as Kind;
    if (!KIND[kind]) throw new ApiError(422, "kind must be one of image, video, audio");
    const contentType = String(req.body?.contentType ?? "");
    if (!contentType.startsWith(KIND[kind].mime)) throw new ApiError(422, `contentType must be a ${kind} type`);
    const sizeBytes = Number(req.body?.sizeBytes ?? 0);
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) throw new ApiError(422, "sizeBytes must be a positive number");
    if (sizeBytes > config.MAX_UPLOAD_BYTES) throw new ApiError(413, `File exceeds the ${config.MAX_UPLOAD_BYTES}-byte limit`);

    const ext = contentType.split("/")[1] ?? "bin";
    const storageKey = buildStorageKey(companyId, kind, ext);
    const row = await queryOne<any>(
      `INSERT INTO evidence_file (storage_key, file_type, mime_type, file_size_bytes, company_id, uploaded_by, status, original_filename)
       VALUES ($1,$2,$3,$4,$5,$6,'pending',$7) RETURNING evidence_file_id, storage_key`,
      [storageKey, KIND[kind].fileType, contentType, sizeBytes, companyId, req.currentUser?.userId ?? null, req.body?.filename ?? null]
    );
    const upload = await presignUpload(storageKey, contentType, config.MAX_UPLOAD_BYTES);
    await recordAudit(pool, {
      entityName: "evidence_file", entityId: row.evidence_file_id, action: "INSERT",
      actorUserId: req.currentUser?.userId ?? null, after: { storageKey, kind, sizeBytes, status: "pending" },
    });
    res.status(201).json({ evidenceFileId: row.evidence_file_id, uploadUrl: upload.url, uploadMethod: upload.method, uploadHeaders: upload.headers });
  })
);

mediaRouter.post(
  "/media/uploads/:id/confirm",
  asyncHandler(async (req, res) => {
    const row = await loadFileScoped(req, req.params.id);
    if (row.status === "ready") return res.json({ evidenceFileId: row.evidence_file_id, status: "ready" });
    const sha256 = req.body?.sha256 ? String(req.body.sha256) : null;
    if (sha256 && !/^[0-9a-f]{64}$/i.test(sha256)) throw new ApiError(422, "sha256 must be a 64-char hex digest");
    const sizeBytes = req.body?.sizeBytes != null ? Number(req.body.sizeBytes) : null;
    const updated = await queryOne<any>(
      `UPDATE evidence_file SET status = 'ready', sha256_checksum = COALESCE($2, sha256_checksum),
         file_size_bytes = COALESCE($3, file_size_bytes), captured_at = now()
       WHERE evidence_file_id = $1 RETURNING evidence_file_id, status`,
      [row.evidence_file_id, sha256, sizeBytes]
    );
    res.json({ evidenceFileId: updated.evidence_file_id, status: updated.status });
  })
);

mediaRouter.get(
  "/media/:id/url",
  asyncHandler(async (req, res) => {
    const row = await loadFileScoped(req, req.params.id);
    if (row.status !== "ready") throw new ApiError(409, "This file has not finished uploading");
    res.json({ url: await presignDownload(row.storage_key, 300), mimeType: row.mime_type, fileType: row.file_type });
  })
);

// ---- local driver only (unauthenticated) ----
mediaLocalRouter.put(
  "/media/local/:key",
  raw({ type: () => true, limit: config.MAX_UPLOAD_BYTES }),
  asyncHandler(async (req, res) => {
    if (!localDriverActive()) throw new ApiError(404, "Not found");
    const key = decodeURIComponent(req.params.key);
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length === 0) throw new ApiError(422, "Empty upload body");
    await localWrite(key, body);
    res.status(200).json({ status: "stored", bytes: body.length });
  })
);

mediaLocalRouter.get(
  "/media/local/:key",
  asyncHandler(async (req, res) => {
    if (!localDriverActive()) throw new ApiError(404, "Not found");
    const key = decodeURIComponent(req.params.key);
    const meta = await queryOne<any>(`SELECT mime_type FROM evidence_file WHERE storage_key = $1`, [key]);
    try {
      const buf = await localRead(key);
      if (meta?.mime_type) res.type(meta.mime_type);
      res.send(buf);
    } catch {
      throw new ApiError(404, "Object not found");
    }
  })
);
