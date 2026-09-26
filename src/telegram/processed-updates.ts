export type ProcessedUpdates = Readonly<{
  /** Records the update id; returns false when it was already recorded. */
  claim: (updateId: number) => boolean;
  /** Forgets an update whose processing failed, so a retry can process it. */
  release: (updateId: number) => void;
}>;

/**
 * In-memory record of the most recent update ids, bounded by `capacity`.
 * It is created by the entry point and passed explicitly to its users; it
 * lasts as long as the process (the database takes over in a later sprint).
 */
export const createProcessedUpdates = (capacity: number): ProcessedUpdates => {
  // A Set keeps insertion order, so its first value is always the oldest.
  const ids = new Set<number>();

  return {
    claim: (updateId) => {
      if (ids.has(updateId)) {
        return false;
      }
      ids.add(updateId);
      const [oldest] = ids;
      if (ids.size > capacity && oldest !== undefined) {
        ids.delete(oldest);
      }
      return true;
    },
    release: (updateId) => {
      ids.delete(updateId);
    },
  };
};
