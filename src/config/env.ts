import { z } from "zod";

import { err, ok, type Result } from "../shared/result.ts";
import { telegramUserIdSchema } from "../telegram/ids.ts";

/** Unset and empty are the same, as in a .env copied from .env.example. */
const unlessEmpty = (value: unknown): unknown =>
  value === "" ? undefined : value;

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
  ANTHROPIC_API_KEY: z
    .string()
    .regex(
      /^sk-ant-[\w-]+$/,
      "Expected an API key from the Claude Developer Platform",
    ),
  ANTHROPIC_MODEL: z.string().trim().min(1).default("claude-opus-5"),
  ANTHROPIC_FAST_MODEL: z.string().trim().min(1).default("claude-haiku-4-5"),
  // The monthly spend limit set on the Claude Console, in dollars.
  ANTHROPIC_MONTHLY_LIMIT_USD: z.preprocess(
    unlessEmpty,
    z.coerce
      .number({ error: "Expected an amount in dollars, such as 20 or 20.50" })
      .positive()
      .max(1_000_000)
      .optional(),
  ),
  // MySQL or MariaDB, such as the database included in Hostinger's plans.
  DATABASE_HOST: z.preprocess(unlessEmpty, z.string().trim().min(1).optional()),
  DATABASE_PORT: z.preprocess(
    unlessEmpty,
    z.coerce.number().int().min(1).max(65_535).default(3306),
  ),
  DATABASE_NAME: z.preprocess(unlessEmpty, z.string().trim().min(1).optional()),
  DATABASE_USER: z.preprocess(unlessEmpty, z.string().trim().min(1).optional()),
  DATABASE_PASSWORD: z.preprocess(unlessEmpty, z.string().min(1).optional()),
};

/** Together they identify the database; the port has a default. */
const DATABASE_VARIABLES = [
  "DATABASE_HOST",
  "DATABASE_NAME",
  "DATABASE_USER",
  "DATABASE_PASSWORD",
] as const;

const envSchema = z
  .object(envShape)
  .superRefine((env, context) => {
    const missing = DATABASE_VARIABLES.filter(
      (name) => env[name] === undefined,
    );
    const production = env.NODE_ENV === "production";
    // Without a database, development keeps prospect memory in the process.
    if (!production && missing.length === DATABASE_VARIABLES.length) {
      return;
    }
    for (const name of missing) {
      context.addIssue({
        code: "custom",
        path: [name],
        message: production
          ? "Required in production, where prospect memory needs the database"
          : "Required together with the other DATABASE_ variables",
      });
    }
  })
  .readonly();

/** Validated runtime configuration: only the declared variables, typed. */
export type Env = z.infer<typeof envSchema>;

export type NodeEnv = Env["NODE_ENV"];

/** Every variable the service reads. `.env.example` must document them all. */
export const ENV_VARIABLES: readonly string[] = Object.keys(envShape);

export type DatabaseConfig = Readonly<{
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}>;

/** The database to connect to, or null when none is configured. */
export const databaseConfigOf = (env: Env): DatabaseConfig | null => {
  const {
    DATABASE_HOST: host,
    DATABASE_PORT: port,
    DATABASE_NAME: database,
    DATABASE_USER: user,
    DATABASE_PASSWORD: password,
  } = env;
  return host === undefined ||
    database === undefined ||
    user === undefined ||
    password === undefined
    ? null
    : { host, port, database, user, password };
};

/** The monthly spend limit in millionths of a dollar, when it is set. */
export const monthlyLimitOf = (env: Env): number | null =>
  env.ANTHROPIC_MONTHLY_LIMIT_USD === undefined
    ? null
    : Math.round(env.ANTHROPIC_MONTHLY_LIMIT_USD * 1_000_000);

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
