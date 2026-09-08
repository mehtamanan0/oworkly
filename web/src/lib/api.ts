const BASE = "/api/v1";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ title: res.statusText }));
    throw new Error(body.title || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
};

export interface OrgUnit {
  org_unit_id: string;
  parent_org_unit_id: string | null;
  unit_type: string;
  code: string;
  name: string;
  children?: OrgUnit[];
}

export interface Process {
  process_id: string;
  org_unit_id: string;
  org_unit_name: string;
  code: string;
  name: string;
  is_critical: boolean;
  required_headcount_l2: number | null;
  required_headcount_l3: number | null;
  required_headcount_l4: number | null;
}

export interface SkillMatrixRow {
  processId: string;
  code: string;
  name: string;
  isCritical: boolean;
  orgUnitName: string;
  requiredHeadcount: { L2: number | null; L3: number | null; L4: number | null };
  actualHeadcountByLevel: Record<string, number>;
  totalTracked: number;
  requiredLevelCode: string | null;
  requiredHeadcount_primary: number | null;
  atOrAboveRequired: number;
  belowRequired: number;
  pctSkillGap: number | null;
}

export interface Worker {
  worker_id: string;
  hrms_employee_code: string | null;
  employment_type: "permanent" | "contract";
  first_name: string;
  last_name: string | null;
  org_unit_name: string;
  job_role_name: string | null;
  status: string;
  process_count?: number;
}

export interface DashboardSummary {
  workers: { total: number; active: number };
  processes: { total: number; critical: number };
  outcomes: { total: number; passed: number; failed: number };
  activeCertificates: number;
  openSkillGaps: number;
  openEscalations: number;
  retestQueueSize: number;
  employmentSplit: { employment_type: string; cnt: number }[];
  overallAssessedPct: number;
}

export interface DemoUser {
  user_id: string;
  email: string;
  display_name: string;
  worker_id: string | null;
  role_codes: string[];
}
