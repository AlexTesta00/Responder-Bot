import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";

import type { DownloadedImage } from "../inputs/images.ts";
import { err, type Result } from "../shared/result.ts";
import type { AiEngine, AiError, Generation } from "./engine.ts";
import {
  conversationReplyOutputSchema,
  newSuggestionsOutputSchema,
  prospectIdentityOutputSchema,
  screenshotsOutputSchema,
  toConversationReply,
  toNewSuggestions,
  toProspectIdentity,
  toScreenshotsAnalysis,
  type InvalidOutput,
} from "./outputs.ts";
import { costOf, type ModelUsage } from "./pricing.ts";
import { promptSignature } from "./prompts/layer.ts";
import {
  conversationRequest,
  newSuggestionsRequest,
  PROMPT_LAYERS,
  PROSPECT_IDENTITY_REQUEST,
  screenshotsRequest,
  type PromptMode,
} from "./prompts/modes.ts";

type ContentBlock = Anthropic.Beta.Messages.BetaContentBlockParam;
type Message = Anthropic.Beta.Messages.BetaMessage;

// If the model declines a request, the API re-runs it on the fallback model
// Anthropic recommends for that kind of refusal.
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

type ModeSettings = Readonly<{
  /** The main model, or the small and fast one. */
  tier: "MAIN" | "FAST";
  maxTokens: number;
  /** How much the model reasons; null leaves the model's default. */
  effort: "medium" | "high" | null;
  /** Whether a refusal is retried on the fallback model. */
  fallback: boolean;
}>;

// Only the analyses need the large model, its effort and its fallback, with
// room for adaptive thinking as well as the answer. Recognizing the prospect
// only returns a username and a name.
const ANALYSIS: ModeSettings = {
  tier: "MAIN",
  maxTokens: 16_000,
  effort: "high",
  fallback: true,
};

const MODE_SETTINGS = {
  PROSPECT_IDENTITY: {
    tier: "FAST",
    maxTokens: 1_024,
    effort: null,
    fallback: false,
  },
  SCREENSHOTS: ANALYSIS,
  CONVERSATION_REPLY: ANALYSIS,
  // A button asks for text in the same voice, not a new analysis: the main
  // model with less reasoning, to answer sooner, as Alex chose.
  NEW_SUGGESTIONS: { ...ANALYSIS, effort: "medium" },
} satisfies Record<PromptMode, ModeSettings>;

// The schemas as the SDK adapts them for strict structured outputs; the
// answers are then validated against the original Zod schemas.
const OUTPUT_SCHEMAS = {
  PROSPECT_IDENTITY: betaZodOutputFormat(prospectIdentityOutputSchema).schema,
  SCREENSHOTS: betaZodOutputFormat(screenshotsOutputSchema).schema,
  CONVERSATION_REPLY: betaZodOutputFormat(conversationReplyOutputSchema).schema,
  NEW_SUGGESTIONS: betaZodOutputFormat(newSuggestionsOutputSchema).schema,
} satisfies Record<PromptMode, unknown>;

export type ClaudeEngineOptions = Readonly<{
  client: Anthropic;
  /** The model that analyzes conversations and writes the suggestions. */
  model: string;
  /** A small, fast model for simple steps, such as recognizing a prospect. */
  fastModel: string;
  /** Clock for measuring durations, in milliseconds. */
  now?: () => number;
  /** Today's date, which the memory is compared with. */
  today?: () => Date;
}>;

const imageBlock = (image: DownloadedImage): ContentBlock => ({
  type: "image",
  source: {
    type: "base64",
    media_type: image.format,
    // Encodes the bytes without copying them first; the encoded string is
    // released once the request is sent.
    data: Buffer.from(
      image.bytes.buffer,
      image.bytes.byteOffset,
      image.bytes.byteLength,
    ).toString("base64"),
  },
});

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const resultOf = <Output, T>(
  message: Message,
  schema: z.ZodType<Output>,
  toDomain: (output: Output) => Result<T, InvalidOutput>,
): Result<T, AiError> => {
  // Check why the model stopped before reading what it wrote.
  if (message.stop_reason === "refusal") {
    return err({ type: "REFUSED" });
  }
  if (message.stop_reason === "max_tokens") {
    return err({ type: "TRUNCATED" });
  }

  const text = message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .at(-1);
  const output = schema.safeParse(
    text === undefined ? undefined : parseJson(text),
  );
  return output.success
    ? toDomain(output.data)
    : err({
        type: "INVALID_OUTPUT",
        reason: "the answer does not match the schema",
      });
};

/**
 * The tokens each model billed. When the API fell back to another model, the
 * iterations separate the declined attempt from the one that answered.
 */
