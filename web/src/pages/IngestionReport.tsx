import { Card } from "../components/ui";

export function IngestionReport() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Ingestion Report</h1>
        <p className="text-sm text-slate-500">
          What actually happened running the real <span className="font-mono text-xs">WTG - June - CQA_MBU_HR_FOR_001 … Skill Matrix - GAP analysis.xlsx</span>{" "}
          workbook (L&D Details / NE & Tower Vertical) through the deterministic Excel parser described in{" "}
          <span className="font-mono text-xs">05_Data_Migration_Ingestion_Strategy.md</span>.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          ["Org units created", "3", "Plant WTG Daman + Electrical/Mechanical Areas"],
          ["Processes ingested", "27", "7 Electrical + 20 Mechanical"],
          ["Workers created", "120", "real employees, from the Electrical sheet"],
          ["Worker↔process skill rows", "142", "source_outcome_id left NULL — declared starting position, not an assessment"],
        ].map(([label, value, sub]) => (
          <Card key={label as string}>
            <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
            <div className="mt-1 text-3xl font-bold">{value}</div>
            <div className="mt-1 text-xs text-slate-400">{sub}</div>
          </Card>
        ))}
      </div>

      <Card title="What the pipeline correctly rejected">
        <ul className="list-disc space-y-2 pl-5 text-sm text-slate-600">
          <li>
            <b>35 legend/footer rows quarantined on the Electrical sheet</b> — text like{" "}
            <span className="font-mono text-xs">"% Skill Gap = (No of people below required level (d)) / …"</span>,{" "}
            <span className="font-mono text-xs">"Y - Yes, N - No, 1-Level 1…"</span>, and{" "}
            <span className="font-mono text-xs">"Company Level Gap Calculation = …"</span> sit in the same columns as real worker
            rows, <i>sandwiched in the middle of legitimate data</i> (not just at the end) — the ingestor filters every row
            individually against the resolved process list rather than assuming the workbook's garbage rows are only a trailing
            block.
          </li>
          <li>
            <b>The Mechanical sheet yielded 0 usable per-worker rows</b>, despite 36 process bands being defined with real
            headcount requirements. Every row in that sheet's worker-data range turned out to be summary/legend text (
            <span className="font-mono text-xs">#DIV/0!</span>, month labels, permanent/contractual rollups) — the system
            quarantined the entire block rather than fabricate worker-level data that isn't actually in the source file. This
            is exactly the staging + human-review gate <span className="font-mono text-xs">05_Data_Migration_Ingestion_Strategy.md §2.5</span>{" "}
            calls for: Mechanical process structure (with required headcounts) is visible on the Skill Matrix page, flagged as
            needing a real per-worker data collection pass.
          </li>
          <li>
            <b>Process names were reconciled by normalized matching, not exact string match</b> — the workbook's process-definition
            header (e.g. <span className="font-mono text-xs">"Nacelle Testing"</span>) and its own per-worker data rows (e.g.{" "}
            <span className="font-mono text-xs">"Nacelle Testing ( Elect.)"</span>) disagree on formatting for the same process.
          </li>
        </ul>
      </Card>

      <Card title="One inferred heuristic worth flagging">
        <p className="text-sm text-slate-600">
          Employment type (permanent vs. contract) isn't stated anywhere in the workbook. This demo infers it from the employee
          code shape — plain numeric codes (e.g. <span className="font-mono">37908</span>) as permanent, "SC"-prefixed codes
          (e.g. <span className="font-mono">SC2881</span>) as contractor — because that pattern held consistently across the
          real file. It is <b>not</b> something the source docs stated; call this out before treating the Dashboard's
          permanent/contract split as authoritative.
        </p>
      </Card>
    </div>
  );
}
