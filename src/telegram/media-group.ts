/** Runs `callback` after `delayMs`; the returned function cancels it. */
export type Schedule = (callback: () => void, delayMs: number) => () => void;

export const scheduleWithTimers: Schedule = (callback, delayMs) => {
  const timer = setTimeout(callback, delayMs);
  return () => {
    clearTimeout(timer);
  };
};

export type MediaGroupCollector<T> = Readonly<{
  /** Adds an item to its group, which completes when no more items arrive. */
  add: (groupId: string, item: T) => void;
}>;

export type MediaGroupOptions<T> = Readonly<{
  /** How long to wait for another item before the group is complete. */
  quietMs: number;
  /** A group of this size is complete at once. */
  maxItems: number;
  schedule: Schedule;
  onComplete: (items: readonly T[]) => void;
}>;

type PendingGroup<T> = Readonly<{
  items: readonly T[];
  cancel: () => void;
}>;

/**
 * Gathers the items of a media group, such as the photos of an album, which
 * Telegram delivers as separate updates, so they can be handled together.
 */
export const createMediaGroupCollector = <T>({
  quietMs,
  maxItems,
  schedule,
  onComplete,
}: MediaGroupOptions<T>): MediaGroupCollector<T> => {
  const pending = new Map<string, PendingGroup<T>>();

  const complete = (groupId: string): void => {
    const group = pending.get(groupId);
    if (group === undefined) {
      return;
    }
    pending.delete(groupId);
    group.cancel();
    onComplete(group.items);
  };

  return {
    add: (groupId, item) => {
      const previous = pending.get(groupId);
      previous?.cancel();

      const items = [...(previous?.items ?? []), item];
      pending.set(groupId, {
        items,
        cancel: schedule(() => {
          complete(groupId);
        }, quietMs),
      });

      if (items.length >= maxItems) {
        complete(groupId);
      }
    },
  };
};
