import { describe, expect, it } from "vitest";

import { fitsInMessage, telegramLength } from "./message-length.ts";

describe("telegramLength", () => {
  it("counts the text Telegram shows, not the tags", () => {
    expect(telegramLength("<b>Ciao</b> <pre>Mario</pre>")).toBe(10);
  });

  it("counts each entity as one character", () => {
    expect(telegramLength("Tom &amp; Jerry &lt;3 &#128170;")).toBe(17);
  });

  it("counts in UTF-16 code units, like Telegram", () => {
    expect(telegramLength("💪")).toBe(2);
  });
});

describe("fitsInMessage", () => {
  it("allows up to 4096 characters", () => {
    expect(fitsInMessage(`<b>${"x".repeat(4_096)}</b>`)).toBe(true);
    expect(fitsInMessage("x".repeat(4_097))).toBe(false);
  });
});
