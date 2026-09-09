interface ApprovalStage {
  sequence_no: number;
  role_name: string;
  action: "approved" | "returned" | null;
  remarks: string | null;
  acted_at: string | null;
  approver_display_name: string | null;
}

export function ApprovalTimeline({ stages }: { stages: ApprovalStage[] }) {
  return (
    <div className="space-y-3">
      {stages.map((stage) => {
        const done = stage.action === "approved";
        const returned = stage.action === "returned";
        const pending = !stage.action;
        return (
          <div
            key={stage.sequence_no}
            className={`rounded-fig-card border p-4 ${
              done ? "border-green-200 bg-white" : returned ? "border-red-200 bg-white" : "border-fig-border bg-white"
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3">
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white ${
                    done ? "bg-fig-green" : returned ? "bg-fig-red" : "bg-slate-300"
                  }`}
                >
                  {(stage.approver_display_name ?? stage.role_name)
                    .split(" ")
                    .map((s) => s[0])
                    .slice(0, 2)
                    .join("")
                    .toUpperCase()}
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-fig-text">{stage.role_name}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        done ? "bg-green-50 text-fig-green" : returned ? "bg-red-50 text-fig-red" : "bg-orange-50 text-fig-orange"
                      }`}
                    >
                      {done ? "Approved" : returned ? "Returned" : "Pending"}
                    </span>
                  </div>
                  {stage.approver_display_name && <div className="text-xs text-fig-muted">{stage.approver_display_name}</div>}
                  {stage.remarks && <p className="mt-1.5 text-sm italic text-fig-text/80">"{stage.remarks}"</p>}
                </div>
              </div>
              {stage.acted_at && <span className="shrink-0 text-xs text-fig-muted">{new Date(stage.acted_at).toLocaleString()}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
