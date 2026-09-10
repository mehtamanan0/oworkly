import { useEffect, type ReactNode } from "react";
import { Button } from "./Button";

// Minimal centered modal — backdrop click + Esc close, a header, a scrollable
// body and an optional footer. No portal library: it renders a fixed overlay.
export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-10"
      onClick={onClose}
    >
      <div
        className={`w-full ${wide ? "max-w-2xl" : "max-w-md"} rounded-fig-card border border-fig-border bg-white shadow-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-fig-border px-5 py-3.5">
          <div className="text-sm font-semibold text-fig-text">{title}</div>
          <button onClick={onClose} className="text-fig-muted hover:text-fig-text" aria-label="Close">
            ✕
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-fig-border px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function ModalActions({ onCancel, onSave, saving, saveLabel = "Save", disabled }: { onCancel: () => void; onSave: () => void; saving?: boolean; saveLabel?: string; disabled?: boolean }) {
  return (
    <>
      <Button variant="secondary" onClick={onCancel}>Cancel</Button>
      <Button onClick={onSave} disabled={saving || disabled}>{saving ? "Saving…" : saveLabel}</Button>
    </>
  );
}

// Small labelled field wrappers used by the authoring forms.
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-xs font-medium text-fig-muted">{label}</span>
      {children}
    </label>
  );
}

export const inputClass = "w-full rounded-lg border border-fig-border px-3 py-2 text-sm focus:border-fig-blue focus:outline-none";
