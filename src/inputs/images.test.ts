import { describe, expect, it, vi } from "vitest";

import { err, ok } from "../shared/result.ts";
import {
  detectImageFormat,
  withDownloadedImages,
  type DownloadedImage,
  type DownloadImage,
  type ImageRef,
} from "./images.ts";

const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00];
const WEBP = [
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
];
// An iPhone photo in HEIC: "....ftypheic".
const HEIC = [
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63,
];

const refs = (count: number): readonly ImageRef[] =>
  Array.from({ length: count }, (_, index) => ({
    fileId: `file-${String(index)}`,
    fileSize: null,
  }));

/** Download that returns fresh bytes of `signature` for every image. */
const downloadAs =
  (signature: readonly number[]): DownloadImage =>
  () =>
    Promise.resolve(ok(Uint8Array.from(signature)));

const isWiped = (image: DownloadedImage): boolean =>
  image.bytes.every((byte) => byte === 0);

describe("detectImageFormat", () => {
  it.each([
    ["JPEG", JPEG, "image/jpeg"],
    ["PNG", PNG, "image/png"],
    ["WebP", WEBP, "image/webp"],
  ])("recognizes %s", (_name, signature, format) => {
    expect(detectImageFormat(Uint8Array.from(signature))).toBe(format);
  });

  it.each([
    ["HEIC", HEIC],
    ["text", [...new TextEncoder().encode("<html>")]],
    ["an empty file", []],
  ])("does not accept %s", (_name, signature) => {
    expect(detectImageFormat(Uint8Array.from(signature))).toBeNull();
  });
});

describe("withDownloadedImages", () => {
  it("hands the downloaded images to the processing", async () => {
    const result = await withDownloadedImages(
      refs(2),
      downloadAs(PNG),
      (images) => Promise.resolve(images.map((image) => image.format)),
    );

    expect(result).toStrictEqual(ok(["image/png", "image/png"]));
  });

  it("wipes the images once the processing ends", async () => {
    const seen: DownloadedImage[] = [];

    await withDownloadedImages(refs(2), downloadAs(JPEG), (images) => {
      seen.push(...images);
      return Promise.resolve();
    });

    expect(seen).toHaveLength(2);
    expect(seen.every(isWiped)).toBe(true);
  });

  it("wipes the images even when the processing fails", async () => {
    const seen: DownloadedImage[] = [];

    const processing = withDownloadedImages(
      refs(1),
      downloadAs(JPEG),
      (images) => {
        seen.push(...images);
        return Promise.reject(new Error("analysis failed"));
      },
    );

    await expect(processing).rejects.toThrow("analysis failed");
    expect(seen.every(isWiped)).toBe(true);
  });

  it("stops at the first image it cannot download and wipes the others", async () => {
    const first = Uint8Array.from(PNG);
    const download = vi
      .fn<DownloadImage>()
      .mockResolvedValueOnce(ok(first))
      .mockResolvedValueOnce(err({ type: "DOWNLOAD_FAILED", reason: "test" }));
    const use = vi.fn(() => Promise.resolve());

    const result = await withDownloadedImages(refs(3), download, use);

    expect(result).toStrictEqual(
      err({ type: "DOWNLOAD_FAILED", reason: "test" }),
    );
    expect(download).toHaveBeenCalledTimes(2);
    expect(use).not.toHaveBeenCalled();
    expect(first.every((byte) => byte === 0)).toBe(true);
  });

  it("rejects images the analysis cannot read and wipes them", async () => {
    const heic = Uint8Array.from(HEIC);
    const use = vi.fn(() => Promise.resolve());

    const result = await withDownloadedImages(
      refs(1),
      () => Promise.resolve(ok(heic)),
      use,
    );

    expect(result).toStrictEqual(err({ type: "UNSUPPORTED_IMAGE_FORMAT" }));
    expect(use).not.toHaveBeenCalled();
    expect(heic.every((byte) => byte === 0)).toBe(true);
  });
});
