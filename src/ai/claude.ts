import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";

import type { DownloadedImage } from "../inputs/images.ts";
import { err, type Result } from "../shared/result.ts";
import type { AiEngine, AiError, Generation } from "./engine.ts";
import {
  conversationReplyOutputSchema,
  prospectIdentityOutputSchema,
  screenshotsOutputSchema,
  toConversationReply,
  toProspectIdentity,
  toScreenshotsAnalysis,
  type InvalidOutput,
} from "./outputs.ts";
import { promptSignature } from "./prompts/layer.ts";
import {
  conversationRequest,
  PROMPT_LAYERS,
  PROSPECT_IDENTITY_REQUEST,
  screenshotsRequest,
  type PromptMode,
} from "./prompts/modes.ts";

type ContentBlock = Anthropic.Beta.Messages.BetaContentBlockParam;
type Message = Anthropic.Beta.Messages.BetaMessage;

// Room for the model's adaptive thinking as well as its answer.
const MAX_TOKENS = 16_000;

// Recognizing the prospect only returns a username and a name.
const IDENTITY_MAX_TOKENS = 1_024;

// If the model declines a request, the API re-runs it on the fallback model
// Anthropic recommends for that kind of refusal.
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

// The schemas as the SDK adapts them for strict structured outputs; the
// answers are then validated against the original Zod schemas.
const OUTPUT_SCHEMAS = {
  PROSPECT_IDENTITY: betaZodOutputFormat(prospectIdentityOutputSchema).schema,
  SCREENSHOTS: betaZodOutputFormat(screenshotsOutputSchema).schema,
  CONVERSATION_REPLY: betaZodOutputFormat(conversationReplyOutputSchema).schema,
} satisfies Record<PromptMode, unknown>;

export type ClaudeEngineOptions = Readonly<{
  client: Anthropic;
  /** The model that analyzes conversations and writes the suggestions. */
  model: string;
  /** A small, fast model for simple steps, such as recognizing a prospect. */
  fastModel: string;
  /** Clock for measuring durations, in milliseconds. */
  now?: () => number;
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
}: ClaudeEngineOptions): AiEngine => {
  const generate = async <Output, T>(
    mode: PromptMode,
    content: readonly ContentBlock[],
    schema: z.ZodType<Output>,
    toDomain: (output: Output) => Result<T, InvalidOutput>,
  ): Promise<Generation<T>> => {
    const layers = PROMPT_LAYERS[mode];
    // Only the analysis needs the large model, its effort and its fallback.
    const quick = mode === "PROSPECT_IDENTITY";
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
      stopReason: null,
    };

    try {
      const message = await client.beta.messages.create({
        model: quick ? fastModel : model,
        max_tokens: quick ? IDENTITY_MAX_TOKENS : MAX_TOKENS,
        ...(quick
          ? {}
          : { betas: [FALLBACK_BETA], fallbacks: "default" as const }),
        system: [
          {
            type: "text",
            text: layers.map((layer) => layer.text).join("\n\n"),
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: [...content] }],
        output_config: quick ? { format } : { effort: "high", format },
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
    analyzeScreenshots: (images, note) =>
      generate(
        "SCREENSHOTS",
        // Images first, then the request that refers to them.
        [
          ...images.map(imageBlock),
          { type: "text", text: screenshotsRequest(note) },
        ],
        screenshotsOutputSchema,
        toScreenshotsAnalysis,
      ),
    replyToConversation: (text) =>
      generate(
        "CONVERSATION_REPLY",
        [{ type: "text", text: conversationRequest(text) }],
        conversationReplyOutputSchema,
        toConversationReply,
      ),
  };
};
