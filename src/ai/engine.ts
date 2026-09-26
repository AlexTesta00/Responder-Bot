import type { DownloadedImage } from "../inputs/images.ts";
import type { ProspectMemory } from "../prospects/memory.ts";
import type { Result } from "../shared/result.ts";
import type {
  ConversationReply,
  InvalidOutput,
  ProspectIdentity,
  ScreenshotsAnalysis,
} from "./outputs.ts";
import type { PromptMode } from "./prompts/modes.ts";

export type AiError =
  | InvalidOutput
  /** The model declined the request, even after the fallback. */
  | Readonly<{ type: "REFUSED" }>
  /** The answer hit the output limit before it was complete. */
  | Readonly<{ type: "TRUNCATED" }>
  /** Network failures, rate limits and server errors, once retries ran out. */
  | Readonly<{ type: "UNAVAILABLE"; status: number | null }>
  /** The API refused the request itself, for example an invalid key. */
  | Readonly<{ type: "REJECTED"; status: number }>;

/** What happened during a generation, for the logs; never its content. */
export type GenerationReport = Readonly<{
  mode: PromptMode;
  /** Prompt layers and versions, see promptSignature. */
  prompt: string;
  /** The model that answered, which may be the fallback model. */
  model: string | null;
  durationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  stopReason: string | null;
}>;

export type Generation<T> = Readonly<{
  result: Result<T, AiError>;
  report: GenerationReport;
}>;

/** The intelligence of the bot, independent of the provider behind it. */
export type AiEngine = Readonly<{
  /** A quick, inexpensive look to know whose screenshots they are. */
  identifyProspect: (
    images: readonly DownloadedImage[],
  ) => Promise<Generation<ProspectIdentity>>;
  analyzeScreenshots: (
    images: readonly DownloadedImage[],
    note: string | null,
    /** What the bot remembers about the prospect in the screenshots. */
    memory: ProspectMemory | null,
  ) => Promise<Generation<ScreenshotsAnalysis>>;
  replyToConversation: (
    text: string,
    /** What the bot remembers about the prospect, when Alex said who it is. */
    memory: ProspectMemory | null,
  ) => Promise<Generation<ConversationReply>>;
}>;
