import { describe, expect, it } from "vitest";

import {
  usernameFromLinks,
  usernameFromMention,
  usernameFromProfileUrl,
} from "./instagram.ts";

describe("usernameFromProfileUrl", () => {
  it.each([
    ["https://www.instagram.com/mariofit/", "mariofit"],
    [
      "https://www.instagram.com/mariofit?igsh=MXZ0bjh6aGd5dnRjdQ==",
      "mariofit",
    ],
    ["https://instagram.com/coach.marco_", "coach.marco_"],
    ["http://m.instagram.com/barber.riccione/", "barber.riccione"],
    ["instagram.com/mariofit", "mariofit"],
    ["www.instagram.com/MarioFit", "mariofit"],
    ["https://www.instagram.com/mariofit/#bio", "mariofit"],
  ])("reads the username of %s", (url, username) => {
    expect(usernameFromProfileUrl(url)).toBe(username);
  });

  it.each([
    ["a post", "https://www.instagram.com/p/C8x2kLsNqWz/"],
    ["a reel", "https://www.instagram.com/reel/C8x2kLsNqWz/"],
    ["a story", "https://www.instagram.com/stories/mariofit/3412/"],
    ["a profile tab", "https://www.instagram.com/mariofit/reels/"],
    ["the home page", "https://www.instagram.com/"],
    ["a reserved page", "https://www.instagram.com/explore/"],
    ["another site", "https://example.com/mariofit"],
    ["a look-alike host", "https://instagram.com.example.com/mariofit"],
    ["an invalid username", "https://www.instagram.com/mario-fit/"],
    ["a too long username", `https://www.instagram.com/${"a".repeat(31)}/`],
    ["plain text", "mariofit"],
  ])("ignores %s", (_description, url) => {
    expect(usernameFromProfileUrl(url)).toBeNull();
  });
});

describe("usernameFromMention", () => {
  it.each([
    ["@mariofit", "mariofit"],
    ["@Coach.Marco_", "coach.marco_"],
  ])("reads %s", (mention, username) => {
    expect(usernameFromMention(mention)).toBe(username);
  });

  it.each(["mariofit", "@", "@mario fit", "@mario-fit", "ciao @mariofit"])(
    "ignores %j",
    (text) => {
      expect(usernameFromMention(text)).toBeNull();
    },
  );
});

describe("usernameFromLinks", () => {
  it("finds the profile linked in a longer text", () => {
    expect(
      usernameFromLinks(
        "Guarda il profilo di Mario: https://www.instagram.com/mariofit?igsh=abc.",
      ),
    ).toBe("mariofit");
  });

  it("accepts the same profile linked twice", () => {
    expect(
      usernameFromLinks(
        "instagram.com/mariofit e https://www.instagram.com/MarioFit/",
      ),
    ).toBe("mariofit");
  });

  it("ignores texts linking different profiles", () => {
    expect(
      usernameFromLinks(
        "instagram.com/mariofit oppure instagram.com/coachmarco",
      ),
    ).toBeNull();
  });

  it("ignores texts without profile links", () => {
    expect(usernameFromLinks("ciao, come stai?")).toBeNull();
  });
});