const usageOf = (message: Message, requested: string): ModelUsage[] => {
  const { usage } = message;
  const sampled = (usage.iterations ?? []).flatMap((iteration) =>
    iteration.type === "message" || iteration.type === "fallback_message"
      ? [iteration]
      : [],
  );
  if (sampled.length === 0) {
    const cacheWrite = usage.cache_creation_input_tokens ?? 0;
    return [
      {
        model: message.model,
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        cacheReadTokens: usage.cache_read_input_tokens ?? 0,
        cacheWrite5mTokens:
          usage.cache_creation?.ephemeral_5m_input_tokens ?? cacheWrite,
        cacheWrite1hTokens:
          usage.cache_creation?.ephemeral_1h_input_tokens ?? 0,
      },
    ];
  }
  return sampled.map((iteration) => ({
    model: iteration.model ?? requested,
    inputTokens: iteration.input_tokens,
    outputTokens: iteration.output_tokens,
    cacheReadTokens: iteration.cache_read_input_tokens,
    cacheWrite5mTokens:
      iteration.cache_creation?.ephemeral_5m_input_tokens ??
      iteration.cache_creation_input_tokens,
    cacheWrite1hTokens:
      iteration.cache_creation?.ephemeral_1h_input_tokens ?? 0,
  }));
};

const errorOf = (error: unknown): AiError => {
  if (!(error instanceof Anthropic.APIError)) {
    // Not a failure of the API call: let the caller treat it as a bug.
    throw error;
  }
  // instanceof on the generic class types the status as any.
  const status: unknown = error.status;
  if (typeof status !== "number") {
    // Connection failures and timeouts carry no status.
    return { type: "UNAVAILABLE", status: null };
  }
  return status === 429 || status >= 500
    ? { type: "UNAVAILABLE", status }
    : { type: "REJECTED", status };
};

/** AI engine backed by Claude through the Anthropic Messages API. */
export const createClaudeEngine = ({
  client,
  model,
  fastModel,
  now = () => performance.now(),
  today = () => new Date(),
}: ClaudeEngineOptions): AiEngine => {
  const generate = async <Output, T>(
    mode: PromptMode,
    content: readonly ContentBlock[],
    schema: z.ZodType<Output>,
    toDomain: (output: Output) => Result<T, InvalidOutput>,
  ): Promise<Generation<T>> => {
    const layers = PROMPT_LAYERS[mode];
    const settings: ModeSettings = MODE_SETTINGS[mode];
    const format = {
      type: "json_schema",
      schema: OUTPUT_SCHEMAS[mode],
    } as const;
    const started = now();
    const report = {
      mode,
      prompt: promptSignature(layers),
      model: null,
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      costMicroUsd: null,
      stopReason: null,
    };

    const requested = settings.tier === "FAST" ? fastModel : model;
    try {
      const message = await client.beta.messages.create({
        model: requested,
        max_tokens: settings.maxTokens,
        ...(settings.fallback
          ? { betas: [FALLBACK_BETA], fallbacks: "default" as const }
          : {}),
        system: [
          {
            type: "text",
            text: layers.map((layer) => layer.text).join("\n\n"),
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: [...content] }],
        output_config:
          settings.effort === null
            ? { format }
            : { effort: settings.effort, format },
      });
      return {
        result: resultOf(message, schema, toDomain),
        report: {
          ...report,
          model: message.model,
          durationMs: now() - started,
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
          cacheReadTokens: message.usage.cache_read_input_tokens,
          cacheWriteTokens: message.usage.cache_creation_input_tokens,
          costMicroUsd: costOf(usageOf(message, requested)),
          stopReason: message.stop_reason,
        },
      };
    } catch (error) {
      return {
        result: err(errorOf(error)),
        report: { ...report, durationMs: now() - started },
      };
    }
  };

  return {
    identifyProspect: (images) =>
      generate(
        "PROSPECT_IDENTITY",
        [
          ...images.map(imageBlock),
          { type: "text", text: PROSPECT_IDENTITY_REQUEST },
        ],
        prospectIdentityOutputSchema,
        toProspectIdentity,
      ),
    analyzeScreenshots: (images, note, memory) =>
      generate(
        "SCREENSHOTS",
        // Images first, then the request that refers to them.
        [
          ...images.map(imageBlock),
          { type: "text", text: screenshotsRequest(note, memory, today()) },
        ],
        screenshotsOutputSchema,
        toScreenshotsAnalysis,
      ),
    replyToConversation: (text, memory) =>
      generate(
        "CONVERSATION_REPLY",
        [{ type: "text", text: conversationRequest(text, memory, today()) }],
        conversationReplyOutputSchema,
        toConversationReply,
      ),
    suggestAgain: (request, memory) =>
      generate(
        "NEW_SUGGESTIONS",
        [
          {
            type: "text",
            text: newSuggestionsRequest(request, memory, today()),
          },
        ],
        newSuggestionsOutputSchema,
        toNewSuggestions(request.kind),
      ),
  };
};
