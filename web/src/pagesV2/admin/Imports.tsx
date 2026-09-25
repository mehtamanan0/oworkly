import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { AppShell } from "../../shell/AppShell";
import { PageHeader } from "../../shell/PageHeader";
import { SectionCard } from "../../components/figma/SectionCard";
import { Button } from "../../components/figma/Button";
import { Forbidden } from "../../components/figma/Forbidden";
import { Modal, ModalActions } from "../../components/figma/Modal";
import { v2, uploadImportFile, ApiV2Error } from "../../lib/apiV2";
import { useAuthV2 } from "../../lib/AuthV2Context";

type ImportKind = "organisation" | "workers";
interface Company { company_id: string; code: string; name: string }
interface Batch {
  import_batch_id: string;
  import_type: "ORGANISATION" | "WORKER";
  status: "UPLOADED" | "VALIDATING" | "VALID" | "INVALID" | "PUBLISHED" | "PARTIALLY_PUBLISHED" | "FAILED" | "CANCELLED";
  source_filename: string;
  row_count: number;
  created_count: number;
  updated_count: number;
  skipped_count: number;
  error_count: number;
  created_at: string;
  validated_at: string | null;
  published_at: string | null;
  cancelled_at: string | null;
}
interface RowError { row_number: number; field: string | null; code: string; message: string }

const STATUS_TONE: Record<string, string> = {
  UPLOADED: "bg-fig-bg text-fig-muted",
  VALIDATING: "bg-blue-50 text-fig-blue",
  VALID: "bg-green-50 text-fig-green",
  INVALID: "bg-red-50 text-fig-red",
  PUBLISHED: "bg-green-100 text-fig-green",
  PARTIALLY_PUBLISHED: "bg-orange-50 text-fig-orange",
  FAILED: "bg-red-50 text-fig-red",
  CANCELLED: "bg-fig-bg text-fig-muted",
};

