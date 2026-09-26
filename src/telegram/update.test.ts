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
          content: { type: "TEXT", text: "/start" },
        },
      },
    });
  });

  it("keeps messages without text, such as photos, as other content", () => {
    expect(
      parseUpdate(privateMessage({ photo: [{ file_id: "abc" }] })),
    ).toMatchObject({
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
