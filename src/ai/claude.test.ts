import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";

import type { ProspectMemory } from "../prospects/memory.ts";
import { createClaudeEngine } from "./claude.ts";
import type { ScreenshotsOutput } from "./outputs.ts";
import { CONVERSATION_REPLY_TASK } from "./prompts/conversation-reply.ts";
import { FIRST_MESSAGE_TASK } from "./prompts/first-message.ts";
import { promptSignature } from "./prompts/layer.ts";
import {
  conversationRequest,
  PROMPT_LAYERS,
  PROSPECT_IDENTITY_REQUEST,
  screenshotsRequest,
} from "./prompts/modes.ts";
import { SYSTEM_POLICY } from "./prompts/system.ts";

const API_KEY = "sk-ant-test-key-value";
const TODAY = new Date("2026-09-30T08:00:00Z");
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const profileOutput: ScreenshotsOutput = {
  kind: "PROFILE",
  prospect: {
    username: "mariofit",
    display_name: "Mario",
    business_type: "personal trainer",
  },
  messages: null,
  observed_facts: ["La bio invita a scrivere START in DM."],
  hypotheses: [],
  conversation: null,
  objections: [],
  commitments: [],
  summary: "Personal trainer, invita a scrivere START in DM.",
  first_messages: {
    best: "Ciao Mario, quanti START ti arrivano a settimana?",
    curiosity: "Il programma START lo segui tu uno a uno?",
    natural: "Bello il format START, come ti è venuto in mente?",
  },
  replies: null,
  note: null,
};

type RecordedRequest = Readonly<{
  url: string;
  headers: Headers;
  body: unknown;
}>;

const json = (status: number, body: unknown): Promise<Response> =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );

const USAGE = {
  input_tokens: 1_200,
  output_tokens: 300,
  cache_read_input_tokens: 800,
  cache_creation_input_tokens: 0,
};

const message = ({
  text = JSON.stringify(profileOutput),
  stopReason = "end_turn",
  model = "claude-opus-5",
  usage = USAGE,
}: Readonly<{
  text?: string;
  stopReason?: string;
  model?: string;
  usage?: Record<string, unknown>;
}> = {}): Promise<Response> =>
  json(200, {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model,
    content: [{ type: "text", text }],
    stop_reason: stopReason,
    stop_sequence: null,
    usage,
  });

const apiError = (status: number, type: string): Promise<Response> =>
  json(status, { type: "error", error: { type, message: "test error" } });

