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

  it.each([
    ["/credito", { type: "SHOW" }],
    ["/credito@AlexOutreachBot", { type: "SHOW" }],
    ["/credito 25", { type: "SET", amountMicroUsd: 25_000_000 }],
    ["/credito 25,40", { type: "SET", amountMicroUsd: 25_400_000 }],
    ["/credito 25.4", { type: "SET", amountMicroUsd: 25_400_000 }],
    ["/credito $ 7,05", { type: "SET", amountMicroUsd: 7_050_000 }],
    ["/credito 0", { type: "SET", amountMicroUsd: 0 }],
    ["/CREDITO 18 $", { type: "SET", amountMicroUsd: 18_000_000 }],
    ["/credito venti", { type: "INVALID" }],
    ["/credito 25,405", { type: "INVALID" }],
    ["/credito 1.234,56", { type: "INVALID" }],
    ["/credito -5", { type: "INVALID" }],
    ["/credito 1000000", { type: "INVALID" }],
  ])("reads the credit in %j", (text, request) => {
    expect(classifyText(text)).toStrictEqual({ type: "CREDIT", request });
  });

  it.each([
    ["/prospect @mariofit", "mariofit"],
    ["/prospect mariofit", "mariofit"],
    ["/Prospect @MarioFit", "mariofit"],
    ["/prospect@AlexOutreachBot @mariofit", "mariofit"],
    ["/prospect\n@mariofit", "mariofit"],
    ["/prospect https://www.instagram.com/mariofit/?igsh=MXZ0", "mariofit"],
    ["/prospect instagram.com/giulia.bakery", "giulia.bakery"],
  ])("reads the prospect named in %j", (text, username) => {
    expect(classifyText(text)).toStrictEqual({ type: "PROSPECT", username });
  });

  it.each(["/prospect", "/prospect@AlexOutreachBot", "  /prospect  "])(
    "leaves the prospect of %j to the message it replies to",
    (text) => {
      expect(classifyText(text)).toStrictEqual({
        type: "PROSPECT",
        username: null,
      });
    },
  );

  it.each([
    "/prospect mario fit",
    "/prospect ciao!",
    "/prospect https://mariofit.it",
    "/prospect https://www.instagram.com/p/C8x2kLsNqWz/",
    "/prospect explore",
  ])("refuses the username in %j", (text) => {
    expect(classifyText(text)).toStrictEqual({
      type: "INVALID_USERNAME",
      command: "prospect",
    });
  });

  it.each([
    "/",
    "/startup",
    "/unknown",
    "/ciao come va",
    "/creditocard",
    "/prospects",
  ])("marks %j as an unknown command", (text) => {
    expect(classifyText(text)).toStrictEqual({ type: "UNKNOWN_COMMAND" });
  });

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
