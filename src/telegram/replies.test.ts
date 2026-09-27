import { describe, expect, it } from "vitest";

import { classifyText } from "../inputs/classify.ts";
import {
  imageProblemReply,
  profileHint,
  PROSPECT_USAGE,
  replyTo,
  unknownProspectReply,
  type InstantInput,
} from "./replies.ts";

/** The reply to a text the bot answers at once. */
const replyToText = (text: string): string => {
  const input = classifyText(text);
  switch (input.type) {
    case "TEXT":
    case "CREDIT":
    case "TODAY":
    case "FOLLOW_UPS":
    case "FOLLOW_UP_FOR":
    case "NEW_PROSPECTS":
    case "LIST":
    case "PROSPECT":
    case "INSTAGRAM_PROFILE":
      return expect.unreachable(`${text} is not answered from the input alone`);
    case "COMMAND":
    case "INVALID_USERNAME":
    case "UNKNOWN_COMMAND":
    case "LINK":
      return replyTo(input satisfies InstantInput);
  }
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
    expect(reply).toContain("/prospect @username");
    expect(reply).toContain("/oggi");
    expect(reply).toContain("/followup");
    expect(reply).toContain("/nuovo");
    expect(reply).toContain("/lista");
  });

  it("points to /oggi on /start", () => {
    expect(replyToText("/start")).toContain("Ogni giorno apri /oggi");
  });

  it.each(["/start", "/help"])("explains the buttons on %s", (command) => {
    expect(replyToText(command)).toContain("📋 copia, ✅ inviato");
  });

  it("points unknown commands to /help", () => {
    expect(replyToText("/unknown")).toContain("/help");
  });

  it("asks for screenshots of a profile it does not remember", () => {
    const reply = profileHint("mariofit");

    expect(reply).toContain("@mariofit");
    expect(reply).toContain("screenshot");
  });

  it("explains how to name a prospect", () => {
    expect(replyToText("/prospect mario fit")).toContain("@nome");
    expect(PROSPECT_USAGE).toContain("/prospect @mariofit");
  });

  it("offers to remember a prospect it does not know", () => {
    const reply = unknownProspectReply("mariofit");

    expect(reply).toContain("@mariofit non è in memoria");
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