function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function Imports({ kind }: { kind: ImportKind }) {
  const navigate = useNavigate();
  const params = useParams();
  const { user } = useAuthV2();
  const qc = useQueryClient();
  const canImport = user?.roles?.includes("ADMIN") || user?.roles?.includes("LND_TEAM");

  const { data: companies } = useQuery({ queryKey: ["companies"], queryFn: () => v2.get<Company[]>("/companies") });
  const company = companies?.find((c) => c.company_id === user?.companyId) ?? companies?.[0];

  const importType = kind === "organisation" ? "ORGANISATION" : "WORKER";
  const activeBatchId = params.batchId ?? null;

  const historyKey = ["import-history", company?.company_id, importType];
  const { data: history } = useQuery({
    queryKey: historyKey,
    queryFn: () => v2.get<Batch[]>(`/companies/${company!.company_id}/imports?type=${importType}`),
    enabled: !!company,
  });

  const batchKey = ["import-batch", activeBatchId];
  const { data: batch, error: batchError } = useQuery({
    queryKey: batchKey,
    queryFn: () => v2.get<Batch>(`/imports/${activeBatchId}`),
    enabled: !!activeBatchId,
    refetchInterval: (query) => (["UPLOADED", "VALIDATING"].includes((query.state.data as Batch | undefined)?.status ?? "") ? 1000 : false),
  });
  const errorsKey = ["import-errors", activeBatchId];
  const { data: rowErrors } = useQuery({
    queryKey: errorsKey,
    queryFn: () => v2.get<RowError[]>(`/imports/${activeBatchId}/errors`),
    enabled: !!activeBatchId && batch?.status === "INVALID",
  });

  const invalidateBatch = () => {
    qc.invalidateQueries({ queryKey: batchKey });
    qc.invalidateQueries({ queryKey: errorsKey });
    qc.invalidateQueries({ queryKey: historyKey });
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false);

  const upload = useMutation({
    mutationFn: (file: File) => uploadImportFile<Batch>(`/companies/${company!.company_id}/imports/${kind}`, file),
    onSuccess: (row) => {
      navigate(`/admin/imports/${kind}/${row.import_batch_id}`);
      qc.invalidateQueries({ queryKey: historyKey });
    },
  });
  const validate = useMutation({ mutationFn: () => v2.post(`/imports/${activeBatchId}/validate`), onSuccess: invalidateBatch });
  const publish = useMutation({ mutationFn: () => v2.post(`/imports/${activeBatchId}/publish`), onSuccess: () => { setPublishConfirmOpen(false); invalidateBatch(); } });
  const cancel = useMutation({ mutationFn: () => v2.post(`/imports/${activeBatchId}/cancel`), onSuccess: invalidateBatch });

  async function downloadTemplate() {
    // The endpoint returns text/csv, not JSON, so this bypasses v2.get
    // (which always parses the body as JSON) and fetches directly.
    const token = localStorage.getItem("oworkly.v2.accessToken");
    const res = await fetch(`/api/v1/v2/import-templates/${kind === "organisation" ? "organisation" : "workers"}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    downloadCsv(`${kind}-import-template.csv`, await res.text());
  }

  function downloadErrorReport() {
    if (!rowErrors) return;
    const header = "row_number,field,code,message";
    const lines = rowErrors.map((e) => [e.row_number, e.field ?? "", e.code, `"${e.message.replace(/"/g, '""')}"`].join(","));
    downloadCsv(`${kind}-import-errors.csv`, [header, ...lines].join("\n"));
  }

  if (!canImport) {
    return (
      <AppShell breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: "Master-Data Imports" }]}>
        <PageHeader title="Master-Data Imports" />
        <Forbidden message="Only Admin or L&D can manage master-data imports." />
      </AppShell>
    );
  }
  if (batchError instanceof ApiV2Error && batchError.status === 403) {
    return (
      <AppShell breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: "Master-Data Imports" }]}>
        <PageHeader title="Master-Data Imports" />
        <Forbidden />
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: "Master-Data Imports" }]}>
      <PageHeader title="Master-Data Imports" description={company ? `${company.name} · Upload, validate, and publish organisation or worker master data` : undefined} />

      <div className="mb-5 flex gap-1 border-b border-fig-border text-sm font-medium">
        {([["organisation", "🏢 Organisation"], ["workers", "👷 Workers"]] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => navigate(`/admin/imports/${key}`)}
            className={`-mb-px border-b-2 px-3 py-2 ${kind === key ? "border-fig-blue text-fig-blue" : "border-transparent text-fig-muted hover:text-fig-text"}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-5">
        <div className="col-span-2 space-y-5">
          <SectionCard
            title={kind === "organisation" ? "Upload organisation hierarchy CSV" : "Upload worker master CSV"}
            action={<button onClick={downloadTemplate} className="text-xs font-medium text-fig-blue hover:underline">Download template</button>}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) upload.mutate(file);
                e.target.value = "";
              }}
            />
            <div className="flex items-center gap-3">
              <Button onClick={() => fileInputRef.current?.click()} disabled={upload.isPending || !company}>
                {upload.isPending ? "Uploading…" : "+ Choose CSV file"}
              </Button>
              {!activeBatchId && <span className="text-xs text-fig-muted">No file selected yet.</span>}
            </div>
            {upload.isError && (
              <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-fig-red">
                {upload.error instanceof ApiV2Error ? upload.error.message : "Upload failed"}
              </div>
            )}
          </SectionCard>

          {activeBatchId && batch && (
            <SectionCard
              title={
                <span className="flex items-center gap-2">
                  {batch.source_filename}
                  <span className={`rounded px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[batch.status]}`}>{batch.status.replace(/_/g, " ")}</span>
                </span>
              }
            >
              <div className="mb-4 grid grid-cols-4 gap-3 text-center">
                <div className="rounded-lg bg-fig-bg p-3">
                  <div className="text-lg font-bold text-fig-text">{batch.row_count}</div>
                  <div className="text-[11px] text-fig-muted">rows in file</div>
                </div>
                <div className="rounded-lg bg-green-50 p-3">
                  <div className="text-lg font-bold text-fig-green">{batch.row_count - batch.error_count}</div>
                  <div className="text-[11px] text-fig-muted">valid rows</div>
                </div>
                <div className="rounded-lg bg-red-50 p-3">
                  <div className="text-lg font-bold text-fig-red">{batch.error_count}</div>
                  <div className="text-[11px] text-fig-muted">error rows</div>
                </div>
                <div className="rounded-lg bg-fig-bg p-3">
                  <div className="text-lg font-bold text-fig-text">{batch.created_count + batch.updated_count}</div>
                  <div className="text-[11px] text-fig-muted">created + updated</div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {["UPLOADED", "INVALID"].includes(batch.status) && (
                  <Button variant="secondary" onClick={() => validate.mutate()} disabled={validate.isPending}>
                    {validate.isPending ? "Validating…" : batch.status === "INVALID" ? "Re-validate" : "Validate"}
                  </Button>
                )}
                {batch.status === "VALID" && (
                  <Button onClick={() => setPublishConfirmOpen(true)} disabled={publish.isPending}>
                    Publish
                  </Button>
                )}
                {rowErrors && rowErrors.length > 0 && (
                  <Button variant="secondary" onClick={downloadErrorReport}>Download error report</Button>
                )}
                {!["PUBLISHED", "CANCELLED"].includes(batch.status) && (
                  <Button variant="danger" onClick={() => cancel.mutate()} disabled={cancel.isPending}>Cancel</Button>
                )}
              </div>

              {batch.status === "PUBLISHED" && (
                <div className="mt-4 rounded-lg bg-green-50 px-4 py-3 text-sm text-fig-green">
                  ✓ Published — {batch.created_count} created, {batch.updated_count} updated, {batch.skipped_count} skipped.
                </div>
              )}

              {rowErrors && rowErrors.length > 0 && (
                <div className="mt-4">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-fig-muted">Row-level errors</div>
                  <div className="max-h-80 overflow-y-auto rounded-lg border border-fig-border">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-fig-bg">
                        <tr className="text-left text-[10px] uppercase tracking-wide text-fig-muted">
                          <th className="px-3 py-2">Row</th>
                          <th className="px-3 py-2">Field</th>
                          <th className="px-3 py-2">Code</th>
                          <th className="px-3 py-2">Message</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rowErrors.map((e, i) => (
                          <tr key={i} className="border-t border-fig-border">
                            <td className="px-3 py-2 font-medium">{e.row_number}</td>
                            <td className="px-3 py-2 text-fig-muted">{e.field ?? "—"}</td>
                            <td className="px-3 py-2"><span className="rounded bg-red-50 px-1.5 py-0.5 text-fig-red">{e.code}</span></td>
                            <td className="px-3 py-2">{e.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </SectionCard>
          )}
        </div>

        <SectionCard title="Import history" padded={false}>
          {(history ?? []).length === 0 && <div className="px-4 py-4 text-sm text-fig-muted">No imports yet.</div>}
          {history?.map((b) => (
            <button
              key={b.import_batch_id}
              onClick={() => navigate(`/admin/imports/${kind}/${b.import_batch_id}`)}
              className={`block w-full border-b border-fig-border px-4 py-3 text-left last:border-b-0 ${b.import_batch_id === activeBatchId ? "bg-blue-50" : "hover:bg-fig-bg"}`}
            >
              <div className="truncate text-sm font-medium text-fig-text">{b.source_filename}</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-fig-muted">
                <span className={`rounded px-1.5 py-0.5 font-semibold ${STATUS_TONE[b.status]}`}>{b.status.replace(/_/g, " ")}</span>
                <span>{new Date(b.created_at).toLocaleString()}</span>
              </div>
            </button>
          ))}
        </SectionCard>
      </div>

      {publishConfirmOpen && batch && (
        <Modal
          open
          title="Confirm publish"
          onClose={() => setPublishConfirmOpen(false)}
          footer={<ModalActions onCancel={() => setPublishConfirmOpen(false)} onSave={() => publish.mutate()} saving={publish.isPending} saveLabel="Publish" />}
        >
          <p className="text-sm text-fig-text">
            This will write <strong>{batch.row_count - batch.error_count}</strong> valid row(s) from <strong>{batch.source_filename}</strong> into live{" "}
            {kind === "organisation" ? "organisation hierarchy" : "worker"} records. Existing records matched by code will be updated, not duplicated.
          </p>
          {publish.isError && <div className="mt-2 text-xs text-fig-red">{publish.error instanceof ApiV2Error ? publish.error.message : "Publish failed"}</div>}
        </Modal>
      )}
    </AppShell>
  );
}
