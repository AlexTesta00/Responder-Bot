import type { DownloadImage } from "../inputs/images.ts";
import { err, ok } from "../shared/result.ts";
import type { TelegramClient } from "./client.ts";

/** Downloads screenshots through the Bot API, up to `maxBytes` each. */
export const createImageDownloader =
  (
    client: Pick<TelegramClient, "getFile" | "downloadFile">,
    maxBytes: number,
  ): DownloadImage =>
  async (image) => {
    // Telegram usually tells the size in advance: no need to download.
    if (image.fileSize !== null && image.fileSize > maxBytes) {
      return err({ type: "IMAGE_TOO_LARGE" });
    }

    const file = await client.getFile(image.fileId);
    if (!file.ok) {
      return err({
        type: "DOWNLOAD_FAILED",
        reason: `getFile ${file.error.type}`,
      });
    }
    if (file.value.filePath === null) {
      return err({ type: "DOWNLOAD_FAILED", reason: "file not available" });
    }

    const bytes = await client.downloadFile(file.value.filePath, maxBytes);
    if (bytes.ok) {
      return ok(bytes.value);
    }
    return bytes.error.type === "FILE_TOO_LARGE"
      ? err({ type: "IMAGE_TOO_LARGE" })
      : err({
          type: "DOWNLOAD_FAILED",
          reason: `download ${bytes.error.type}`,
        });
  };
