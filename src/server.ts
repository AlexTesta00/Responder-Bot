// Process entry point: the imperative shell. It validates the environment,
// starts the HTTP application and closes it gracefully on shutdown signals.
import type { FastifyInstance, LogLevel } from "fastify";

import { buildApp } from "./app.ts";
import { describeEnvError, parseEnv, type NodeEnv } from "./config/env.ts";

/** Verbose while developing, quiet in tests, informative in production. */
const LOG_LEVEL_BY_ENV = {
  development: "debug",
  test: "silent",
  production: "info",
} as const satisfies Readonly<Record<NodeEnv, LogLevel>>;

const closeOnSignal =
  (app: FastifyInstance) =>
  (signal: NodeJS.Signals): void => {
    app.log.info({ signal }, "shutting down");
    app.close().then(
      () => process.exit(0),
      (error: unknown) => {
        app.log.error({ err: error }, "shutdown failed");
        process.exit(1);
      },
    );
  };

const env = parseEnv(process.env);

if (!env.ok) {
  process.stderr.write(`${describeEnvError(env.error)}\n`);
  process.exit(1);
}

const app = await buildApp({ logLevel: LOG_LEVEL_BY_ENV[env.value.NODE_ENV] });

process.once("SIGINT", closeOnSignal(app));
process.once("SIGTERM", closeOnSignal(app));

try {
  await app.listen({ host: env.value.HOST, port: env.value.PORT });
} catch (error) {
  app.log.fatal({ err: error }, "server failed to start");
  process.exit(1);
}