/** Engine on the real SDK, with a fake fetch that records the requests. */
const setup = (respond: () => Promise<Response> = () => message()) => {
  const requests: RecordedRequest[] = [];
  const fetchFn = (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    requests.push({
      url: input instanceof Request ? input.url : String(input),
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    return respond();
  };
  const times = [1_000, 3_500];
  const engine = createClaudeEngine({
    client: new Anthropic({ apiKey: API_KEY, fetch: fetchFn, maxRetries: 0 }),
    model: "claude-opus-5",
    fastModel: "claude-haiku-4-5",
    now: () => times.shift() ?? 0,
    today: () => TODAY,
  });
  return { engine, requests };
};

const systemTextOf = (request: RecordedRequest | undefined): string =>
  JSON.stringify(request?.body);

describe("createClaudeEngine", () => {
  it("asks Claude to analyze screenshots with the versioned instructions", async () => {
    const { engine, requests } = setup();

    await engine.analyzeScreenshots(
      [{ format: "image/png", bytes: PNG }],
      "palestra a Riccione",
      null,
    );

    const [request] = requests;
    expect(request?.url).toMatch(/\/v1\/messages\?beta=true$/);
    expect(request?.headers.get("anthropic-beta")).toContain(
      "server-side-fallback-2026-07-01",
    );
    expect(request?.body).toMatchObject({
      model: "claude-opus-5",
      max_tokens: 16_000,
      fallbacks: "default",
      system: [{ type: "text", cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: Buffer.from(PNG).toString("base64"),
              },
            },
            {
              type: "text",
              text: screenshotsRequest("palestra a Riccione", null, TODAY),
            },
          ],
        },
      ],
      output_config: { effort: "high", format: { type: "json_schema" } },
    });
    expect(systemTextOf(request)).toContain(
      JSON.stringify(SYSTEM_POLICY.text).slice(1, -1),
    );
    expect(systemTextOf(request)).toContain(
      JSON.stringify(FIRST_MESSAGE_TASK.text).slice(1, -1),
    );
  });

  it("sends what the bot remembers about the prospect", async () => {
    const { engine, requests } = setup();
    const memory: ProspectMemory = {
      prospect: {
        id: "prospect-1",
        username: "mariofit",
        displayName: "Mario",
        businessType: "personal trainer",
        facts: [],
        hypotheses: [],
        conversation: null,
        summary: "Primo messaggio inviato, nessuna risposta.",
        objections: ["Teme che un sito costi troppo."],
        commitments: [{ by: "ALEX", text: "Mandargli un esempio." }],
        createdAt: new Date("2026-09-20T10:00:00Z"),
        updatedAt: new Date("2026-09-20T10:00:00Z"),
      },
      messages: [{ author: "ALEX", text: "Ciao Mario!" }],
    };

    await engine.analyzeScreenshots(
      [{ format: "image/png", bytes: PNG }],
      null,
      memory,
    );

    expect(requests[0]?.body).toMatchObject({
      messages: [
        {
          role: "user",
          content: [
            { type: "image" },
            { type: "text", text: screenshotsRequest(null, memory, TODAY) },
          ],
        },
      ],
    });
  });

  it("turns the answer into an analysis and reports the generation", async () => {
    const { engine } = setup();

    const generation = await engine.analyzeScreenshots(
      [{ format: "image/png", bytes: PNG }],
      null,
      null,
    );

    expect(generation.result).toMatchObject({
      ok: true,
      value: { kind: "PROFILE", prospect: { username: "mariofit" } },
    });
    expect(generation.report).toStrictEqual({
      mode: "SCREENSHOTS",
      prompt: promptSignature(PROMPT_LAYERS.SCREENSHOTS),
      model: "claude-opus-5",
      durationMs: 2_500,
      inputTokens: 1_200,
      outputTokens: 300,
      cacheReadTokens: 800,
      cacheWriteTokens: 0,
      // 1200×5 + 300×25 + 800×0.5 millionths of a dollar on Opus 5.
      costMicroUsd: 13_900,
      stopReason: "end_turn",
    });
  });

  it("estimates the cost of the prompt cache writes", async () => {
    const { engine } = setup(() =>
      message({
        usage: {
          ...USAGE,
          cache_creation_input_tokens: 3_000,
          cache_creation: {
            ephemeral_5m_input_tokens: 2_000,
            ephemeral_1h_input_tokens: 1_000,
          },
        },
      }),
    );

    const { report } = await engine.analyzeScreenshots([], null, null);

    expect(report).toMatchObject({
      cacheWriteTokens: 3_000,
      // 13900 + 2000×6.25 + 1000×10
      costMicroUsd: 36_400,
    });
  });

  it("prices both the declined attempt and the fallback model", async () => {
    const iteration = {
      cache_creation: null,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      input_tokens: 1_000,
      output_tokens: 100,
    };
    const { engine } = setup(() =>
      message({
        model: "claude-sonnet-5",
        usage: {
          ...USAGE,
          iterations: [
            { ...iteration, type: "message", model: null },
            {
              ...iteration,
              type: "fallback_message",
              model: "claude-sonnet-5",
            },
          ],
        },
      }),
    );

    const { report } = await engine.analyzeScreenshots([], null, null);

    // Opus 5 for the refusal (1000×5 + 100×25), then Sonnet 5 (1000×2 + 100×10).
    expect(report).toMatchObject({
      model: "claude-sonnet-5",
      costMicroUsd: 10_500,
    });
  });

  it("does not guess the cost of a model without known prices", async () => {
    const { engine } = setup(() => message({ model: "claude-future-9" }));

    const { report } = await engine.analyzeScreenshots([], null, null);

    expect(report).toMatchObject({
      model: "claude-future-9",
      costMicroUsd: null,
    });
  });

  it("replies to a pasted conversation", async () => {
    const { engine, requests } = setup(() =>
      message({
        text: JSON.stringify({
          messages: [{ author: "PROSPECT", text: "Quanto costa?" }],
          observed_facts: [],
          hypotheses: [],
          conversation: {
            last_prospect_message: "Quanto costa?",
            stage: "ENGAGED",
            intent: "PRICE_REQUEST",
            interest: "MEDIUM",
            next_goal: "UNDERSTAND_PROCESS",
            rationale: "Chiede il prezzo senza contesto.",
          },
          objections: [],
          commitments: [],
          summary: "Ha chiesto il prezzo di un sito.",
          replies: {
            best: "Dipende: cosa ti servirebbe?",
            alternative: "Te lo dico volentieri: come lavori oggi?",
            direct: "Da 800 €: cosa deve fare il sito?",
          },
          note: null,
        }),
      }),
    );

    const generation = await engine.replyToConversation("Quanto costa?", null);

    expect(generation.result).toMatchObject({
      ok: true,
      value: { analysis: { intent: "PRICE_REQUEST" } },
    });
    expect(requests[0]?.body).toMatchObject({
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: conversationRequest("Quanto costa?", null, TODAY),
            },
          ],
        },
      ],
    });
    expect(systemTextOf(requests[0])).toContain(
      JSON.stringify(CONVERSATION_REPLY_TASK.text).slice(1, -1),
    );
    expect(systemTextOf(requests[0])).not.toContain(
      JSON.stringify(FIRST_MESSAGE_TASK.text).slice(1, -1),
    );
  });

  it("recognizes the prospect with the fast model", async () => {
    const { engine, requests } = setup(() =>
      message({
        text: JSON.stringify({ username: "@MarioFit", display_name: "Mario" }),
      }),
    );

    const generation = await engine.identifyProspect([
      { format: "image/png", bytes: PNG },
    ]);

    expect(generation.result).toStrictEqual({
      ok: true,
      value: { username: "mariofit", displayName: "Mario" },
    });
    expect(generation.report).toMatchObject({
      mode: "PROSPECT_IDENTITY",
      prompt: promptSignature(PROMPT_LAYERS.PROSPECT_IDENTITY),
    });
    const [request] = requests;
    expect(request?.body).toMatchObject({
      model: "claude-haiku-4-5",
      max_tokens: 1_024,
      output_config: { format: { type: "json_schema" } },
      messages: [
        {
          role: "user",
          content: [
            { type: "image" },
            { type: "text", text: PROSPECT_IDENTITY_REQUEST },
          ],
        },
      ],
    });
    // The quick look needs neither the effort of an analysis nor its fallback.
    expect(request?.body).not.toHaveProperty("fallbacks");
    expect(request?.body).not.toHaveProperty("output_config.effort");
    expect(request?.headers.get("anthropic-beta")).toBeNull();
  });

  it.each([
    [{ username: "Mario Rossi", display_name: " " }, null, null],
    [{ username: null, display_name: "Mario" }, null, "Mario"],
  ])(
    "treats %j as no visible username",
    async (output, username, displayName) => {
      const { engine } = setup(() => message({ text: JSON.stringify(output) }));

      const generation = await engine.identifyProspect([]);

      expect(generation.result).toStrictEqual({
        ok: true,
        value: { username, displayName },
      });
    },
  );

  it.each([
    ["a refusal", { text: "", stopReason: "refusal" }, "REFUSED"],
    ["a truncated answer", { stopReason: "max_tokens" }, "TRUNCATED"],
    [
      "an answer that is not JSON",
      { text: "Ecco i messaggi:" },
      "INVALID_OUTPUT",
    ],
    [
      "an answer outside the schema",
      { text: '{"kind":"PROFILE"}' },
      "INVALID_OUTPUT",
    ],
    [
      "an inconsistent answer",
      { text: JSON.stringify({ ...profileOutput, first_messages: null }) },
      "INVALID_OUTPUT",
    ],
  ])("reports %s", async (_description, answer, type) => {
    const { engine } = setup(() => message(answer));

    const generation = await engine.analyzeScreenshots([], null, null);

    expect(generation.result).toMatchObject({ ok: false, error: { type } });
  });

  it.each([
    [429, "rate_limit_error", { type: "UNAVAILABLE", status: 429 }],
    [529, "overloaded_error", { type: "UNAVAILABLE", status: 529 }],
    [500, "api_error", { type: "UNAVAILABLE", status: 500 }],
    [401, "authentication_error", { type: "REJECTED", status: 401 }],
    [400, "invalid_request_error", { type: "REJECTED", status: 400 }],
  ])("maps HTTP %i to %j", async (status, type, error) => {
    const { engine } = setup(() => apiError(status, type));

    const generation = await engine.replyToConversation("ciao", null);

    expect(generation.result).toStrictEqual({ ok: false, error });
    expect(generation.report).toMatchObject({ model: null, durationMs: 2_500 });
  });

  it("reports network failures without leaking the API key", async () => {
    const { engine } = setup(() =>
      Promise.reject(new TypeError(`fetch failed with key ${API_KEY}`)),
    );

    const generation = await engine.replyToConversation("ciao", null);

    expect(generation.result).toStrictEqual({
      ok: false,
      error: { type: "UNAVAILABLE", status: null },
    });
    expect(JSON.stringify(generation)).not.toContain(API_KEY);
  });
});
