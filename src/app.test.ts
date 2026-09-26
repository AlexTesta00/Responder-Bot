import type { FastifyInstance } from "fastify";
import { describe, expect, it, onTestFinished } from "vitest";
import { z } from "zod";

import { buildApp } from "./app.ts";

type AppWithLogs = Readonly<{
  app: FastifyInstance;
  logLines: readonly string[];
}>;

/** Builds an app that logs at info level into memory; closed after the test. */
const buildAppWithLogs = async (): Promise<AppWithLogs> => {
  const logLines: string[] = [];
  const app = await buildApp({
    logLevel: "info",
    logStream: {
      write: (line) => {
        logLines.push(line);
      },
    },
  });
  onTestFinished(() => app.close());
  return { app, logLines };
};

describe("GET /health", () => {
  it("reports that the process is alive", async () => {
    const app = await buildApp({ logLevel: "silent" });
    onTestFinished(() => app.close());

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toMatch(/^application\/json/);
    expect(response.json()).toStrictEqual({ status: "ok" });
  });
});

describe("request logging", () => {
  const requestLogSchema = z.object({ msg: z.string(), request_id: z.uuid() });

  it("logs each request under its own request_id", async () => {
    const { app, logLines } = await buildAppWithLogs();

    await app.inject({ method: "GET", url: "/health" });
    await app.inject({ method: "GET", url: "/health" });

    const entries = logLines.map((line) =>
      requestLogSchema.parse(JSON.parse(line)),
    );
    const requestIds = entries.map((entry) => entry.request_id);

    expect(entries.map((entry) => entry.msg)).toStrictEqual([
      "incoming request",
      "request completed",
      "incoming request",
      "request completed",
    ]);
    expect(requestIds[0]).toBe(requestIds[1]);
    expect(requestIds[2]).toBe(requestIds[3]);
    expect(new Set(requestIds).size).toBe(2);
  });

  it("keeps request headers out of the logs", async () => {
    const { app, logLines } = await buildAppWithLogs();

    await app.inject({
      method: "GET",
      url: "/health",
      headers: {
        authorization: "Bearer header-secret",
        "x-telegram-bot-api-secret-token": "header-secret",
      },
    });

    expect(logLines).not.toHaveLength(0);
    expect(logLines.join("\n")).not.toContain("header-secret");
  });
});
