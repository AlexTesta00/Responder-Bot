import { describe, expect, it } from "vitest";

import { classifyText } from "../inputs/classify.ts";
import { imageProblemReply, replyTo } from "./replies.ts";

const replyToText = (text: string): string => replyTo(classifyText(text));

describe("replyTo", () => {
  it("introduces the bot and what it accepts on /start", () => {
    const reply = replyToText("/start");

    expect(reply).toContain("copilota per l'outreach");
    expect(reply).toContain("screenshot");
    expect(reply).toContain("/help");
  });

  it("lists the commands on /help", () => {
    const reply = replyToText("/help");

    expect(reply).toContain("/start");
    expect(reply).toContain("/help");
  });

  it("points unknown commands to /help", () => {
    expect(replyToText("/unknown")).toContain("/help");
  });

  it("asks for screenshots of a recognized profile", () => {
    const reply = replyToText("https://www.instagram.com/mariofit/");

    expect(reply).toContain("@mariofit");
    expect(reply).toContain("screenshot");
  });

  it.each([
    ["a link", "https://mariofit.it", "Link ricevuto"],
    ["a text", "Ciao, ci sentiamo domani", "Testo ricevuto"],
  ])("acknowledges %s", (_description, text, expected) => {
    expect(replyToText(text)).toContain(expected);
  });

  it.each([
    [1, "Screenshot ricevuto"],
    [3, "3 screenshot ricevuti"],
  ])("acknowledges %i screenshots", (count, expected) => {
    const images = Array.from({ length: count }, (_, index) => ({
      fileId: String(index),
      fileSize: null,
    }));

    expect(replyTo({ type: "SCREENSHOTS", images, caption: null })).toContain(
      expected,
    );
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
