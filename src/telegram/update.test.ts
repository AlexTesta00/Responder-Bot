import { describe, expect, it } from "vitest";

import { parseUpdate } from "./update.ts";

// Shaped like real Bot API payloads, including fields the bot ignores.
const privateMessage = (fields: Record<string, unknown>) => ({
  update_id: 100,
  message: {
    message_id: 7,
    from: { id: 42, is_bot: false, first_name: "Alex", language_code: "it" },
    chat: { id: 42, first_name: "Alex", type: "private" },
    date: 1_790_400_000,
    ...fields,
  },
});

describe("parseUpdate", () => {
  it("parses a text message", () => {
    expect(
      parseUpdate(
        privateMessage({
          text: "/start",
          entities: [{ offset: 0, length: 6, type: "bot_command" }],
        }),
      ),
    ).toStrictEqual({
      ok: true,
      value: {
        type: "MESSAGE",
        updateId: 100,
        message: {
          chatId: 42,
          chatType: "private",
          senderId: 42,
          content: { type: "TEXT", text: "/start", replyTo: null },
        },
      },
    });
  });

  it("knows which message a text replies to", () => {
    expect(
      parseUpdate(
        privateMessage({
          text: "Quanto costa?",
          reply_to_message: { message_id: 1_234, text: "..." },
        }),
      ),
    ).toMatchObject({
      ok: true,
      value: {
        message: {
          content: { type: "TEXT", text: "Quanto costa?", replyTo: 1_234 },
        },
      },
    });
  });

  it("parses a photo, keeping its largest size", () => {
    expect(
      parseUpdate(
        privateMessage({
          photo: [
            { file_id: "small", width: 90, height: 195, file_size: 1_200 },
            { file_id: "large", width: 1170, height: 2532, file_size: 310_000 },
            { file_id: "medium", width: 590, height: 1280, file_size: 80_000 },
          ],
        }),
      ),
    ).toMatchObject({
      ok: true,
      value: {
        message: {
          content: {
            type: "IMAGE",
            image: { fileId: "large", fileSize: 310_000 },
            caption: null,
            mediaGroupId: null,
          },
        },
      },
    });
  });

  it("keeps the caption and the album of a photo", () => {
    expect(
      parseUpdate(
        privateMessage({
          photo: [{ file_id: "large", width: 1170, height: 2532 }],
          caption: "profilo di Mario",
          media_group_id: "13579",
        }),
      ),
    ).toMatchObject({
      ok: true,
      value: {
        message: {
          content: {
            type: "IMAGE",
            image: { fileId: "large", fileSize: null },
            caption: "profilo di Mario",
            mediaGroupId: "13579",
          },
        },
      },
    });
  });

  it("parses an image sent as a file", () => {
    expect(
      parseUpdate(
        privateMessage({
          document: {
            file_id: "screenshot",
            file_name: "IMG_0001.PNG",
            mime_type: "image/png",
            file_size: 1_500_000,
          },
        }),
      ),
    ).toMatchObject({
      ok: true,
      value: {
        message: {
          content: {
            type: "IMAGE",
            image: { fileId: "screenshot", fileSize: 1_500_000 },
          },
        },
      },
    });
  });

  it.each([
    ["a sticker", { sticker: { file_id: "sticker", type: "regular" } }],
    ["a voice message", { voice: { file_id: "voice", duration: 3 } }],
    ["a PDF", { document: { file_id: "offer", mime_type: "application/pdf" } }],
  ])("keeps %s as other content", (_description, fields) => {
    expect(parseUpdate(privateMessage(fields))).toMatchObject({
      ok: true,
      value: { type: "MESSAGE", message: { content: { type: "OTHER" } } },
    });
  });

  it("marks updates without a message as unsupported", () => {
    expect(
      parseUpdate({ update_id: 101, edited_message: { text: "edit" } }),
    ).toStrictEqual({
      ok: true,
      value: { type: "UNSUPPORTED", updateId: 101 },
    });
  });

  it("marks messages without a sender as unsupported", () => {
    expect(
      parseUpdate({
        update_id: 102,
        message: { chat: { id: -100, type: "channel" }, text: "post" },
      }),
    ).toStrictEqual({
      ok: true,
      value: { type: "UNSUPPORTED", updateId: 102 },
    });
  });

  it.each([
    ["null", null],
    ["a string", "update"],
    ["an empty object", {}],
    ["a textual update_id", { update_id: "100" }],
    ["a negative update_id", { update_id: -1 }],
    [
      "an unknown chat type",
      { update_id: 100, message: { chat: { id: 1, type: "forum" } } },
    ],
  ])("rejects %s", (_description, payload) => {
    expect(parseUpdate(payload)).toMatchObject({
      ok: false,
      error: { type: "INVALID_UPDATE" },
    });
  });

  it("reports which fields are invalid without their values", () => {
    const result = parseUpdate({
      update_id: 100,
      message: { chat: { id: 1, type: "secret-looking-value" } },
    });

    expect(result).toStrictEqual({
      ok: false,
      error: { type: "INVALID_UPDATE", fields: ["message.chat.type"] },
    });
  });
});
