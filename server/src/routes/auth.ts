// M10: real password authentication for staff login -- sibling to, and
// independent from, devLogin.ts (kept unchanged for local dev/tests).
import { Router } from "express";
import { asyncHandler, ApiError } from "../lib/asyncHandler.js";
import { authenticate } from "../middleware/authentication/jwt.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { config } from "../config/index.js";
import * as authService from "../application/services/authService.js";

export const authRouter = Router();

authRouter.post(
  "/login",
  rateLimit({ windowSeconds: config.RATE_LIMIT_WINDOW_SECONDS, max: config.RATE_LIMIT_MAX, keyFn: (req) => `login:${req.ip}` }),
  asyncHandler(async (req, res) => {
    const { identifier, email, password } = req.body as { identifier?: string; email?: string; password?: string };
    const login = (identifier ?? email ?? "").trim();
    if (!login || !password) throw new ApiError(400, "email and password are required");
    const result = await authService.login(login, password);
    res.json({ accessToken: result.accessToken, user: result.user, expiresAt: result.expiresAt });
  })
);

authRouter.post(
  "/logout",
  authenticate,
  asyncHandler(async (req, res) => {
    await authService.logout(req.currentUser!.sessionId, req.currentUser!.userId);
    res.json({ status: "ok" });
  })
);

authRouter.get(
  "/session",
  authenticate,
  asyncHandler(async (req, res) => {
    res.json({ user: req.currentUser });
  })
);

authRouter.post(
  "/change-password",
  authenticate,
  asyncHandler(async (req, res) => {
    const { oldPassword, newPassword } = req.body as { oldPassword?: string; newPassword?: string };
    if (!oldPassword || !newPassword) throw new ApiError(400, "oldPassword and newPassword are required");
    await authService.changePassword(req.currentUser!.userId, oldPassword, newPassword);
    res.json({ status: "ok" });
  })
);
