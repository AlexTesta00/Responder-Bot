import { z } from "zod";

import { err, ok, type Result } from "../shared/result.ts";

const envShape = {
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  HOST: z.string().trim().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
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
