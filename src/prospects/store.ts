import { randomUUID } from "node:crypto";

import {
  MAX_STORED_MESSAGES,
  type MemoryUpdate,
  type ProspectMemory,
} from "./memory.ts";

/**
 * Where prospect memory lives: MySQL in production, the process itself in
 * development. Every implementation passes the same contract tests.
 */
export type ProspectStore = Readonly<{
  /** The memory of the prospect with this canonical username, or null. */
  load: (username: string) => Promise<ProspectMemory | null>;
  /**
   * Stores the prospect as the update describes it, creating it the first
   * time; appends the new messages and keeps only the latest ones.
   */
  save: (update: MemoryUpdate) => Promise<ProspectMemory>;
}>;

/** Time and identifiers, injected so tests can predict them. */
export type StoreDependencies = Readonly<{
  now?: () => Date;
  newId?: () => string;
}>;

/** Memory that lasts as long as the process: for development only. */
export const createInMemoryProspectStore = ({
  now = () => new Date(),
  newId = randomUUID,
}: StoreDependencies = {}): ProspectStore => {
  const memories = new Map<string, ProspectMemory>();

  return {
    load: (username) => Promise.resolve(memories.get(username) ?? null),
    save: ({ profile, newMessages }) => {
      const time = now();
      const earlier = memories.get(profile.username);
      const memory: ProspectMemory = {
        prospect: {
          ...profile,
          id: earlier?.prospect.id ?? newId(),
          createdAt: earlier?.prospect.createdAt ?? time,
          updatedAt: time,
        },
        messages: [...(earlier?.messages ?? []), ...newMessages].slice(
          -MAX_STORED_MESSAGES,
        ),
      };
      memories.set(profile.username, memory);
      return Promise.resolve(memory);
    },
  };
};
