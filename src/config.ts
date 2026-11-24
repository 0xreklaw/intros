import "dotenv/config"
import { z } from "zod"

/** An env var that may be left empty (`KEY=`) to mean "not set". */
const optional = z
  .string()
  .optional()
  .transform((v) => v?.trim() || undefined)

const envSchema = z.object({
  /** The app's connection. Must be a NOSUPERUSER / NOBYPASSRLS role so row-level security applies. */
  DATABASE_URL: z
    .string()
    .default("postgresql://intros_app:intros_app@localhost:5433/intros"),
  /** Owner role for migrations only. Falls back to DATABASE_URL when unset. */
  MIGRATION_DATABASE_URL: optional,

  /** S3-compatible storage (Cloudflare R2, S3, or the local emulator) for raw API responses. */
  S3_ENDPOINT: z.string().default("http://localhost:9090"),
  S3_REGION: z.string().default("auto"),
  S3_ACCESS_KEY_ID: z.string().default("test"),
  S3_SECRET_ACCESS_KEY: z.string().default("test"),
  S3_BUCKET: z.string().default("intros-data"),
  S3_FORCE_PATH_STYLE: z
    .string()
    .default("true")
    .transform((v) => v === "true" || v === "1"),

  /** treg org-scoped token (X-Treg-Token). Unset turns off every paid lookup. */
  TREG_API_KEY: optional,
  TREG_BASE_URL: z.string().default("https://treg.to"),

  /** OpenRouter reads and judges people. Unset turns search off. */
  OPENROUTER_API_KEY: optional,
  OPENROUTER_MODEL: z.string().default("openai/gpt-4o-mini"),
  /** Model for the review agent (needs tool calling). Defaults to OPENROUTER_MODEL. */
  OPENROUTER_AGENT_MODEL: optional,
  OPENROUTER_BASE_URL: z.string().default("https://openrouter.ai/api/v1"),

  /** The workspace the app shows. There are no user accounts, so one workspace serves everyone. */
  APP_TENANT_SLUG: z
    .string()
    .regex(/^[a-z0-9][a-z0-9._-]*$/, "lowercase letters, digits, . _ -")
    .default("default"),
  /** Name of the workspace, used when it is first created. */
  APP_TENANT_NAME: z.string().trim().min(1).default("My team"),
  /** Password for the whole app (HTTP basic auth, any username). Required in production. */
  APP_PASSWORD: optional,
})

export const env = envSchema.parse(process.env)
