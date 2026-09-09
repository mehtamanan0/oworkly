import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { authApi, ApiV2Error } from "../../lib/apiV2";
import { useAuthV2 } from "../../lib/AuthV2Context";
import { Button } from "../../components/figma/Button";

const DEMO_ACCOUNTS = [
  { username: "admin", label: "Platform Admin", sub: "admin / (any password — demo mode)", roleLabel: "Platform Admin" },
  { username: "cwec_admin", label: "CWE Company Admin", sub: "cwec_admin / (any password)", roleLabel: "Company Admin" },
  { username: "sunil_trainer", label: "Trainer — Blade Assembly", sub: "sunil_trainer / (any password)", roleLabel: "Trainer" },
  { username: "sss_admin", label: "SSS Company Admin", sub: "sss_admin / (any password)", roleLabel: "Company Admin" },
];

export function SignIn() {
  const { signIn } = useAuthV2();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function doSignIn(u: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await authApi.devLogin(u);
      signIn(res.accessToken, res.user);
      navigate("/dashboard");
    } catch (err) {
      setError(err instanceof ApiV2Error ? err.message : "Sign in failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-start justify-center bg-fig-bg px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center">
          <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-fig-navy text-white">
            <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6">
              <path d="M12 2l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 14.4l-4.8 2.5.9-5.4-3.9-3.8 5.4-.8L12 2z" fill="currentColor" />
            </svg>
          </span>
          <h1 className="text-xl font-bold text-fig-navy">OWorkly</h1>
          <p className="text-xs font-medium tracking-wide text-fig-muted">WORKFORCE SKILLS PLATFORM</p>
        </div>

        <form
          className="rounded-fig-card border border-fig-border bg-white p-6 shadow-fig-card"
          onSubmit={(e) => {
            e.preventDefault();
            if (username.trim()) doSignIn(username.trim());
          }}
        >
          <h2 className="text-lg font-bold text-fig-text">Sign in to your account</h2>
          <p className="mb-4 text-sm text-fig-muted">Enter your credentials to continue</p>

          <label className="mb-1 block text-sm font-medium text-fig-text">Username</label>
          <input
            className="mb-3 w-full rounded-lg border border-fig-border px-3 py-2 text-sm focus:border-fig-blue focus:outline-none"
            placeholder="Enter username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />

          <label className="mb-1 block text-sm font-medium text-fig-text">Password</label>
          <input
            type="password"
            className="mb-1 w-full rounded-lg border border-fig-border px-3 py-2 text-sm focus:border-fig-blue focus:outline-none"
            placeholder="Enter password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p className="mb-4 text-[11px] text-fig-muted">Demo mode: this is a development auth adapter — any password is accepted for a valid username.</p>

          {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-fig-red">{error}</p>}

          <Button type="submit" variant="secondary" disabled={loading} className="w-full justify-center bg-slate-400 text-white hover:bg-slate-500">
            {loading ? "Signing in…" : "Sign In"}
          </Button>

          <div className="my-4 flex items-center gap-3 text-xs text-fig-muted">
            <span className="h-px flex-1 bg-fig-border" />
            or
            <span className="h-px flex-1 bg-fig-border" />
          </div>

          <Button type="button" variant="secondary" className="w-full justify-center" onClick={() => navigate("/admin/companies")} disabled>
            Create a new company account
          </Button>
        </form>

        <Link
          to="/worker-login"
          className="mt-4 flex items-center justify-center gap-2 rounded-lg border border-fig-blue/30 bg-blue-50 px-4 py-2.5 text-sm font-semibold text-fig-blue"
        >
          🏅 Worker Self-Assessment Login
        </Link>
        <p className="mt-1 text-center text-xs text-fig-muted">For workers to self-assess using employee code</p>

        <div className="mt-6 rounded-fig-card border border-orange-200 bg-orange-50/60 p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-fig-orange">● Demo Accounts</div>
          <div className="space-y-2">
            {DEMO_ACCOUNTS.map((d) => (
              <div key={d.username} className="flex items-center justify-between rounded-lg border border-fig-border bg-white px-3 py-2">
                <div>
                  <div className="text-sm font-medium text-fig-text">{d.label}</div>
                  <div className="text-[11px] text-fig-muted">{d.sub}</div>
                </div>
                <button
                  type="button"
                  onClick={() => doSignIn(d.username)}
                  className="rounded-md bg-blue-50 px-2.5 py-1 text-xs font-semibold text-fig-blue hover:bg-blue-100"
                >
                  {d.roleLabel}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
