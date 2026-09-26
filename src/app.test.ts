import type { FastifyInstance } from "fastify";
import { describe, expect, it, onTestFinished } from "vitest";
import { z } from "zod";

import { buildApp } from "./app.ts";
import type { TelegramWebhookOptions } from "./routes/telegram-webhook.ts";

const telegramWebhook: TelegramWebhookOptions = {
  secret: "test-webhook-secret-0123456789abcdef",
  handleUpdate: () => Promise.resolve({ type: "REPLIED", input: "COMMAND" }),
};

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
    telegramWebhook,
  });
  onTestFinished(() => app.close());
  return { app, logLines };
};

describe("GET /health", () => {
  it("reports that the process is alive", async () => {
    const app = await buildApp({ logLevel: "silent", telegramWebhook });
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

describe("error handling", () => {
  it("hides the details of unexpected errors from the response", async () => {
    const { app, logLines } = await buildAppWithLogs();
    app.get("/failing", () => {
      throw new Error("internal detail that must not leak");
    });

    const response = await app.inject({ method: "GET", url: "/failing" });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toStrictEqual({
      statusCode: 500,
      error: "Internal Server Error",
      message: "Internal Server Error",
    });
    expect(logLines.join("\n")).toContain("internal detail that must not leak");
  });

  it("describes errors caused by the request", async () => {
    const { app } = await buildAppWithLogs();

    const response = await app.inject({
      method: "POST",
      url: "/telegram/webhook",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": telegramWebhook.secret,
      },
      payload: "{not json",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      statusCode: 400,
      error: "Bad Request",
    });
    expect(response.body).toContain("JSON");
  });
});
