import { describe, expect, it } from "vitest";

import { replyTo } from "./commands.ts";
import type { MessageContent } from "./update.ts";

const text = (value: string): MessageContent => ({ type: "TEXT", text: value });

describe("replyTo", () => {
  it("introduces the bot on /start", () => {
    const reply = replyTo(text("/start"));

    expect(reply).toContain("copilota per l'outreach");
    expect(reply).toContain("/help");
  });

  it("lists the available commands on /help", () => {
    const reply = replyTo(text("/help"));

    expect(reply).toContain("/start");
    expect(reply).toContain("/help");
  });

  it.each([
    ["/start", "/start@AlexOutreachBot"],
    ["/start", "/start campaign-42"],
    ["/start", "  /start  "],
    ["/help", "/HELP"],
  ])("answers %s written as %j", (command, variant) => {
    expect(replyTo(text(variant))).toBe(replyTo(text(command)));
  });

  it.each(["ciao", "start", "/startup", "/unknown", "help me /help"])(
    "points %j to the available commands",
    (value) => {
      expect(replyTo(text(value))).toContain("Per ora capisco solo");
    },
  );

  it("points non-text messages to the available commands", () => {
    expect(replyTo({ type: "OTHER" })).toContain("Per ora capisco solo");
  });
});
