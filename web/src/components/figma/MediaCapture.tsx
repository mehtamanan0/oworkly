import { useEffect, useRef, useState } from "react";
import { media, type MediaKind } from "../../lib/apiV2";

const ACCEPT: Record<MediaKind, string> = { image: "image/*", video: "video/*", audio: "audio/*" };
const LABEL: Record<MediaKind, string> = { image: "Capture / upload photo", video: "Record / upload video", audio: "Record / upload audio" };

// Capture (or pick) one media artifact for a VIDEO / AUDIO / IMAGE question.
// Uploads straight to the object store via a presigned URL, then hands the
// resulting evidence_file id up via onChange.
export function MediaCapture({
  kind,
  value,
  onChange,
  disabled,
}: {
  kind: MediaKind;
  value: string | null;
  onChange: (evidenceFileId: string | null) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"idle" | "uploading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [localObjectUrl, setLocalObjectUrl] = useState<string | null>(null);

  // When a value comes in without a fresh local file (re-opened response),
  // resolve a viewable URL from the API.
  useEffect(() => {
    let cancelled = false;
    if (value && !localObjectUrl) {
      media
        .meta(value)
        .then((m) => {
          if (cancelled) return;
          // relative (local driver) URLs are same-origin; absolute (R2) used as-is
          setPreviewUrl(m.url);
        })
        .catch(() => undefined);
    }
    if (!value) setPreviewUrl(null);
    return () => {
      cancelled = true;
    };
  }, [value, localObjectUrl]);

  useEffect(() => () => {
    if (localObjectUrl) URL.revokeObjectURL(localObjectUrl);
  }, [localObjectUrl]);

  async function handleFile(file: File) {
    setState("uploading");
    setError(null);
    const obj = URL.createObjectURL(file);
    setLocalObjectUrl(obj);
    setPreviewUrl(obj);
    try {
      const id = await media.upload(file, kind);
      onChange(id);
      setState("idle");
    } catch (e) {
      setState("error");
      setError((e as Error).message);
      onChange(null);
    }
  }

  const shownUrl = previewUrl;

  return (
    <div className="rounded-lg border border-dashed border-fig-border p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-fig-muted">{kind}</span>
        {value && state === "idle" && <span className="text-[11px] font-semibold text-fig-green">✓ attached</span>}
        {state === "uploading" && <span className="text-[11px] text-fig-muted">uploading…</span>}
      </div>

      {shownUrl && (
        <div className="mt-2">
          {kind === "image" && <img src={shownUrl} alt="captured" className="max-h-48 rounded" />}
          {kind === "video" && <video src={shownUrl} controls className="max-h-48 w-full rounded" />}
          {kind === "audio" && <audio src={shownUrl} controls className="w-full" />}
        </div>
      )}

      <div className="mt-2 flex items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT[kind]}
          capture={kind === "image" ? "environment" : undefined}
          disabled={disabled || state === "uploading"}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
          }}
        />
        <button
          type="button"
          disabled={disabled || state === "uploading"}
          onClick={() => inputRef.current?.click()}
          className="rounded bg-white px-2.5 py-1 text-xs font-semibold text-fig-blue ring-1 ring-fig-border hover:bg-fig-bg disabled:opacity-50"
        >
          {value ? "Replace" : LABEL[kind]}
        </button>
        {value && (
          <button
            type="button"
            disabled={disabled || state === "uploading"}
            onClick={() => {
              onChange(null);
              setLocalObjectUrl(null);
              setPreviewUrl(null);
            }}
            className="text-xs font-semibold text-fig-red hover:underline"
          >
            Remove
          </button>
        )}
      </div>
      {error && <div className="mt-1 text-[11px] text-fig-red">{error}</div>}
    </div>
  );
}
