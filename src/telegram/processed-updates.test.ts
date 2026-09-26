import { describe, expect, it } from "vitest";

import { createProcessedUpdates } from "./processed-updates.ts";

describe("createProcessedUpdates", () => {
  it("claims each update id only once", () => {
    const processed = createProcessedUpdates(10);

    expect(processed.claim(1)).toBe(true);
    expect(processed.claim(2)).toBe(true);
    expect(processed.claim(1)).toBe(false);
  });

  it("lets a released update be claimed again", () => {
    const processed = createProcessedUpdates(10);
    processed.claim(1);

    processed.release(1);

    expect(processed.claim(1)).toBe(true);
  });

  it("forgets the oldest ids beyond its capacity", () => {
    const processed = createProcessedUpdates(2);
    processed.claim(1);
    processed.claim(2);
    processed.claim(3);

    expect(processed.claim(3)).toBe(false);
    expect(processed.claim(2)).toBe(false);
    expect(processed.claim(1)).toBe(true);
  });
});
