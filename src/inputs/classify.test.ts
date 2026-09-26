import { describe, expect, it } from "vitest";

import { classifyText } from "./classify.ts";

describe("classifyText", () => {
  it.each([
    ["/start", "start"],
    ["/help", "help"],
    ["/start@AlexOutreachBot", "start"],
    ["/start campaign-42", "start"],
    ["/HELP", "help"],
    ["  /help  ", "help"],
  ])("recognizes the command %j", (text, command) => {
    expect(classifyText(text)).toStrictEqual({ type: "COMMAND", command });
  });

  it.each(["/", "/startup", "/unknown", "/ciao come va"])(
    "marks %j as an unknown command",
    (text) => {
      expect(classifyText(text)).toStrictEqual({ type: "UNKNOWN_COMMAND" });
    },
  );

  it.each([
    ["@mariofit", "mariofit"],
    [
      "https://www.instagram.com/mariofit?igsh=MXZ0bjh6aGd5dnRjdQ==",
      "mariofit",
    ],
    ["instagram.com/MarioFit", "mariofit"],
    ["Guarda il suo profilo: https://www.instagram.com/mariofit/", "mariofit"],
  ])("recognizes the Instagram profile in %j", (text, username) => {
    expect(classifyText(text)).toStrictEqual({
      type: "INSTAGRAM_PROFILE",
      username,
    });
  });

  it.each([
    "https://mariofit.it",
    "http://example.com/menu?lang=it",
    "https://www.instagram.com/p/C8x2kLsNqWz/",
  ])("recognizes %j as a link", (url) => {
    expect(classifyText(url)).toStrictEqual({ type: "LINK", url });
  });

  it.each([
    "Ciao, ti scrivo per il sito",
    "mariofit",
    "instagram.com/mariofit oppure instagram.com/coachmarco",
    "ftp://example.com/file",
  ])("keeps %j as text", (text) => {
    expect(classifyText(text)).toStrictEqual({
      type: "TEXT",
      text,
      username: null,
    });
  });

  it("trims the surrounding whitespace of texts", () => {
    expect(classifyText("  ci sentiamo domani \n")).toStrictEqual({
      type: "TEXT",
      text: "ci sentiamo domani",
      username: null,
    });
  });

  it("reads the prospect named on the first line of a pasted text", () => {
    expect(
      classifyText("@MarioFit\nMario: Quanto costa?\nIo: Dipende!"),
    ).toStrictEqual({
      type: "TEXT",
      text: "Mario: Quanto costa?\nIo: Dipende!",
      username: "mariofit",
    });
  });

  it.each([
    ["@mariofit", { type: "INSTAGRAM_PROFILE", username: "mariofit" }],
    ["@mariofit\n  ", { type: "INSTAGRAM_PROFILE", username: "mariofit" }],
    [
      "ciao @mariofit\ncome va?",
      { type: "TEXT", text: "ciao @mariofit\ncome va?", username: null },
    ],
  ])("names no pasted conversation in %j", (text, input) => {
    expect(classifyText(text)).toStrictEqual(input);
  });
});
