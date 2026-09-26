import { z } from "zod";

import { err, ok, type Result } from "../shared/result.ts";
import type { TelegramChatId } from "./ids.ts";

const API_BASE_URL = "https://api.telegram.org";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 30_000;

export type TelegramMethod =
  | "sendMessage"
  | "sendChatAction"
  | "answerCallbackQuery"
  | "setWebhook"
  | "getWebhookInfo"
  | "getFile"
  | "downloadFile";

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
    }>
  | Readonly<{
      type: "FILE_TOO_LARGE";
      method: TelegramMethod;
      maxBytes: number;
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
    case "FILE_TOO_LARGE":
      return false;
  }
};

/**
 * Whether Telegram refused the buttons of a message rather than its text:
 * the message can then be sent again without them. Telegram does not
 * document these descriptions, so this reads them loosely.
 */
export const isKeyboardRejection = (error: TelegramError): boolean =>
  error.type === "API_ERROR" &&
  error.status === 400 &&
  /button|markup|copy_text/i.test(error.description);

export type WebhookInfo = Readonly<{
  url: string;
  pendingUpdateCount: number;
  lastErrorMessage: string | null;
  /** The update types the webhook receives; null means Telegram's default. */
  allowedUpdates: readonly string[] | null;
}>;

export type SetWebhookOptions = Readonly<{
  url: string;
  secretToken: string;
  allowedUpdates: readonly string[];
  dropPendingUpdates: boolean;
}>;

export type TelegramFile = Readonly<{
  /** Where the file can be downloaded; missing when Telegram cannot serve it. */
  filePath: string | null;
  fileSize: number | null;
}>;

/** A message the bot sent, to recognize the replies to it. */
export type SentMessage = Readonly<{ messageId: number }>;

/** A button under a message. */
export type InlineButton =
  /** Copies `text` to the clipboard, in the client, without telling the bot. */
  | Readonly<{ type: "COPY"; label: string; text: string; primary: boolean }>
  /** Sends `data` (1-64 bytes) back to the bot as a callback query. */
  | Readonly<{ type: "CALLBACK"; label: string; data: string }>;

/** Rows of buttons, top to bottom. */
export type InlineKeyboard = readonly (readonly InlineButton[])[];

export type SendOptions = Readonly<{
  /** HTML with Telegram's formatting tags, instead of plain text. */
  parseMode?: "HTML";
  keyboard?: InlineKeyboard;
  /** The message of the chat this one answers. */
  replyTo?: number;
}>;

export type TelegramClient = Readonly<{
  sendMessage: (
    chatId: TelegramChatId,
    text: string,
    options?: SendOptions,
  ) => Promise<Result<SentMessage, TelegramError>>;
  /** Shows "typing…" in the chat for a few seconds, or until a message arrives. */
  sendTyping: (chatId: TelegramChatId) => Promise<Result<void, TelegramError>>;
  /**
   * Stops the loading indicator of a button, optionally with a short notice
   * (at most 200 characters) at the top of the chat.
   */
  answerCallbackQuery: (
    queryId: string,
    text?: string,
  ) => Promise<Result<void, TelegramError>>;
  setWebhook: (
    options: SetWebhookOptions,
  ) => Promise<Result<void, TelegramError>>;
  getWebhookInfo: () => Promise<Result<WebhookInfo, TelegramError>>;
  getFile: (fileId: string) => Promise<Result<TelegramFile, TelegramError>>;
  /** Downloads a file into memory, refusing anything above `maxBytes`. */
  downloadFile: (
    filePath: string,
    maxBytes: number,
  ) => Promise<Result<Uint8Array, TelegramError>>;
}>;

export type TelegramClientOptions = Readonly<{
  token: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  downloadTimeoutMs?: number;
}>;

const apiResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), result: z.unknown() }),
  z.object({
    ok: z.literal(false),
    error_code: z.number().int(),
    description: z.string(),
  }),
]);

const sentMessageSchema = z
  .object({ message_id: z.number().int() })
  .transform((message): SentMessage => ({ messageId: message.message_id }));

const webhookInfoSchema = z
  .object({
    url: z.string(),
    pending_update_count: z.number().int(),
    last_error_message: z.string().optional(),
    allowed_updates: z.array(z.string()).optional(),
  })
  .transform((info): WebhookInfo => ({
    url: info.url,
    pendingUpdateCount: info.pending_update_count,
    lastErrorMessage: info.last_error_message ?? null,
    allowedUpdates: info.allowed_updates ?? null,
  }));

const buttonParams = (button: InlineButton): Record<string, unknown> => {
  switch (button.type) {
    case "COPY":
      return {
        text: button.label,
        copy_text: { text: button.text },
        // Green on the clients that support button styles (Bot API 9.4).
        ...(button.primary ? { style: "success" } : {}),
      };
    case "CALLBACK":
      return { text: button.label, callback_data: button.data };
  }
};

