import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { workerPortalApi, ApiV2Error } from "../../lib/apiV2";
import { useAuthV2 } from "../../lib/AuthV2Context";
import { Button } from "../../components/figma/Button";
import { Avatar } from "../../components/figma/Avatar";

interface IdentifiedWorker {
  worker_id: string;
  first_name: string;
  last_name: string;
  hrms_employee_code: string;
  verificationMethodsAvailable: string[];
}

// The Figma pack's screenshot 12 shows employee-code entry only, but the real
// backend flow (worker-portal /verify) requires a second factor — a
// Supervisor PIN — before issuing a session token. This screen is the
// necessary middle step the pack didn't render on its own; styled to match
// the same card language as 12/14 rather than left as a bare form.
export function WorkerVerify() {
  const location = useLocation();
  const navigate = useNavigate();
  const { signIn } = useAuthV2();
  const worker = (location.state as { worker?: IdentifiedWorker } | null)?.worker;
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!worker) {
    navigate("/worker-login");
    return null;
  }

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const res = await workerPortalApi.verify(worker!.worker_id, "SUPERVISOR_PIN", pin);
      signIn(res.accessToken, {
        userId: worker!.worker_id,
        companyId: null,
        roles: ["EMPLOYEE"],
        workerId: worker!.worker_id,
        displayName: `${worker!.first_name} ${worker!.last_name}`,
      });
      navigate("/worker/dashboard");
    } catch (err) {
      setError(err instanceof ApiV2Error ? err.message : "Verification failed");
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
            if (pin.trim()) submit();
          }}
        >
          <div className="mb-4 flex items-center gap-3">
            <Avatar name={`${worker.first_name} ${worker.last_name}`} />
            <div>
              <div className="text-sm font-semibold text-fig-text">
                {worker.first_name} {worker.last_name}
              </div>
              <div className="text-xs text-fig-muted">{worker.hrms_employee_code}</div>
            </div>
          </div>

          <h2 className="text-lg font-bold text-fig-text">Verify with Supervisor PIN</h2>
          <p className="mb-4 text-sm text-fig-muted">Ask your Supervisor for the 4-digit PIN to unlock self-assessment.</p>

          <label className="mb-1 block text-sm font-medium text-fig-text">Supervisor PIN</label>
          <input
            autoFocus
            type="password"
            inputMode="numeric"
            maxLength={4}
            className="mb-4 w-full rounded-lg border border-fig-blue/50 px-3 py-2 text-center text-lg tracking-[0.5em] focus:border-fig-blue focus:outline-none"
            placeholder="••••"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          />

          {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-fig-red">{error}</p>}

          <Button type="submit" variant="primary" disabled={loading || pin.length !== 4} className="w-full justify-center">
            {loading ? "Verifying…" : "Verify & Continue"}
          </Button>
          <button type="button" onClick={() => navigate("/worker-login")} className="mt-3 w-full text-center text-xs text-fig-muted hover:text-fig-blue">
            ← Use a different employee code
          </button>
        </form>
      </div>
    </div>
  );
}
