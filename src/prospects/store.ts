import { randomUUID } from "node:crypto";

import type { SuggestionKind, SuggestionStyle } from "../ai/outputs.ts";
import type {
  ConversationMessage,
  StageChange,
} from "../conversations/domain.ts";
import {
  contactFactsOf,
  MAX_LOADED_SENDS,
  MAX_STORED_MESSAGES,
  MAX_STORED_SENDS,
  overviewOf,
  storedSendText,
  type MemoryUpdate,
  type Prospect,
  type ProspectMemory,
  type ProspectOverview,
  type Send,
} from "./memory.ts";

/** A message of the bot whose suggestion Alex marks as sent. */
export type SendRecord = Readonly<{
  chatId: number;
  messageId: number;
  kind: SuggestionKind;
  /** Null when Alex did not say which suggestion it was. */
  style: SuggestionStyle | null;
  text: string | null;
}>;

/**
 * What marking a send did. A message of the bot holds one send: marking it
 * again leaves it as it was, unless it names a different suggestion.
 */
export type SendOutcome =
  | Readonly<{
      type: "RECORDED" | "CORRECTED" | "UNCHANGED";
      prospectId: string;
      username: string;
      /** When the send was first marked. */
      sentAt: Date;
    }>
  /** The message is about no prospect the bot remembers. */
  | Readonly<{ type: "NOT_LINKED" }>;

/**
 * The sends after the prospect's latest message, or all of them when the
 * prospect never wrote, the latest ones, oldest first.
 */
export const sendsToLoad = (
  sends: readonly Send[],
  lastProspectMessageAt: Date | null,
): readonly Send[] =>
  sends
    .filter(
      ({ sentAt }) =>
        lastProspectMessageAt === null ||
        sentAt.getTime() > lastProspectMessageAt.getTime(),
    )
    .slice(-MAX_LOADED_SENDS);

/** Days the buttons of a list of the bot keep working. */
export const LIST_ITEMS_TTL_DAYS = 30;

/** Lists sent before this time are too old to open their items. */
export const listItemsExpiry = (now: Date): Date =>
  new Date(now.getTime() - LIST_ITEMS_TTL_DAYS * 86_400_000);

/**
 * Where prospect memory lives: MySQL in production, the process itself in
 * development. Every implementation passes the same contract tests.
 */
export type ProspectStore = Readonly<{
  /** The memory of the prospect with this canonical username, or null. */
  load: (username: string) => Promise<ProspectMemory | null>;
  /**
   * Stores the prospect as the update describes it, creating it the first
   * time; appends the new messages and keeps only the latest ones. A new
   * stage is recorded in the history.
   */
  save: (update: MemoryUpdate) => Promise<ProspectMemory>;
  /** Every change of stage recorded by `save`, oldest first. */
  stageHistory: (username: string) => Promise<readonly StageChange[]>;
  /** Remembers that these messages the bot sent are about the prospect. */
  linkMessages: (
    prospectId: string,
    chatId: number,
    messageIds: readonly number[],
  ) => Promise<void>;
  /** The username of the prospect a message of the bot is about, or null. */
  prospectOfMessage: (
    chatId: number,
    messageId: number,
  ) => Promise<string | null>;
  /**
   * Marks the suggestion Alex sent from a message of the bot, for the
   * prospect that message is about, and keeps only the latest sends.
   */
  recordSend: (send: SendRecord) => Promise<SendOutcome>;
  /**
   * Every prospect, in no particular order, with the facts of the contact
   * as `load` gives them: what the lists need, without the messages.
   */
  overview: () => Promise<readonly ProspectOverview[]>;
  /**
   * Remembers which prospect each item of a list of the bot opens, counting
   * from 0 as its buttons do, and forgets the lists too old to open.
   */
  linkItems: (
    chatId: number,
    messageId: number,
    prospectIds: readonly string[],
  ) => Promise<void>;
  /**
   * The username of the prospect an item of a list opens; null when the
   * list is unknown or too old.
   */
  prospectOfItem: (
    chatId: number,
    messageId: number,
    index: number,
  ) => Promise<string | null>;
}>;

/** Time and identifiers, injected so tests can predict them. */
export type StoreDependencies = Readonly<{
  now?: () => Date;
  newId?: () => string;
}>;

type Stored = Readonly<{ message: ConversationMessage; at: Date }>;

type Remembered = Readonly<{ prospect: Prospect; stored: readonly Stored[] }>;

type StoredSend = Send & Readonly<{ key: string }>;

const memoryOf = (
  { prospect, stored }: Remembered,
  sends: readonly Send[],
): ProspectMemory => {
  const times = stored.map(({ message, at }) => ({
    author: message.author,
    at,
  }));
  const facts = contactFactsOf(times, []);
  return {
    prospect,
    messages: stored.map(({ message }) => message),
    contact: contactFactsOf(
      times,
      sendsToLoad(sends, facts.lastProspectMessageAt),
    ),
  };
};

