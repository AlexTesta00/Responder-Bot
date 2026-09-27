import { describe, expect, it, vi } from "vitest";

import type {
  ConversationMessage,
  ConversationState,
} from "../conversations/domain.ts";
import type { ProspectProfile } from "../prospects/memory.ts";
import { createInMemoryProspectStore } from "../prospects/store.ts";
import { errorFields } from "../shared/errors.ts";
import type { Logger } from "../shared/logger.ts";
import type { ProspectReference } from "./memory.ts";
import { createCrm } from "./crm.ts";

const CHAT = 42;

const profile = (
  username: string,
  conversation: ConversationState | null,
): ProspectProfile => ({
  username,
  displayName: null,
  businessType: null,
  facts: [],
  hypotheses: [],
  conversation,
  summary: null,
  objections: [],
  commitments: [],
});

const ENGAGED: ConversationState = {
  stage: "ENGAGED",
  intent: "INTERESTED",
  interest: "MEDIUM",
  nextGoal: "UNDERSTAND_PROCESS",
};

const them = (text: string): ConversationMessage => ({
  author: "PROSPECT",
  text,
});

const FAILURE = new Error("connection lost");

/** Mario, linked to message 1001, and Giulia, linked to message 2001. */
const setup = async () => {
  const prospects = createInMemoryProspectStore();
  // Mario's profile first, then his reply: his stage history has one step.
  const mario = await prospects.save({
    profile: profile("mariofit", null),
    newMessages: [],
  });
  await prospects.save({
    profile: profile("mariofit", ENGAGED),
    newMessages: [them("Quanto costa un sito?")],
  });
  const giulia = await prospects.save({
    profile: profile("giulia.bakery", ENGAGED),
    newMessages: [them("Mi serve un sito per gli ordini.")],
  });
  await prospects.linkMessages(mario.prospect.id, CHAT, [1_001]);
  await prospects.linkMessages(giulia.prospect.id, CHAT, [2_001]);
  const log = {
    info: vi.fn<Logger["info"]>(),
    warn: vi.fn<Logger["warn"]>(),
    error: vi.fn<Logger["error"]>(),
  };
  return { prospects, crm: createCrm({ prospects }), log };
};

describe("createCrm", () => {
  it("finds the card of the prospect Alex named", async () => {
    const { crm, log } = await setup();

    const card = await crm.card(
      { type: "USERNAME", username: "mariofit" },
      log,
    );

    expect(card).toMatchObject({
      type: "FOUND",
      memory: {
        prospect: { username: "mariofit", conversation: ENGAGED },
        messages: [them("Quanto costa un sito?")],
      },
      history: [{ from: null, to: "ENGAGED" }],
    });
  });

  it("finds the card of the prospect each message of the bot is about", async () => {
    const { crm, log } = await setup();

    const mario = await crm.card(
      { type: "REPLY", chatId: CHAT, messageId: 1_001 },
      log,
    );
    const giulia = await crm.card(
      { type: "REPLY", chatId: CHAT, messageId: 2_001 },
      log,
    );

    expect(mario).toMatchObject({
      type: "FOUND",
      memory: { prospect: { username: "mariofit" } },
    });
    expect(giulia).toMatchObject({
      type: "FOUND",
      memory: { prospect: { username: "giulia.bakery" } },
    });
  });

  it.each<ProspectReference>([
    { type: "USERNAME", username: "luca.design" },
    { type: "REPLY", chatId: CHAT, messageId: 3_001 },
  ])("knows no prospect for %j", async (reference) => {
    const { crm, log } = await setup();

    expect(await crm.card(reference, log)).toStrictEqual({ type: "UNKNOWN" });
  });

  it("reports a memory it cannot read", async () => {
    const { prospects, crm, log } = await setup();
    vi.spyOn(prospects, "load").mockRejectedValueOnce(FAILURE);

    const card = await crm.card(
      { type: "USERNAME", username: "mariofit" },
      log,
    );

    expect(card).toStrictEqual({ type: "UNAVAILABLE" });
    expect(log.error).toHaveBeenCalledWith(
      errorFields(FAILURE),
      "prospect memory unavailable",
    );
  });

  it("reports a message whose prospect it cannot read", async () => {
    const { prospects, crm, log } = await setup();
    vi.spyOn(prospects, "prospectOfMessage").mockRejectedValueOnce(FAILURE);

    const card = await crm.card(
      { type: "REPLY", chatId: CHAT, messageId: 1_001 },
      log,
    );

    expect(card).toStrictEqual({ type: "UNAVAILABLE" });
  });

  it("shows the card without its history when the history cannot be read", async () => {
    const { prospects, crm, log } = await setup();
    vi.spyOn(prospects, "stageHistory").mockRejectedValueOnce(FAILURE);

    const card = await crm.card(
      { type: "USERNAME", username: "mariofit" },
      log,
    );

    expect(card).toMatchObject({ type: "FOUND", history: [] });
    expect(log.warn).toHaveBeenCalledWith(
      errorFields(FAILURE),
      "stage history unavailable",
    );
  });
});

describe("createCrm lists", () => {
  // Sunday 27 September, 10:00 in Italy.
  const NOW = new Date("2026-09-27T08:00:00Z");

  it("sorts every prospect into the day's agenda", async () => {
    const { crm, log } = await setup();

    const found = await crm.agenda(NOW, log);

    expect(found.type).toBe("FOUND");
    if (found.type === "FOUND") {
      expect(
        found.agenda.reply.map(({ prospect }) => prospect.username).toSorted(),
      ).toStrictEqual(["giulia.bakery", "mariofit"]);
      expect(found.agenda.followUp).toStrictEqual([]);
    }
  });

  it("reports prospects it cannot read", async () => {
    const { prospects, crm, log } = await setup();
    vi.spyOn(prospects, "overview").mockRejectedValueOnce(FAILURE);

    expect(await crm.agenda(NOW, log)).toStrictEqual({ type: "UNAVAILABLE" });
    expect(log.error).toHaveBeenCalledWith(
      errorFields(FAILURE),
      "prospects unavailable",
    );
  });

  it("finds the card of the item of a list, never of another", async () => {
    const { prospects, crm, log } = await setup();
    const mario = await prospects.load("mariofit");
    const giulia = await prospects.load("giulia.bakery");
    await prospects.linkItems(CHAT, 3_001, [
      giulia?.prospect.id ?? "",
      mario?.prospect.id ?? "",
    ]);

    const item = (index: number) =>
      crm.card({ type: "ITEM", chatId: CHAT, messageId: 3_001, index }, log);

    expect(await item(0)).toMatchObject({
      type: "FOUND",
      memory: { prospect: { username: "giulia.bakery" } },
    });
    expect(await item(1)).toMatchObject({
      type: "FOUND",
      memory: { prospect: { username: "mariofit" } },
    });
    expect(await item(2)).toStrictEqual({ type: "UNKNOWN" });
  });

  it("reports a list whose items it cannot read", async () => {
    const { prospects, crm, log } = await setup();
    vi.spyOn(prospects, "prospectOfItem").mockRejectedValueOnce(FAILURE);

    const card = await crm.card(
      { type: "ITEM", chatId: CHAT, messageId: 3_001, index: 0 },
      log,
    );

    expect(card).toStrictEqual({ type: "UNAVAILABLE" });
    expect(log.error).toHaveBeenCalledWith(
      errorFields(FAILURE),
      "prospect of the list item unavailable",
    );
  });
});
