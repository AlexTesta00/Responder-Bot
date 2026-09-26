const fieldOf = (error: unknown, name: string): unknown =>
  typeof error === "object" && error !== null
    ? Reflect.get(error, name)
    : undefined;

const stringOrNull = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

/**
 * What identifies an unexpected error in the logs: its kind and codes. The
 * message is left out because it can quote data, such as the values of a
 * database query.
 */
export const errorFields = (
  error: unknown,
): Readonly<Record<string, string | number | null>> => {
  const errno = fieldOf(error, "errno");
  return {
    error_name: error instanceof Error ? error.name : null,
    error_code: stringOrNull(fieldOf(error, "code")),
    errno: typeof errno === "number" ? errno : null,
    sql_state: stringOrNull(fieldOf(error, "sqlState")),
  };
};
