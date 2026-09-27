import { describe, expect, it } from "vitest";

import {
  createTelegramClient,
  isKeyboardRejection,
  isRetryable,
  type TelegramError,
} from "./client.ts";
import { telegramChatIdSchema } from "./ids.ts";

const TOKEN = "123456:test-token_value";
const CHAT_ID = telegramChatIdSchema.parse(42);

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

    const result = await client.sendMessage(CHAT_ID, "Ciao!");

    expect(result).toStrictEqual({ ok: true, value: { messageId: 1 } });
    expect(requests).toStrictEqual([
      {
        url: `https://api.telegram.org/bot${TOKEN}/sendMessage`,
        method: "POST",
        body: {
          chat_id: 42,
          text: "Ciao!",
          link_preview_options: { is_disabled: true },
        },
      },
    ]);
  });

  it("sends HTML when asked", async () => {
    const { fetchFn, requests } = fakeFetch(() =>
      jsonResponse(200, { ok: true, result: { message_id: 1 } }),
    );
    const client = createTelegramClient({ token: TOKEN, fetch: fetchFn });

    await client.sendMessage(CHAT_ID, "<b>Ciao</b>", { parseMode: "HTML" });

    expect(requests[0]?.body).toStrictEqual({
      chat_id: 42,
      text: "<b>Ciao</b>",
      link_preview_options: { is_disabled: true },
      parse_mode: "HTML",
    });
  });

  it("never sends half of an emoji, which Telegram refuses", async () => {
    const { fetchFn, requests } = fakeFetch(() =>
      jsonResponse(200, { ok: true, result: { message_id: 1 } }),
    );
    const client = createTelegramClient({ token: TOKEN, fetch: fetchFn });
    const half = "😀".slice(0, 1);

    await client.sendMessage(CHAT_ID, `Ciao ${half}`, {
      keyboard: [
        [{ type: "COPY", label: "📋", text: `Ok ${half}`, primary: false }],
      ],
    });

    expect(requests[0]?.body).toMatchObject({
      text: "Ciao �",
      reply_markup: {
        inline_keyboard: [[{ copy_text: { text: "Ok �" } }]],
      },
    });
  });

  it("sends buttons under a message, in reply to another one", async () => {
    const { fetchFn, requests } = fakeFetch(() =>
      jsonResponse(200, { ok: true, result: { message_id: 8 } }),
    );
    const client = createTelegramClient({ token: TOKEN, fetch: fetchFn });

    await client.sendMessage(CHAT_ID, "Proposte", {
      parseMode: "HTML",
      replyTo: 7,
      keyboard: [
        [
          {
            type: "COPY",
            label: "📋 Copia BEST",
            text: "Ciao <Mario> & co",
            primary: true,
          },
        ],
        [
          { type: "COPY", label: "📋 NATURAL", text: "Ciao!", primary: false },
          { type: "CALLBACK", label: "🔄 Altre 3", data: "1:more:F" },
        ],
      ],
    });

    expect(requests[0]?.body).toStrictEqual({
      chat_id: 42,
      text: "Proposte",
      link_preview_options: { is_disabled: true },
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "📋 Copia BEST",
              // Copied as written: the clipboard takes no HTML.
              copy_text: { text: "Ciao <Mario> & co" },
              style: "success",
            },
          ],
          [
            { text: "📋 NATURAL", copy_text: { text: "Ciao!" } },
            { text: "🔄 Altre 3", callback_data: "1:more:F" },
          ],
        ],
      },
      reply_parameters: { message_id: 7, allow_sending_without_reply: true },
    });
  });

  it.each([
    [undefined, { callback_query_id: "q1" }],
    [
      "⏳ Ci sto già lavorando",
      { callback_query_id: "q1", text: "⏳ Ci sto già lavorando" },
    ],
  ])("answers a button tap with %j", async (text, body) => {
    const { fetchFn, requests } = fakeFetch(() =>
      jsonResponse(200, { ok: true, result: true }),
    );
    const client = createTelegramClient({ token: TOKEN, fetch: fetchFn });

    expect(await client.answerCallbackQuery("q1", text)).toStrictEqual({
      ok: true,
      value: undefined,
    });
    expect(requests).toStrictEqual([
      {
        url: `https://api.telegram.org/bot${TOKEN}/answerCallbackQuery`,
        method: "POST",
        body,
      },
    ]);
  });

  it("reports a button tap answered too late", async () => {
    const { fetchFn } = fakeFetch(() =>
      jsonResponse(400, {
        ok: false,
        error_code: 400,
        description:
          "Bad Request: query is too old and response timeout expired or query ID is invalid",
      }),
    );
    const client = createTelegramClient({ token: TOKEN, fetch: fetchFn });

    expect(await client.answerCallbackQuery("q1")).toMatchObject({
      ok: false,
      error: { type: "API_ERROR", method: "answerCallbackQuery", status: 400 },
    });
  });

  it("shows that the bot is typing", async () => {
    const { fetchFn, requests } = fakeFetch(() =>
      jsonResponse(200, { ok: true, result: true }),
    );
    const client = createTelegramClient({ token: TOKEN, fetch: fetchFn });

    expect(await client.sendTyping(CHAT_ID)).toStrictEqual({
      ok: true,
      value: undefined,
    });
    expect(requests).toStrictEqual([
      {
        url: `https://api.telegram.org/bot${TOKEN}/sendChatAction`,
        method: "POST",
        body: { chat_id: 42, action: "typing" },
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
        allowedUpdates: null,
      },
    });
  });

  it("reads which updates the webhook receives", async () => {
    const { fetchFn } = fakeFetch(() =>
      jsonResponse(200, {
        ok: true,
        result: {
          url: "https://example.com/telegram/webhook",
          pending_update_count: 0,
          allowed_updates: ["message", "callback_query"],
        },
      }),
    );
    const client = createTelegramClient({ token: TOKEN, fetch: fetchFn });

    expect(await client.getWebhookInfo()).toMatchObject({
      ok: true,
      value: { allowedUpdates: ["message", "callback_query"] },
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

    expect(await client.sendMessage(CHAT_ID, "Ciao!")).toStrictEqual({
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

    expect(await client.sendMessage(CHAT_ID, "Ciao!")).toStrictEqual({
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

    const result = await client.sendMessage(CHAT_ID, "Ciao!");

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

    expect(await client.sendMessage(CHAT_ID, "Ciao!")).toStrictEqual({
      ok: false,
      error: { type: "NETWORK_ERROR", method: "sendMessage", timedOut: true },
    });
  });
});

describe("file downloads", () => {
  const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);

  const fileResponse = (
    body: Uint8Array | string,
    init: ResponseInit = {},
  ): Promise<Response> => Promise.resolve(new Response(body, init));

  it("resolves a file id to its download path", async () => {
    const { fetchFn, requests } = fakeFetch(() =>
      jsonResponse(200, {
        ok: true,
        result: {
          file_id: "abc",
          file_unique_id: "unique",
          file_size: 310_000,
          file_path: "photos/file_7.jpg",
        },
      }),
    );
    const client = createTelegramClient({ token: TOKEN, fetch: fetchFn });

    expect(await client.getFile("abc")).toStrictEqual({
      ok: true,
      value: { filePath: "photos/file_7.jpg", fileSize: 310_000 },
    });
    expect(requests).toStrictEqual([
      {
        url: `https://api.telegram.org/bot${TOKEN}/getFile`,
        method: "POST",
        body: { file_id: "abc" },
      },
    ]);
  });

  it("reports files Telegram cannot serve", async () => {
    const { fetchFn } = fakeFetch(() =>
      jsonResponse(200, {
        ok: true,
        result: { file_id: "abc", file_unique_id: "unique" },
      }),
    );
    const client = createTelegramClient({ token: TOKEN, fetch: fetchFn });

    expect(await client.getFile("abc")).toStrictEqual({
      ok: true,
      value: { filePath: null, fileSize: null },
    });
  });

  it("downloads a file into memory", async () => {
    const { fetchFn, requests } = fakeFetch(() => fileResponse(PNG_BYTES));
    const client = createTelegramClient({ token: TOKEN, fetch: fetchFn });

    const result = await client.downloadFile("photos/file_7.jpg", 1_000);

    expect(result).toStrictEqual({ ok: true, value: PNG_BYTES });
    expect(requests).toStrictEqual([
      {
        url: `https://api.telegram.org/file/bot${TOKEN}/photos/file_7.jpg`,
        method: "GET",
        body: undefined,
      },
    ]);
  });

  it("refuses a file declared larger than the limit", async () => {
    const { fetchFn } = fakeFetch(() =>
      fileResponse(PNG_BYTES, { headers: { "content-length": "5000" } }),
    );
    const client = createTelegramClient({ token: TOKEN, fetch: fetchFn });

    expect(await client.downloadFile("photos/file_7.jpg", 1_000)).toStrictEqual(
      {
        ok: false,
        error: {
          type: "FILE_TOO_LARGE",
          method: "downloadFile",
          maxBytes: 1_000,
        },
      },
    );
  });

  it("refuses a file larger than the limit", async () => {
    const { fetchFn } = fakeFetch(() => fileResponse(new Uint8Array(2_000)));
    const client = createTelegramClient({ token: TOKEN, fetch: fetchFn });

    expect(await client.downloadFile("photos/file_7.jpg", 1_000)).toStrictEqual(
      {
        ok: false,
        error: {
          type: "FILE_TOO_LARGE",
          method: "downloadFile",
          maxBytes: 1_000,
        },
      },
    );
  });

  it("returns errors of the file server", async () => {
    const { fetchFn } = fakeFetch(() =>
      fileResponse("Not Found", { status: 404, statusText: "Not Found" }),
    );
    const client = createTelegramClient({ token: TOKEN, fetch: fetchFn });

    expect(await client.downloadFile("photos/file_7.jpg", 1_000)).toStrictEqual(
      {
        ok: false,
        error: {
          type: "API_ERROR",
          method: "downloadFile",
          status: 404,
          description: "Not Found",
        },
      },
    );
  });

  it("reports download failures without leaking the token", async () => {
    const { fetchFn } = fakeFetch(() =>
      Promise.reject(
        new TypeError(
          `fetch failed: https://api.telegram.org/file/bot${TOKEN}`,
        ),
      ),
    );
    const client = createTelegramClient({ token: TOKEN, fetch: fetchFn });

    const result = await client.downloadFile("photos/file_7.jpg", 1_000);

    expect(result).toStrictEqual({
      ok: false,
      error: { type: "NETWORK_ERROR", method: "downloadFile", timedOut: false },
    });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
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
    [
      "a file above the limit",
      { type: "FILE_TOO_LARGE", method: "downloadFile", maxBytes: 1_000 },
      false,
    ],
  ] satisfies readonly (readonly [string, TelegramError, boolean])[])(
    "%s: %s",
    (_description, error, retryable) => {
      expect(isRetryable(error)).toBe(retryable);
    },
  );
});

describe("isKeyboardRejection", () => {
  const badRequest = (description: string): TelegramError => ({
    type: "API_ERROR",
    method: "sendMessage",
    status: 400,
    description,
  });

  it.each([
    "Bad Request: BUTTON_DATA_INVALID",
    "Bad Request: can't parse inline keyboard button: Text buttons are unallowed in the inline keyboard",
    "Bad Request: REPLY_MARKUP_TOO_LONG",
    'Bad Request: field "copy_text" must be of type Object',
  ])("recognizes %j", (description) => {
    expect(isKeyboardRejection(badRequest(description))).toBe(true);
  });

  it.each([
    badRequest("Bad Request: can't parse entities: Unclosed start tag"),
    badRequest("Bad Request: message is too long"),
    {
      type: "API_ERROR",
      method: "sendMessage",
      status: 500,
      description: "Internal Server Error: BUTTON_DATA_INVALID",
    },
    { type: "NETWORK_ERROR", method: "sendMessage", timedOut: true },
  ] satisfies readonly TelegramError[])(
    "does not blame the buttons for %j",
    (error) => {
      expect(isKeyboardRejection(error)).toBe(false);
    },
  );
});
