import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  conversationReplyOutputSchema,
  prospectIdentityOutputSchema,
  screenshotsOutputSchema,
  toConversationReply,
  toScreenshotsAnalysis,
  type ConversationReplyOutput,
  type ScreenshotsOutput,
} from "./outputs.ts";

const conversation = {
  last_prospect_message: "Quanto costa un sito?",
  stage: "ENGAGED",
  intent: "PRICE_REQUEST",
  interest: "MEDIUM",
  next_goal: "UNDERSTAND_PROCESS",
  rationale: "Chiede il prezzo prima di aver descritto le sue esigenze.",
} as const;

const replies = {
  best: "Dipende da cosa ti serve: oggi come gestisci le prenotazioni?",
  alternative: "Ti rispondo volentieri: che tipo di sito hai in mente?",
  direct: "Da 800 € in su: cosa dovrebbe fare il sito?",
};

const profileOutput: ScreenshotsOutput = {
  kind: "PROFILE",
  prospect: {
    username: "@mariofit",
    display_name: "Mario Rossi",
    business_type: "personal trainer",
  },
  observed_facts: ["La bio invita a scrivere START in DM."],
  hypotheses: ["Gestire i DM a mano potrebbe richiedere tempo."],
  conversation: null,
  first_messages: {
    best: "Ciao Mario, ho visto lo START in bio: quanti DM ricevi a settimana?",
    curiosity: "Curiosità: il programma START lo segui tu uno a uno?",
    natural: "Ciao Mario! Bello il format START, come ti è venuta l'idea?",
  },
  replies: null,
  note: null,
};

const conversationOutput: ScreenshotsOutput = {
  ...profileOutput,
  kind: "CONVERSATION",
  conversation,
  first_messages: null,
  replies,
};

describe("toScreenshotsAnalysis", () => {
  it("turns a profile into first messages", () => {
    expect(toScreenshotsAnalysis(profileOutput)).toStrictEqual({
      ok: true,
      value: {
        kind: "PROFILE",
        prospect: {
          username: "mariofit",
          displayName: "Mario Rossi",
          businessType: "personal trainer",
        },
        facts: ["La bio invita a scrivere START in DM."],
        hypotheses: ["Gestire i DM a mano potrebbe richiedere tempo."],
        suggestions: [
          { style: "BEST", text: profileOutput.first_messages?.best },
          { style: "CURIOSITY", text: profileOutput.first_messages?.curiosity },
          { style: "NATURAL", text: profileOutput.first_messages?.natural },
        ],
        note: null,
      },
    });
  });

  it("turns a conversation into an analysis and replies", () => {
    expect(toScreenshotsAnalysis(conversationOutput)).toMatchObject({
      ok: true,
      value: {
        kind: "CONVERSATION",
        analysis: {
          lastProspectMessage: "Quanto costa un sito?",
          stage: "ENGAGED",
          intent: "PRICE_REQUEST",
          interest: "MEDIUM",
          nextGoal: "UNDERSTAND_PROCESS",
        },
        suggestions: [
          { style: "BEST", text: replies.best },
          { style: "ALTERNATIVE", text: replies.alternative },
          { style: "DIRECT", text: replies.direct },
        ],
      },
    });
  });

  it("keeps a conversation without replies, when none should be sent", () => {
    expect(
      toScreenshotsAnalysis({
        ...conversationOutput,
        conversation: { ...conversation, intent: "DO_NOT_CONTACT" },
        replies: null,
        note: "Ha chiesto di non essere contattato.",
      }),
    ).toMatchObject({
      ok: true,
      value: { suggestions: [], note: "Ha chiesto di non essere contattato." },
    });
  });

  it("reports screenshots that show neither a profile nor a conversation", () => {
    expect(
      toScreenshotsAnalysis({
        ...profileOutput,
        kind: "UNRELATED",
        first_messages: null,
        note: "È la foto di un tramonto.",
      }),
    ).toStrictEqual({
      ok: true,
      value: { kind: "UNRELATED", note: "È la foto di un tramonto." },
    });
  });

  it.each([
    [
      "a profile without first messages",
      { ...profileOutput, first_messages: null },
    ],
    [
      "a conversation without analysis",
      { ...conversationOutput, conversation: null },
    ],
    [
      "an empty suggestion",
      { ...conversationOutput, replies: { ...replies, direct: "  " } },
    ],
  ])("rejects %s", (_description, output: ScreenshotsOutput) => {
    expect(toScreenshotsAnalysis(output)).toMatchObject({
      ok: false,
      error: { type: "INVALID_OUTPUT" },
    });
  });
});

describe("toConversationReply", () => {
  it("turns a pasted conversation into an analysis and replies", () => {
    const output: ConversationReplyOutput = {
      observed_facts: [],
      hypotheses: [],
      conversation,
      replies,
      note: null,
    };

    expect(toConversationReply(output)).toMatchObject({
      ok: true,
      value: {
        analysis: { intent: "PRICE_REQUEST", nextGoal: "UNDERSTAND_PROCESS" },
        suggestions: [
          { style: "BEST" },
          { style: "ALTERNATIVE" },
          { style: "DIRECT" },
        ],
      },
    });
  });
});

describe("output schemas", () => {
  it("reject values outside the conversation vocabulary", () => {
    const result = screenshotsOutputSchema.safeParse({
      ...conversationOutput,
      conversation: { ...conversation, stage: "PANIC" },
    });

    expect(result.success).toBe(false);
  });

  // Strict structured outputs require every object to list all its
  // properties as required and to forbid additional ones.
  const strictObject = z.object({
    properties: z.record(z.string(), z.unknown()),
    required: z.array(z.string()),
    additionalProperties: z.literal(false),
  });

  const objectNodes = (node: unknown): readonly unknown[] => {
    if (Array.isArray(node)) {
      return node.flatMap(objectNodes);
    }
    if (typeof node !== "object" || node === null) {
      return [];
    }
    const nested = Object.values(node).flatMap(objectNodes);
    return "properties" in node ? [node, ...nested] : nested;
  };

  it.each([
    ["prospect identity", prospectIdentityOutputSchema],
    ["screenshots", screenshotsOutputSchema],
    ["conversation reply", conversationReplyOutputSchema],
  ])("%s schema is valid for strict structured outputs", (_name, schema) => {
    const nodes = objectNodes(betaZodOutputFormat(schema).schema);

    expect(nodes).not.toHaveLength(0);
    for (const node of nodes) {
      const object = strictObject.parse(node);
      expect(object.required.toSorted()).toStrictEqual(
        Object.keys(object.properties).toSorted(),
      );
    }
  });
});
