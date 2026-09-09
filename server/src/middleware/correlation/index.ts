import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export function correlationId(req: Request, res: Response, next: NextFunction) {
  const incoming = req.headers["x-correlation-id"];
  req.correlationId = (typeof incoming === "string" && incoming) || randomUUID();
  res.setHeader("x-correlation-id", req.correlationId);
  next();
}
