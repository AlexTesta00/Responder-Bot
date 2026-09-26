import { z } from "zod";

import { err, ok, type Result } from "../shared/result.ts";
import { telegramUserIdSchema } from "../telegram/ids.ts";

const envShape = {
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  HOST: z.string().trim().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  TELEGRAM_BOT_TOKEN: z
    .string()
    .regex(/^\d+:[\w-]+$/, "Expected the bot token issued by @BotFather"),
  // Telegram accepts 1-256 characters; 32 is the minimum we consider strong.
  TELEGRAM_WEBHOOK_SECRET: z
    .string()
    .regex(
      /^[\w-]{32,256}$/,
      "Expected 32-256 letters, digits, underscores or hyphens",
    ),
  TELEGRAM_ALLOWED_USER_ID: z
    .string()
    .regex(/^\d+$/, "Expected a numeric Telegram user ID")
    .transform(Number)
    // The schema's int() also rejects numbers beyond the safe integer range.
    .pipe(telegramUserIdSchema),
};

const envSchema = z.object(envShape).readonly();

/** Validated runtime configuration: only the declared variables, typed. */
export type Env = z.infer<typeof envSchema>;

export type NodeEnv = Env["NODE_ENV"];

/** Every variable the service reads. `.env.example` must document them all. */
export const ENV_VARIABLES: readonly string[] = Object.keys(envShape);

export type EnvIssue = Readonly<{
  variable: string;
  message: string;
}>;

export type EnvValidationError = Readonly<{
  type: "ENV_VALIDATION_ERROR";
  issues: readonly EnvIssue[];
}>;

export const parseEnv = (
  source: Readonly<Record<string, string | undefined>>,
): Result<Env, EnvValidationError> => {
  const parsed = envSchema.safeParse(source);

  if (parsed.success) {
    return ok(parsed.data);
  }

  return err({
    type: "ENV_VALIDATION_ERROR",
    issues: parsed.error.issues.map((issue) => ({
      variable: issue.path.map(String).join("."),
      message: issue.message,
    })),
  });
};

/**
 * Report naming each invalid variable. Values are never included, because
 * they may be secrets.
 */
export const describeEnvError = (error: EnvValidationError): string =>
  [
    "Invalid environment configuration:",
    ...error.issues.map(
      ({ variable, message }) => `  - ${variable}: ${message}`,
    ),
  ].join("\n");
