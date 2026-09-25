// A minimal in-memory sliding-window rate limiter. Single-process only (this
// app runs as one Render web service, no horizontal scaling assumed) --
// reuses the RATE_LIMIT_* config already defined but previously unwired.
import type { Request, Response, NextFunction } from "express";
import { ApiError } from "../lib/asyncHandler.js";

const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(opts: { windowSeconds: number; max: number; keyFn?: (req: Request) => string }) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const key = opts.keyFn ? opts.keyFn(req) : (req.ip ?? "unknown");
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + opts.windowSeconds * 1000 });
      return next();
    }
    if (bucket.count >= opts.max) {
      return next(new ApiError(429, "Too many attempts — please wait before trying again"));
    }
    bucket.count += 1;
    next();
  };
}
