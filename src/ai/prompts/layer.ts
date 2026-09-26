/**
 * A versioned part of the instructions sent to the model. Bump the version
 * whenever the text changes, so every generation records which instructions
 * produced it.
 */
export type PromptLayer = Readonly<{
  id: string;
  version: number;
  text: string;
}>;

/** Identifies a combination of layers, for example "system@1+first-message@2". */
export const promptSignature = (layers: readonly PromptLayer[]): string =>
  layers.map((layer) => `${layer.id}@${String(layer.version)}`).join("+");

export const layer = (
  id: string,
  version: number,
  lines: readonly string[],
): PromptLayer => ({ id, version, text: lines.join("\n") });
