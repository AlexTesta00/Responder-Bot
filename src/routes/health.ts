import type { FastifyPluginCallback } from "fastify";

type HealthResponse = Readonly<{ status: "ok" }>;

/** Liveness probe: answers as long as the process can serve HTTP requests. */
export const healthRoutes: FastifyPluginCallback = (app, _options, done) => {
  app.get<{ Reply: HealthResponse }>("/health", () => ({ status: "ok" }));
  done();
};