/** Memory that lasts as long as the process: for development only. */
export const createInMemoryProspectStore = ({
  now = () => new Date(),
  newId = randomUUID,
}: StoreDependencies = {}): ProspectStore => {
  const memories = new Map<string, Remembered>();
  // Each prospect's sends, oldest first, with the key of the bot message.
  const sends = new Map<string, readonly StoredSend[]>();
  const withSends = (remembered: Remembered): ProspectMemory =>
    memoryOf(
      remembered,
      (sends.get(remembered.prospect.id) ?? []).map(
        ({ kind, style, text, sentAt }) => ({ kind, style, text, sentAt }),
      ),
    );
  const histories = new Map<string, readonly StageChange[]>();
  // Chat and message id of each message of the bot, to its prospect's id.
  const links = new Map<string, string>();
  const linkKey = (chatId: number, messageId: number): string =>
    `${String(chatId)}:${String(messageId)}`;
  // Each item of a list of the bot, to the prospect it opens.
  const items = new Map<string, Readonly<{ prospectId: string; at: Date }>>();
  const itemKey = (chatId: number, messageId: number, index: number): string =>
    `${linkKey(chatId, messageId)}:${String(index)}`;
  const usernameOf = (prospectId: string | undefined): string | null =>
    [...memories.values()].find(({ prospect }) => prospect.id === prospectId)
      ?.prospect.username ?? null;

  return {
    load: (username) => {
      const remembered = memories.get(username);
      return Promise.resolve(
        remembered === undefined ? null : withSends(remembered),
      );
    },
    save: ({ profile, newMessages }) => {
      const time = now();
      const earlier = memories.get(profile.username);
      const from = earlier?.prospect.conversation?.stage ?? null;
      const to = profile.conversation?.stage ?? null;
      if (to !== null && to !== from) {
        histories.set(profile.username, [
          ...(histories.get(profile.username) ?? []),
          { from, to, at: time },
        ]);
      }
      const remembered: Remembered = {
        prospect: {
          ...profile,
          id: earlier?.prospect.id ?? newId(),
          createdAt: earlier?.prospect.createdAt ?? time,
          updatedAt: time,
        },
        stored: [
          ...(earlier?.stored ?? []),
          ...newMessages.map((message) => ({ message, at: time })),
        ].slice(-MAX_STORED_MESSAGES),
      };
      memories.set(profile.username, remembered);
      return Promise.resolve(withSends(remembered));
    },
    stageHistory: (username) => Promise.resolve(histories.get(username) ?? []),
    linkMessages: (prospectId, chatId, messageIds) => {
      if (messageIds.length > 0) {
        // Read like the database does, so both stores see the same clock.
        now();
      }
      for (const messageId of messageIds) {
        links.set(linkKey(chatId, messageId), prospectId);
      }
      return Promise.resolve();
    },
    prospectOfMessage: (chatId, messageId) =>
      Promise.resolve(usernameOf(links.get(linkKey(chatId, messageId)))),
    recordSend: ({ chatId, messageId, kind, style, text }) => {
      const key = linkKey(chatId, messageId);
      const prospectId = links.get(key);
      const remembered = [...memories.values()].find(
        ({ prospect }) => prospect.id === prospectId,
      );
      if (prospectId === undefined || remembered === undefined) {
        return Promise.resolve({ type: "NOT_LINKED" });
      }
      const { username } = remembered.prospect;
      const sentAt = now();
      const earlier = sends.get(prospectId) ?? [];
      const existing = earlier.find((send) => send.key === key);
      if (existing !== undefined) {
        const corrected = style !== null && style !== existing.style;
        if (corrected) {
          sends.set(
            prospectId,
            earlier.map((send) =>
              send === existing
                ? { ...send, style, text: storedSendText(text) }
                : send,
            ),
          );
        }
        return Promise.resolve({
          type: corrected ? "CORRECTED" : "UNCHANGED",
          prospectId,
          username,
          sentAt: existing.sentAt,
        });
      }
      sends.set(
        prospectId,
        [
          ...earlier,
          { key, kind, style, text: storedSendText(text), sentAt },
        ].slice(-MAX_STORED_SENDS),
      );
      return Promise.resolve({
        type: "RECORDED",
        prospectId,
        username,
        sentAt,
      });
    },
    overview: () =>
      Promise.resolve(
        [...memories.values()].map((remembered) =>
          overviewOf(withSends(remembered)),
        ),
      ),
    linkItems: (chatId, messageId, prospectIds) => {
      if (prospectIds.length > 0) {
        const time = now();
        const expiry = listItemsExpiry(time);
        for (const [key, { at }] of items) {
          if (at.getTime() < expiry.getTime()) {
            items.delete(key);
          }
        }
        prospectIds.forEach((prospectId, index) => {
          items.set(itemKey(chatId, messageId, index), {
            prospectId,
            at: time,
          });
        });
      }
      return Promise.resolve();
    },
    prospectOfItem: (chatId, messageId, index) => {
      const expiry = listItemsExpiry(now());
      const item = items.get(itemKey(chatId, messageId, index));
      return Promise.resolve(
        item === undefined || item.at.getTime() < expiry.getTime()
          ? null
          : usernameOf(item.prospectId),
      );
    },
  };
};
