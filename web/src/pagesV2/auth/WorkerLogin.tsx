import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { workerPortalApi, ApiV2Error } from "../../lib/apiV2";
import { Button } from "../../components/figma/Button";

const DEMO_CODES = [
  { code: "EMP-2847", name: "Rajesh Kumar", pin: "1234" },
  { code: "EMP-3102", name: "Suresh Babu", pin: "—" },
];

export function WorkerLogin() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function identify(employeeCode: string) {
    setLoading(true);
    setError(null);
    try {
      const worker = await workerPortalApi.identify(employeeCode);
      navigate("/worker-verify", { state: { worker } });
    } catch (err) {
      setError(err instanceof ApiV2Error ? err.message : "Could not find that employee code");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-start justify-center bg-fig-bg px-4 py-24">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center">
          <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-fig-navy text-white">
            <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6">
              <path d="M12 2l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 14.4l-4.8 2.5.9-5.4-3.9-3.8 5.4-.8L12 2z" fill="currentColor" />
            </svg>
          </span>
          <h1 className="text-xl font-bold text-fig-navy">OWorkly</h1>
          <p className="text-xs font-medium tracking-wide text-fig-muted">WORKER SELF-ASSESSMENT</p>
        </div>

        <form
          className="rounded-fig-card border border-fig-border bg-white p-6 shadow-fig-card"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim()) identify(code.trim());
          }}
        >
          <h2 className="text-lg font-bold text-fig-text">Enter your Employee Code</h2>
          <p className="mb-4 text-sm text-fig-muted">Use your badge ID or SAP employee number</p>

          <label className="mb-1 block text-sm font-medium text-fig-text">Employee Code / Badge ID</label>
          <input
            autoFocus
            className="mb-4 w-full rounded-lg border border-fig-blue/50 px-3 py-2 text-sm focus:border-fig-blue focus:outline-none"
            placeholder="e.g. EMP-2847 or SAP-10002847"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />

          {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-fig-red">{error}</p>}

          <Button type="submit" variant="secondary" disabled={loading} className="w-full justify-center bg-slate-400 text-white hover:bg-slate-500">
            {loading ? "Checking…" : "Continue"}
          </Button>

          <div className="mt-4 rounded-fig-card border border-orange-200 bg-orange-50/60 p-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-fig-orange">Demo — try these codes</div>
            <div className="space-y-1.5">
              {DEMO_CODES.map((d) => (
                <button
                  key={d.code}
                  type="button"
                  onClick={() => setCode(d.code)}
                  className="flex w-full items-center justify-between text-left text-xs"
                >
                  <span>
                    <span className="font-semibold text-fig-text">{d.code}</span> <span className="text-fig-muted">{d.name}</span>
                  </span>
                  <span className="font-medium text-fig-orange">PIN: {d.pin}</span>
                </button>
              ))}
            </div>
          </div>
        </form>

        <Link to="/login" className="mt-4 block text-center text-xs text-fig-muted hover:text-fig-blue">
          ← Back to Staff Login
        </Link>
      </div>
    </div>
  );
}
