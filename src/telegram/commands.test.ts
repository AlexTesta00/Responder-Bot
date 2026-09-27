import { describe, expect, it } from "vitest";

import { classifyText } from "../inputs/classify.ts";
import { BOT_COMMANDS, MENU_COMMANDS } from "./commands.ts";
import { replyTo } from "./replies.ts";

describe("BOT_COMMANDS", () => {
  it.each(BOT_COMMANDS)("knows /$command", ({ command }) => {
    expect(classifyText(`/${command}`).type).not.toBe("UNKNOWN_COMMAND");
  });

  it.each(BOT_COMMANDS)("explains /$command in /help", ({ help }) => {
    expect(replyTo({ type: "COMMAND", command: "help" })).toContain(help);
  });

  it("lists every command once, /start only in /help", () => {
    expect(BOT_COMMANDS.map(({ command }) => command)).toStrictEqual([
      "oggi",
      "followup",
      "prospect",
      "nuovo",
      "lista",
      "credito",
      "start",
      "help",
    ]);
    expect(MENU_COMMANDS.map(({ command }) => command)).not.toContain("start");
  });

  it.each(MENU_COMMANDS)(
    "names /$command as Telegram's menu wants it",
    ({ command, description }) => {
      expect(command).toMatch(/^[a-z0-9_]{1,32}$/);
      expect(description.length).toBeGreaterThan(0);
      expect(description.length).toBeLessThanOrEqual(256);
    },
  );
});
