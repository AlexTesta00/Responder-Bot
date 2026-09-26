/**
 * The work in progress, by key, so that a double tap on a button starts one
 * generation only. It lives in the process: a restart forgets it, together
 * with the generation it guarded.
 */
export type InFlight = Readonly<{
  /** False when the work for `key` is already in progress. */
  start: (key: string) => boolean;
  finish: (key: string) => void;
}>;

export const createInFlight = (): InFlight => {
  const running = new Set<string>();
  return {
    start: (key) => {
      if (running.has(key)) {
        return false;
      }
      running.add(key);
      return true;
    },
    finish: (key) => {
      running.delete(key);
    },
  };
};
