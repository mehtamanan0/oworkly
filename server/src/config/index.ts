// Single validated source of truth for environment configuration. Nothing else
// in the codebase should read process.env directly — import `config` instead,
// so a missing/malformed env var fails fast at boot with a clear message
// rather than surfacing as a mystery bug three layers deep at request time.
import { z } from "zod";

const boolFromEnv = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DEPLOYMENT_MODE: z.enum(["standalone", "saas", "on_prem"]).default("standalone"),
  TENANT_ID: z.string().default("default"),

  DATABASE_URL: z.string().default("postgresql://oworkly:oworkly_dev_pw@localhost:5433/oworkly_lms"),
  DATABASE_APP_USER: z.string().default("oworkly"),
  DATABASE_APP_PASSWORD: z.string().default("oworkly_dev_pw"),

  REDIS_URL: z.string().default("redis://localhost:6380"),

  JWT_SECRET: z.string().min(16).default("dev-only-insecure-secret-change-me-before-any-real-deployment"),
  JWT_ISSUER: z.string().default("oworkly-lms-dev"),
  JWT_AUDIENCE: z.string().default("oworkly-lms-api"),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  DEV_AUTH_ENABLED: boolFromEnv.default("true" as any),

  OIDC_ISSUER: z.string().optional(),
  OIDC_JWKS_URI: z.string().optional(),
  OIDC_AUDIENCE: z.string().optional(),

  PUBLIC_API_URL: z.string().default("http://localhost:4000"),
  PUBLIC_WEB_URL: z.string().default("http://localhost:5173"),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:5173")
    .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean)),

  AI_PROVIDER: z.enum(["auto", "local", "openai", "anthropic"]).default("auto"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().default("https://api.openai.com/v1"),
  OPENAI_CHAT_MODEL: z.string().default("gpt-4o-mini"),
  OPENAI_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_BASE_URL: z.string().default("https://api.anthropic.com"),
  ANTHROPIC_CHAT_MODEL: z.string().default("claude-sonnet-5"),

  STORAGE_DRIVER: z.enum(["local", "minio", "s3"]).default("local"),
  STORAGE_ENDPOINT: z.string().default("http://localhost:9000"),
  STORAGE_BUCKET: z.string().default("oworkly-evidence"),
  STORAGE_ACCESS_KEY: z.string().default("oworkly-minio"),
  STORAGE_SECRET_KEY: z.string().default("oworkly-minio-secret"),
  STORAGE_REGION: z.string().default("us-east-1"),
  STORAGE_LOCAL_DIR: z.string().default("/tmp/oworkly-evidence"),

  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  TELEMETRY_ENDPOINT: z.string().optional(),

  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_VERIFY_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_VERIFY_MAX: z.coerce.number().int().positive().default(20),

  CERTIFICATE_DEFAULT_VALIDITY_MONTHS: z.coerce.number().int().positive().default(24),

  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(25 * 1024 * 1024),
});

function loadConfig() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment configuration — see errors above");
  }
  const env = parsed.data;
  return {
    ...env,
    isProduction: env.NODE_ENV === "production",
    isTest: env.NODE_ENV === "test",
    // The dev auth adapter (§4 of the plan) must never be reachable in a real
    // production deployment, regardless of what DEV_AUTH_ENABLED is set to.
    devAuthActuallyEnabled: env.DEV_AUTH_ENABLED && env.NODE_ENV !== "production",
    aiConfigured: {
      openai: !!env.OPENAI_API_KEY,
      anthropic: !!env.ANTHROPIC_API_KEY,
    },
  };
}

export const config = loadConfig();
export type AppConfig = typeof config;
