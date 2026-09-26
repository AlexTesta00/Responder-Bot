import { describe, expect, it } from "vitest";

import {
  createTelegramClient,
  isRetryable,
  type TelegramError,
} from "./client.ts";

const TOKEN = "123456:test-token_value";

type RecordedRequest = Readonly<{
  url: string;
  method: string | undefined;
  body: unknown;
}>;

const requestUrl = (input: Parameters<typeof fetch>[0]): string => {
  if (typeof input === "string") {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
};

/** Fake fetch that records requests and answers with `respond`. */
const fakeFetch = (respond: (init?: RequestInit) => Promise<Response>) => {
  const requests: RecordedRequest[] = [];
  const fetchFn: typeof fetch = (input, init) => {
    requests.push({
      url: requestUrl(input),
      method: init?.method,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    return respond(init);
  };
  return { fetchFn, requests };
};

const jsonResponse = (status: number, body: unknown): Promise<Response> =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );

describe("createTelegramClient", () => {
  it("sends a message through the Bot API", async () => {
    const { fetchFn, requests } = fakeFetch(() =>
      jsonResponse(200, { ok: true, result: { message_id: 1 } }),
    );
    const client = createTelegramClient({ token: TOKEN, fetch: fetchFn });

    const result = await client.sendMessage(42, "Ciao!");

    expect(result).toStrictEqual({ ok: true, value: undefined });
    expect(requests).toStrictEqual([
      {
        url: `https://api.telegram.org/bot${TOKEN}/sendMessage`,
        method: "POST",
        body: { chat_id: 42, text: "Ciao!" },
      },
    ]);
  });

  it("registers a webhook with its secret and update types", async () => {
    const { fetchFn, requests } = fakeFetch(() =>
      jsonResponse(200, { ok: true, result: true }),
    );
    const client = createTelegramClient({ token: TOKEN, fetch: fetchFn });

    const result = await client.setWebhook({
      url: "https://example.com/telegram/webhook",
      secretToken: "s".repeat(32),
      allowedUpdates: ["message"],
      dropPendingUpdates: true,
    });

    expect(result).toStrictEqual({ ok: true, value: undefined });
    expect(requests[0]?.body).toStrictEqual({
      url: "https://example.com/telegram/webhook",
      secret_token: "s".repeat(32),
      allowed_updates: ["message"],
      drop_pending_updates: true,
    });
  });

  it("reads the webhook status", async () => {
    const { fetchFn } = fakeFetch(() =>
      jsonResponse(200, {
        ok: true,
        result: {
          url: "https://example.com/telegram/webhook",
          has_custom_certificate: false,
          pending_update_count: 2,
          last_error_message: "Connection refused",
        },
      }),
    );
    const client = createTelegramClient({ token: TOKEN, fetch: fetchFn });

    expect(await client.getWebhookInfo()).toStrictEqual({
      ok: true,
      value: {
        url: "https://example.com/telegram/webhook",
        pendingUpdateCount: 2,
        lastErrorMessage: "Connection refused",
      },
    });
  });

  it("returns errors reported by the Bot API", async () => {
    const { fetchFn } = fakeFetch(() =>
      jsonResponse(403, {
        ok: false,
        error_code: 403,
        description: "Forbidden: bot was blocked by the user",
      }),
    );
    const client = createTelegramClient({ token: TOKEN, fetch: fetchFn });

    expect(await client.sendMessage(42, "Ciao!")).toStrictEqual({
      ok: false,
      error: {
        type: "API_ERROR",
        method: "sendMessage",
        status: 403,
        description: "Forbidden: bot was blocked by the user",
      },
    });
  });

  it("rejects responses that are not Bot API responses", async () => {
    const { fetchFn } = fakeFetch(() =>
      Promise.resolve(
        new Response("<html>Bad gateway</html>", { status: 502 }),
      ),
    );
    const client = createTelegramClient({ token: TOKEN, fetch: fetchFn });

    expect(await client.sendMessage(42, "Ciao!")).toStrictEqual({
      ok: false,
      error: { type: "INVALID_RESPONSE", method: "sendMessage", status: 502 },
    });
  });

  it("rejects results with an unexpected shape", async () => {
    const { fetchFn } = fakeFetch(() =>
      jsonResponse(200, { ok: true, result: { url: 42 } }),
    );
    const client = createTelegramClient({ token: TOKEN, fetch: fetchFn });

    expect(await client.getWebhookInfo()).toMatchObject({
      ok: false,
      error: { type: "INVALID_RESPONSE", method: "getWebhookInfo" },
    });
  });

  it("reports network failures without leaking the token", async () => {
    const { fetchFn } = fakeFetch(() =>
      Promise.reject(
        new TypeError(`fetch failed: https://api.telegram.org/bot${TOKEN}`),
      ),
    );
    const client = createTelegramClient({ token: TOKEN, fetch: fetchFn });

    const result = await client.sendMessage(42, "Ciao!");

    expect(result).toStrictEqual({
      ok: false,
      error: { type: "NETWORK_ERROR", method: "sendMessage", timedOut: false },
    });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("gives up when the Bot API does not answer in time", async () => {
    const { fetchFn } = fakeFetch(
      (init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            // Like the real fetch, fail with the signal's reason.
            const reason: unknown = init.signal?.reason;
            reject(reason instanceof Error ? reason : new Error("aborted"));
          });
        }),
    );
    const client = createTelegramClient({
      token: TOKEN,
      fetch: fetchFn,
      timeoutMs: 10,
    });

    expect(await client.sendMessage(42, "Ciao!")).toStrictEqual({
      ok: false,
      error: { type: "NETWORK_ERROR", method: "sendMessage", timedOut: true },
    });
  });
});

describe("isRetryable", () => {
  const apiError = (status: number): TelegramError => ({
    type: "API_ERROR",
    method: "sendMessage",
    status,
    description: "error",
  });

  it.each([
    [
      "a network failure",
      { type: "NETWORK_ERROR", method: "sendMessage", timedOut: false },
      true,
    ],
    ["rate limiting", apiError(429), true],
    ["a Bot API server error", apiError(500), true],
    ["a bad request", apiError(400), false],
    ["a blocked bot", apiError(403), false],
    [
      "a gateway error page",
      { type: "INVALID_RESPONSE", method: "sendMessage", status: 502 },
      true,
    ],
    [
      "a malformed success",
      { type: "INVALID_RESPONSE", method: "sendMessage", status: 200 },
      false,
    ],
  ] satisfies readonly (readonly [string, TelegramError, boolean])[])(
    "%s: %s",
    (_description, error, retryable) => {
      expect(isRetryable(error)).toBe(retryable);
    },
  );
});
