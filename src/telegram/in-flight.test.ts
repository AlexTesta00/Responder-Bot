import { describe, expect, it } from "vitest";

import { createInFlight } from "./in-flight.ts";

describe("createInFlight", () => {
  it("starts the same work once until it finishes", () => {
    const inFlight = createInFlight();

    expect(inFlight.start("42:1001")).toBe(true);
    expect(inFlight.start("42:1001")).toBe(false);
    expect(inFlight.start("42:1002")).toBe(true);

    inFlight.finish("42:1001");
    expect(inFlight.start("42:1001")).toBe(true);
  });
});
