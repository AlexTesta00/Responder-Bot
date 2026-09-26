import { describe, expect, it, onTestFinished, vi } from "vitest";

import {
  createMediaGroupCollector,
  scheduleWithTimers,
} from "./media-group.ts";

const QUIET_MS = 2_000;

const setup = (maxItems = 10) => {
  vi.useFakeTimers();
  onTestFinished(() => {
    vi.useRealTimers();
  });
  const onComplete = vi.fn<(items: readonly string[]) => void>();
  const collector = createMediaGroupCollector({
    quietMs: QUIET_MS,
    maxItems,
    schedule: scheduleWithTimers,
    onComplete,
  });
  return { collector, onComplete };
};

describe("createMediaGroupCollector", () => {
  it("completes a group once no item arrives for the quiet period", () => {
    const { collector, onComplete } = setup();

    collector.add("album", "first");
    collector.add("album", "second");
    vi.advanceTimersByTime(QUIET_MS - 1);

    expect(onComplete).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);

    expect(onComplete).toHaveBeenCalledExactlyOnceWith(["first", "second"]);
  });

  it("waits again after each new item", () => {
    const { collector, onComplete } = setup();

    collector.add("album", "first");
    vi.advanceTimersByTime(QUIET_MS - 500);
    collector.add("album", "second");
    vi.advanceTimersByTime(QUIET_MS - 500);

    expect(onComplete).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);

    expect(onComplete).toHaveBeenCalledExactlyOnceWith(["first", "second"]);
  });

  it("completes a full group at once", () => {
    const { collector, onComplete } = setup(3);

    collector.add("album", "first");
    collector.add("album", "second");
    collector.add("album", "third");

    expect(onComplete).toHaveBeenCalledExactlyOnceWith([
      "first",
      "second",
      "third",
    ]);

    vi.advanceTimersByTime(QUIET_MS);

    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("keeps groups apart", () => {
    const { collector, onComplete } = setup();

    collector.add("album-a", "a1");
    collector.add("album-b", "b1");
    collector.add("album-a", "a2");
    vi.advanceTimersByTime(QUIET_MS);

    expect(onComplete).toHaveBeenCalledTimes(2);
    expect(onComplete).toHaveBeenCalledWith(["a1", "a2"]);
    expect(onComplete).toHaveBeenCalledWith(["b1"]);
  });

  it("starts over once a group is complete", () => {
    const { collector, onComplete } = setup();

    collector.add("album", "first");
    vi.advanceTimersByTime(QUIET_MS);
    collector.add("album", "late");
    vi.advanceTimersByTime(QUIET_MS);

    expect(onComplete.mock.calls).toStrictEqual([[["first"]], [["late"]]]);
  });
});