/** The body of sendMessage: options appear only when they are given. */
const messageParams = (
  chatId: TelegramChatId,
  text: string,
  { parseMode, keyboard, replyTo }: SendOptions = {},
): Record<string, unknown> => ({
  chat_id: chatId,
  text,
  ...(parseMode === undefined ? {} : { parse_mode: parseMode }),
  ...(keyboard === undefined
    ? {}
    : {
        reply_markup: {
          inline_keyboard: keyboard.map((row) => row.map(buttonParams)),
        },
      }),
  ...(replyTo === undefined
    ? {}
    : {
        // Still delivered if Alex deleted the message it answers.
        reply_parameters: {
          message_id: replyTo,
          allow_sending_without_reply: true,
        },
      }),
});

const fileSchema = z
  .object({
    file_path: z.string().min(1).optional(),
    file_size: z.number().int().nonnegative().optional(),
  })
  .transform((file): TelegramFile => ({
    filePath: file.file_path ?? null,
    fileSize: file.file_size ?? null,
  }));

type Delivery =
  | Readonly<{ delivered: true; response: Response }>
  | Readonly<{ delivered: false; timedOut: boolean }>;

type Download =
  | Readonly<{ read: true; bytes: Uint8Array }>
  | Readonly<{ read: false; timedOut: boolean }>;

const isTimeout = (error: unknown): boolean =>
  error instanceof DOMException && error.name === "TimeoutError";

const readJson = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
};

const readBytes = async (response: Response): Promise<Download> => {
  try {
    return { read: true, bytes: new Uint8Array(await response.arrayBuffer()) };
  } catch (error) {
    return { read: false, timedOut: isTimeout(error) };
  }
};

/** Minimal Bot API client. Failures are returned as values, never thrown. */
export const createTelegramClient = ({
  token,
  fetch: fetchFn = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  downloadTimeoutMs = DEFAULT_DOWNLOAD_TIMEOUT_MS,
}: TelegramClientOptions): TelegramClient => {
  // Every URL contains the bot token: errors are reduced to what went wrong,
  // never to their message, which may quote the URL.
  const send = async (
    url: string,
    init: RequestInit,
    timeout: number,
  ): Promise<Delivery> => {
    try {
      const response = await fetchFn(url, {
        ...init,
        signal: AbortSignal.timeout(timeout),
      });
      return { delivered: true, response };
    } catch (error) {
      return { delivered: false, timedOut: isTimeout(error) };
    }
  };

  const call = async <T>(
    method: TelegramMethod,
    params: Readonly<Record<string, unknown>>,
    resultSchema: z.ZodType<T>,
  ): Promise<Result<T, TelegramError>> => {
    const delivery = await send(
      `${API_BASE_URL}/bot${token}/${method}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(params),
      },
      timeoutMs,
    );
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

  const downloadFile = async (
    filePath: string,
    maxBytes: number,
  ): Promise<Result<Uint8Array, TelegramError>> => {
    const method = "downloadFile";
    const delivery = await send(
      `${API_BASE_URL}/file/bot${token}/${filePath}`,
      { method: "GET" },
      downloadTimeoutMs,
    );
    if (!delivery.delivered) {
      return err({
        type: "NETWORK_ERROR",
        method,
        timedOut: delivery.timedOut,
      });
    }

    const { response } = delivery;
    if (!response.ok) {
      await response.body?.cancel();
      return err({
        type: "API_ERROR",
        method,
        status: response.status,
        description: response.statusText,
      });
    }
    // Refuse early when the declared size is already too large.
    if (Number(response.headers.get("content-length")) > maxBytes) {
      await response.body?.cancel();
      return err({ type: "FILE_TOO_LARGE", method, maxBytes });
    }

    const download = await readBytes(response);
    if (!download.read) {
      return err({
        type: "NETWORK_ERROR",
        method,
        timedOut: download.timedOut,
      });
    }
    return download.bytes.byteLength > maxBytes
      ? err({ type: "FILE_TOO_LARGE", method, maxBytes })
      : ok(download.bytes);
  };

  const withoutValue = <T>(
    result: Result<T, TelegramError>,
  ): Result<void, TelegramError> => (result.ok ? ok(undefined) : result);

  return {
    sendMessage: (chatId, text, options) =>
      call(
        "sendMessage",
        messageParams(chatId, text, options),
        sentMessageSchema,
      ),
    sendTyping: async (chatId) =>
      withoutValue(
        await call(
          "sendChatAction",
          { chat_id: chatId, action: "typing" },
          z.literal(true),
        ),
      ),
    answerCallbackQuery: async (queryId, text) =>
      withoutValue(
        await call(
          "answerCallbackQuery",
          text === undefined
            ? { callback_query_id: queryId }
            : { callback_query_id: queryId, text },
          z.literal(true),
        ),
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
    getFile: (fileId) => call("getFile", { file_id: fileId }, fileSchema),
    downloadFile,
  };
};
