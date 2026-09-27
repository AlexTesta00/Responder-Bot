import { describe, expect, it, vi } from "vitest";

import {
  createInMemoryProspectStore,
  type ProspectStore,
} from "../prospects/store.ts";
import type { Logger } from "../shared/logger.ts";
import { romeDay } from "../shared/time.ts";
import { createSendMarking } from "./sends.ts";

const CHAT = 42;
const SHOWN = ["Ciao Mario!", "Come gestisci gli START?", "Bel profilo!"];

/** A store with Mario, only the profile, and message 1001 about Mario. */
const setup = async () => {
  let seconds = 0;
  const now = (): Date => {
    seconds += 1;
    return new Date(Date.UTC(2026, 8, 27, 8, 0, seconds));
  };
  const prospects = createInMemoryProspectStore({ now });
  const memory = await prospects.save({
    profile: {
      username: "mariofit",
      displayName: null,
      businessType: null,
      facts: [],
      hypotheses: [],
      conversation: null,
      summary: null,
      objections: [],
      commitments: [],
    },
    newMessages: [],
  });
  await prospects.linkMessages(memory.prospect.id, CHAT, [1_001]);
  return withStore(prospects, now);
};

const withStore = (prospects: ProspectStore, now: () => Date) => {
  const log = {
    info: vi.fn<Logger["info"]>(),
    warn: vi.fn<Logger["warn"]>(),
    error: vi.fn<Logger["error"]>(),
  };
  const mark = createSendMarking({ prospects, now });
  return {
    prospects,
    log,
    mark: (
      index: 0 | 1 | 2 | null,
      suggestions: readonly string[] = SHOWN,
      messageId = 1_001,
    ) =>
      mark(
        { kind: "FIRST_MESSAGES", index },
        { chatId: CHAT, messageId, suggestions },
        log,
      ),
  };
};

describe("createSendMarking", () => {
  it("records the suggestion Alex sent, with its style and text", async () => {
    const { mark, prospects } = await setup();

    const marked = await mark(1);

    expect(marked).toMatchObject({
      type: "RECORDED",
      style: "CURIOSITY",
      situation: { type: "WAITING", number: 1 },
    });
    expect((await prospects.load("mariofit"))?.contact.sends).toMatchObject([
      {
        kind: "FIRST_MESSAGES",
        style: "CURIOSITY",
        text: "Come gestisci gli START?",
      },
    ]);
  });

  it("tells from which day the first follow-up is due", async () => {
    const { mark } = await setup();

    const marked = await mark(0);

    if (marked.type !== "RECORDED" || marked.situation?.type !== "WAITING") {
      expect.unreachable("a first message waits for a reply");
    }
    expect(marked.situation.dueDay).toBe(romeDay(marked.sentAt) + 3);
  });

  it("does not guess the text when the message no longer shows it", async () => {
    const { mark, prospects } = await setup();

    await mark(2, []);

    expect((await prospects.load("mariofit"))?.contact.sends).toMatchObject([
      { style: "NATURAL", text: null },
    ]);
  });

  it("records a send without saying which suggestion", async () => {
    const { mark, prospects } = await setup();

    expect(await mark(null)).toMatchObject({ type: "RECORDED", style: null });
    expect((await prospects.load("mariofit"))?.contact.sends).toMatchObject([
      { style: null, text: null },
    ]);
  });

  it("tells a send marked again from a correction", async () => {
    const { mark } = await setup();
    const first = await mark(0);

    expect(await mark(0)).toMatchObject({
      type: "UNCHANGED",
      sentAt: first.type === "RECORDED" ? first.sentAt : null,
    });
    expect(await mark(2)).toMatchObject({
      type: "CORRECTED",
      style: "NATURAL",
    });
  });

  it("marks nothing for a message about no prospect", async () => {
    const { mark, prospects } = await setup();

    expect(await mark(0, SHOWN, 9_999)).toStrictEqual({ type: "NOT_LINKED" });
    expect((await prospects.load("mariofit"))?.contact.sends).toStrictEqual([]);
  });

  it("says so when the send cannot be recorded", async () => {
    const broken: ProspectStore = {
      ...createInMemoryProspectStore(),
      recordSend: () => Promise.reject(new Error("ECONNREFUSED")),
    };
    const { mark, log } = withStore(broken, () => new Date());

    expect(await mark(0)).toStrictEqual({ type: "UNAVAILABLE" });
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ error_name: "Error" }),
      "send not recorded",
    );
  });

  it("logs what was marked, never the text", async () => {
    const { mark, log, prospects } = await setup();

    await mark(1);

    expect(log.info).toHaveBeenCalledWith(
      {
        prospect_id: (await prospects.load("mariofit"))?.prospect.id,
        kind: "FIRST_MESSAGES",
        style: "CURIOSITY",
        outcome: "RECORDED",
      },
      "send recorded",
    );
    expect(JSON.stringify(log.info.mock.calls)).not.toContain("START");
  });
});
