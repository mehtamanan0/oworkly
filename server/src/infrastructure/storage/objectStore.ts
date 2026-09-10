// Thin object-storage seam. Two drivers:
//   * s3 / minio — any S3-compatible bucket (Cloudflare R2 uses this: set
//     STORAGE_DRIVER=s3, STORAGE_ENDPOINT=https://<acct>.r2.cloudflarestorage.com,
//     STORAGE_REGION=auto). Uploads/downloads go straight from the browser to
//     the bucket via short-lived presigned URLs; the API never proxies bytes.
//   * local — dev/CI only. "Presigned" URLs point back at this API's own
//     /media/local/:key routes (see routes/media.ts), which read/write under
//     STORAGE_LOCAL_DIR. Not persistent on Render's ephemeral disk — documented
//     as such; real deployments set the R2 vars.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { config } from "../../config/index.js";

export interface PresignedUpload {
  url: string;
  method: "PUT";
  headers: Record<string, string>;
}

const isS3 = config.STORAGE_DRIVER === "s3" || config.STORAGE_DRIVER === "minio";

// The S3 client + presigner are only imported when actually needed, so the
// local/CI path has no hard dependency on the aws-sdk being wired up.
async function s3Client() {
  const { S3Client } = await import("@aws-sdk/client-s3");
  return new S3Client({
    region: config.STORAGE_REGION,
    endpoint: config.STORAGE_ENDPOINT,
    forcePathStyle: true,
    credentials: { accessKeyId: config.STORAGE_ACCESS_KEY, secretAccessKey: config.STORAGE_SECRET_KEY },
  });
}

export function buildStorageKey(companyId: string, kind: string, ext: string) {
  const safeExt = ext.replace(/[^a-z0-9]/gi, "").slice(0, 8) || "bin";
  return `${companyId}/${kind}/${Date.now()}-${createHash("sha1").update(`${Math.random()}`).digest("hex").slice(0, 12)}.${safeExt}`;
}

export async function presignUpload(key: string, contentType: string, _maxBytes: number): Promise<PresignedUpload> {
  if (isS3) {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    const url = await getSignedUrl(
      await s3Client(),
      new PutObjectCommand({ Bucket: config.STORAGE_BUCKET, Key: key, ContentType: contentType }),
      { expiresIn: 900 }
    );
    return { url, method: "PUT", headers: { "Content-Type": contentType } };
  }
  return { url: `/api/v1/v2/media/local/${encodeURIComponent(key)}`, method: "PUT", headers: { "Content-Type": contentType } };
}

export async function presignDownload(key: string, ttlSec = 300): Promise<string> {
  if (isS3) {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    return getSignedUrl(await s3Client(), new GetObjectCommand({ Bucket: config.STORAGE_BUCKET, Key: key }), { expiresIn: ttlSec });
  }
  return `/api/v1/v2/media/local/${encodeURIComponent(key)}`;
}

export async function deleteObject(key: string): Promise<void> {
  if (isS3) {
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    await (await s3Client()).send(new DeleteObjectCommand({ Bucket: config.STORAGE_BUCKET, Key: key }));
    return;
  }
  await unlink(localPath(key)).catch(() => undefined);
}

// ---- local driver filesystem helpers (used by routes/media.ts) ------------
export function localDriverActive() {
  return !isS3;
}

export function localPath(key: string) {
  // Contain every path inside STORAGE_LOCAL_DIR — a key can never escape it.
  const root = resolve(config.STORAGE_LOCAL_DIR);
  const full = resolve(join(root, key));
  if (full !== root && !full.startsWith(root + "/")) throw new Error("invalid storage key");
  return full;
}

export async function localWrite(key: string, body: Buffer) {
  const path = localPath(key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body);
}

export async function localRead(key: string): Promise<Buffer> {
  return readFile(localPath(key));
}
