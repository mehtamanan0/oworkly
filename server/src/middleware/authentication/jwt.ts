// Real server-side identity. The frontend's "Viewing as" switcher is gone as
// a security mechanism — every request must carry a signed JWT, and every
// actor ID used anywhere downstream (assessorUserId, scoredByUserId,
// completedByWorkerId, approvedByUserId, resolvedByUserId, uploadedByUserId)
// is derived from this verified token, never trusted from the request body.
import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";
import { config } from "../../config/index.js";
import { ApiError } from "../../lib/asyncHandler.js";

export interface CurrentUser {
  userId: string;
  companyId: string | null; // null = platform admin, not scoped to one company
  roles: string[];
  workerId: string | null;
  displayName: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      currentUser?: CurrentUser;
      correlationId?: string;
    }
  }
}

export function signAccessToken(user: CurrentUser): string {
  return jwt.sign(
    { sub: user.userId, companyId: user.companyId, roles: user.roles, workerId: user.workerId, name: user.displayName },
    config.JWT_SECRET,
    { issuer: config.JWT_ISSUER, audience: config.JWT_AUDIENCE, expiresIn: config.JWT_ACCESS_TTL_SECONDS }
  );
}

export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return next(new ApiError(401, "Missing bearer token"));
  }
  const token = header.slice("Bearer ".length);
  try {
    const payload = jwt.verify(token, config.JWT_SECRET, { issuer: config.JWT_ISSUER, audience: config.JWT_AUDIENCE }) as jwt.JwtPayload;
    req.currentUser = {
      userId: String(payload.sub),
      companyId: (payload.companyId as string) ?? null,
      roles: (payload.roles as string[]) ?? [],
      workerId: (payload.workerId as string) ?? null,
      displayName: (payload.name as string) ?? "",
    };
    next();
  } catch {
    next(new ApiError(401, "Invalid or expired token"));
  }
}

// Same verification, but a missing/invalid token is not an error — used by
// public endpoints (e.g. certificate verify) that behave the same either way
// but want req.currentUser populated when a staff session happens to be
// present.
export function authenticateOptional(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return next();
  try {
    const payload = jwt.verify(header.slice(7), config.JWT_SECRET, { issuer: config.JWT_ISSUER, audience: config.JWT_AUDIENCE }) as jwt.JwtPayload;
    req.currentUser = {
      userId: String(payload.sub),
      companyId: (payload.companyId as string) ?? null,
      roles: (payload.roles as string[]) ?? [],
      workerId: (payload.workerId as string) ?? null,
      displayName: (payload.name as string) ?? "",
    };
  } catch {
    // ignored — this endpoint works unauthenticated too
  }
  next();
}
