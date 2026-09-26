import { z } from "zod";

import { err, ok, type Result } from "../shared/result.ts";
import type { TelegramChatId } from "./ids.ts";

const API_BASE_URL = "https://api.telegram.org";
const DEFAULT_TIMEOUT_MS = 10_000;

export type TelegramMethod = "sendMessage" | "setWebhook" | "getWebhookInfo";

export type TelegramError =
  | Readonly<{
      type: "NETWORK_ERROR";
      method: TelegramMethod;
      timedOut: boolean;
    }>
  | Readonly<{
      type: "API_ERROR";
      method: TelegramMethod;
      status: number;
      description: string;
    }>
  | Readonly<{
      type: "INVALID_RESPONSE";
      method: TelegramMethod;
      status: number;
    }>;

/** Whether repeating the same call later may succeed. */
export const isRetryable = (error: TelegramError): boolean => {
  switch (error.type) {
    case "NETWORK_ERROR":
      return true;
    case "API_ERROR":
      return error.status === 429 || error.status >= 500;
    case "INVALID_RESPONSE":
      return error.status >= 500;
  }
};

export type WebhookInfo = Readonly<{
  url: string;
  pendingUpdateCount: number;
  lastErrorMessage: string | null;
}>;

export type SetWebhookOptions = Readonly<{
  url: string;
  secretToken: string;
  allowedUpdates: readonly string[];
  dropPendingUpdates: boolean;
}>;

export type TelegramClient = Readonly<{
  sendMessage: (
    chatId: TelegramChatId,
    text: string,
  ) => Promise<Result<void, TelegramError>>;
  setWebhook: (
    options: SetWebhookOptions,
  ) => Promise<Result<void, TelegramError>>;
  getWebhookInfo: () => Promise<Result<WebhookInfo, TelegramError>>;
}>;

export type TelegramClientOptions = Readonly<{
  token: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}>;

const apiResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), result: z.unknown() }),
  z.object({
    ok: z.literal(false),
    error_code: z.number().int(),
    description: z.string(),
  }),
]);

const webhookInfoSchema = z
  .object({
    url: z.string(),
    pending_update_count: z.number().int(),
    last_error_message: z.string().optional(),
  })
  .transform((info): WebhookInfo => ({
    url: info.url,
    pendingUpdateCount: info.pending_update_count,
    lastErrorMessage: info.last_error_message ?? null,
  }));

type Delivery =
  | Readonly<{ delivered: true; response: Response }>
  | Readonly<{ delivered: false; timedOut: boolean }>;

const readJson = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
};

/** Minimal Bot API client. Failures are returned as values, never thrown. */
export const createTelegramClient = ({
  token,
  fetch: fetchFn = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: TelegramClientOptions): TelegramClient => {
  const post = async (
    method: TelegramMethod,
    params: Readonly<Record<string, unknown>>,
  ): Promise<Delivery> => {
    try {
      const response = await fetchFn(`${API_BASE_URL}/bot${token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(timeoutMs),
      });
      return { delivered: true, response };
    } catch (error) {
      // The error is dropped on purpose: its message may contain the request
      // URL, and with it the bot token.
      return {
        delivered: false,
        timedOut:
          error instanceof DOMException && error.name === "TimeoutError",
      };
    }
  };

  const call = async <T>(
    method: TelegramMethod,
    params: Readonly<Record<string, unknown>>,
    resultSchema: z.ZodType<T>,
  ): Promise<Result<T, TelegramError>> => {
    const delivery = await post(method, params);
    if (!delivery.delivered) {
      return err({
        type: "NETWORK_ERROR",
        method,
        timedOut: delivery.timedOut,
      });
    }

    const { status } = delivery.response;
    const body = apiResponseSchema.safeParse(await readJson(delivery.response));
    if (!body.success) {
      return err({ type: "INVALID_RESPONSE", method, status });
    }
    if (!body.data.ok) {
      return err({
        type: "API_ERROR",
        method,
        status: body.data.error_code,
        description: body.data.description,
      });
    }

    const result = resultSchema.safeParse(body.data.result);
    return result.success
      ? ok(result.data)
      : err({ type: "INVALID_RESPONSE", method, status });
  };

  const withoutValue = <T>(
    result: Result<T, TelegramError>,
  ): Result<void, TelegramError> => (result.ok ? ok(undefined) : result);

  return {
    sendMessage: async (chatId, text) =>
      withoutValue(
        await call("sendMessage", { chat_id: chatId, text }, z.unknown()),
      ),
    setWebhook: async (options) =>
      withoutValue(
        await call(
          "setWebhook",
          {
            url: options.url,
            secret_token: options.secretToken,
            allowed_updates: options.allowedUpdates,
            drop_pending_updates: options.dropPendingUpdates,
          },
          z.literal(true),
        ),
      ),
    getWebhookInfo: () => call("getWebhookInfo", {}, webhookInfoSchema),
  };
};
