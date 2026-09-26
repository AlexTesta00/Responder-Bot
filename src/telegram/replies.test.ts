import { describe, expect, it } from "vitest";

import { classifyText } from "../inputs/classify.ts";
import { imageProblemReply, replyTo, type InstantInput } from "./replies.ts";

/** The reply to a text the bot answers at once. */
const replyToText = (text: string): string => {
  const input = classifyText(text);
  if (input.type === "TEXT" || input.type === "CREDIT") {
    expect.unreachable(`${text} is not answered from the input alone`);
  }
  return replyTo(input satisfies InstantInput);
};

describe("replyTo", () => {
  it("introduces the bot and what it suggests on /start", () => {
    const reply = replyToText("/start");

    expect(reply).toContain("copilota per l'outreach");
    expect(reply).toContain("primi messaggi");
    expect(reply).toContain("/help");
  });

  it("lists the commands on /help", () => {
    const reply = replyToText("/help");

    expect(reply).toContain("/start");
    expect(reply).toContain("/help");
    expect(reply).toContain("/credito 25,40");
  });

  it("points unknown commands to /help", () => {
    expect(replyToText("/unknown")).toContain("/help");
  });

  it("asks for screenshots of a recognized profile", () => {
    const reply = replyToText("https://www.instagram.com/mariofit/");

    expect(reply).toContain("@mariofit");
    expect(reply).toContain("screenshot");
  });

  it("acknowledges a link and asks for the profile", () => {
    expect(replyToText("https://mariofit.it")).toContain("Link ricevuto");
  });

  it("lists what the bot can read for unsupported messages", () => {
    expect(replyTo({ type: "UNSUPPORTED" })).toContain("screenshot");
  });
});

describe("imageProblemReply", () => {
  it.each([
    [{ type: "IMAGE_TOO_LARGE" } as const, "troppo grande"],
    [{ type: "UNSUPPORTED_IMAGE_FORMAT" } as const, "formato"],
    [{ type: "DOWNLOAD_FAILED", reason: "test" } as const, "Riprova"],
  ])("explains %j", (error, expected) => {
    expect(imageProblemReply(error)).toContain(expected);
  });
});
