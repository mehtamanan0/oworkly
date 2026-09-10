// API client for the new qualification-case model. Deliberately separate
// from lib/api.ts (the legacy MVP client) — the two models have different
// auth (real bearer tokens here, none there) and different base paths.
const AUTH_BASE = "/api/v1"; // /auth/dev-login, /worker-portal/*
const V2_BASE = "/api/v1/v2"; // everything behind `authenticate` + company scoping
const QUAL_BASE = "/api/v1/v2"; // qualificationRouter is mounted at the same /v2 prefix

const TOKEN_KEY = "oworkly.v2.accessToken";
const USER_KEY = "oworkly.v2.user";

export interface CurrentUserV2 {
  userId: string;
  companyId: string | null;
  roles: string[];
  workerId: string | null;
  displayName: string;
}

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): CurrentUserV2 | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function storeSession(accessToken: string, user: CurrentUserV2) {
  localStorage.setItem(TOKEN_KEY, accessToken);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export class ApiV2Error extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(base: string, path: string, options: RequestInit & { idempotencyKey?: string } = {}): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(options.headers as Record<string, string> | undefined) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;

  const res = await fetch(`${base}${path}`, { ...options, headers });

  if (res.status === 401) {
    clearSession();
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ title: res.statusText }));
    throw new ApiV2Error(res.status, body.title || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const authApi = {
  devLogin: (username: string) => request<{ accessToken: string; user: CurrentUserV2 }>(AUTH_BASE, "/auth/dev-login", { method: "POST", body: JSON.stringify({ username }) }),
  devUsers: () => request<{ username: string; display_name: string; roles: string[]; companies: string[] }[]>(AUTH_BASE, "/auth/dev-users"),
};

export const workerPortalApi = {
  identify: (employeeCode: string) => request<{ worker_id: string; first_name: string; last_name: string; hrms_employee_code: string; verificationMethodsAvailable: string[] }>(AUTH_BASE, "/worker-portal/identify", { method: "POST", body: JSON.stringify({ employeeCode }) }),
  verify: (workerId: string, method: string, pin: string) => request<{ accessToken: string }>(AUTH_BASE, "/worker-portal/verify", { method: "POST", body: JSON.stringify({ workerId, method, pin }) }),
};

export const v2 = {
  get: <T>(path: string) => request<T>(V2_BASE, path),
  post: <T>(path: string, body?: unknown, idempotencyKey?: string) => request<T>(V2_BASE, path, { method: "POST", body: body !== undefined ? JSON.stringify(body) : undefined, idempotencyKey }),
  patch: <T>(path: string, body?: unknown) => request<T>(V2_BASE, path, { method: "PATCH", body: body !== undefined ? JSON.stringify(body) : undefined }),
  del: <T>(path: string) => request<T>(V2_BASE, path, { method: "DELETE" }),
};

export const qual = {
  get: <T>(path: string) => request<T>(QUAL_BASE, path),
  post: <T>(path: string, body?: unknown, idempotencyKey?: string) => request<T>(QUAL_BASE, path, { method: "POST", body: body !== undefined ? JSON.stringify(body) : undefined, idempotencyKey }),
};

function idempotencyKey(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}
export { idempotencyKey };
