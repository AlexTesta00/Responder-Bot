import { err, ok, type Result } from "../shared/result.ts";

/** A picture sent to the bot, stored by Telegram until it is downloaded. */
export type ImageRef = Readonly<{
  fileId: string;
  /** Size in bytes, when Telegram reports it. */
  fileSize: number | null;
}>;

/** Formats the analysis can read. */
export type ImageFormat = "image/jpeg" | "image/png" | "image/webp";

export type DownloadedImage = Readonly<{
  format: ImageFormat;
  bytes: Uint8Array;
}>;

export type ImageDownloadError =
  | Readonly<{ type: "IMAGE_TOO_LARGE" }>
  | Readonly<{ type: "UNSUPPORTED_IMAGE_FORMAT" }>
  | Readonly<{ type: "DOWNLOAD_FAILED"; reason: string }>;

export type DownloadImage = (
  image: ImageRef,
) => Promise<Result<Uint8Array, ImageDownloadError>>;

const startsWith = (
  bytes: Uint8Array,
  signature: readonly number[],
  offset = 0,
): boolean => signature.every((byte, index) => bytes[offset + index] === byte);

/** Recognizes an image from its first bytes, whatever its declared type. */
export const detectImageFormat = (bytes: Uint8Array): ImageFormat | null => {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return "image/jpeg";
  }
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  // "RIFF", four bytes of size, then "WEBP".
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return "image/webp";
  }
  return null;
};

/**
 * Downloads the images, hands them to `use` and wipes their bytes afterwards,
 * whatever happens. Screenshots are kept in memory only, never on disk, and
 * do not outlive the processing that needs them. Copies made by `use` are its
 * own responsibility.
 */
export const withDownloadedImages = async <T>(
  images: readonly ImageRef[],
  download: DownloadImage,
  use: (images: readonly DownloadedImage[]) => Promise<T>,
): Promise<Result<T, ImageDownloadError>> => {
  const downloaded: DownloadedImage[] = [];
  try {
    for (const image of images) {
      const bytes = await download(image);
      if (!bytes.ok) {
        return bytes;
      }

      const format = detectImageFormat(bytes.value);
      if (format === null) {
        bytes.value.fill(0);
        return err({ type: "UNSUPPORTED_IMAGE_FORMAT" });
      }
      downloaded.push({ format, bytes: bytes.value });
    }

    return ok(await use(downloaded));
  } finally {
    for (const image of downloaded) {
      image.bytes.fill(0);
    }
  }
};
