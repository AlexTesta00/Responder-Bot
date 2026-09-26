/**
 * Outcome of an operation that can fail in an expected way. Expected failures
 * are values rather than exceptions, so the compiler makes callers handle them.
 */
export type Result<T, E> =
  Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: E }>;

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
