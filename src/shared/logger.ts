type LogFields = Readonly<Record<string, unknown>>;

/**
 * The structured logging application code relies on. Fastify's request
 * logger satisfies it, so each entry keeps the request_id of its request.
 */
export type Logger = Readonly<{
  info: (fields: LogFields, message: string) => void;
  warn: (fields: LogFields, message: string) => void;
  error: (fields: LogFields, message: string) => void;
}>;
