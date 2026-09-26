import { describe, expect, it, vi } from "vitest";

import { err, ok } from "../shared/result.ts";
import type { TelegramClient } from "./client.ts";
import { createImageDownloader } from "./files.ts";

const MAX_BYTES = 1_000;
const BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);

const setup = ({
  getFile = () =>
    Promise.resolve(ok({ filePath: "photos/file_7.jpg", fileSize: 4 })),
  downloadFile = () => Promise.resolve(ok(BYTES)),
}: Partial<Pick<TelegramClient, "getFile" | "downloadFile">> = {}) => {
  const client = {
    getFile: vi.fn(getFile),
    downloadFile: vi.fn(downloadFile),
  };
  return { client, download: createImageDownloader(client, MAX_BYTES) };
};

describe("createImageDownloader", () => {
  it("downloads an image through the Bot API", async () => {
    const { client, download } = setup();

    const result = await download({ fileId: "abc", fileSize: 4 });

    expect(result).toStrictEqual(ok(BYTES));
    expect(client.getFile).toHaveBeenCalledExactlyOnceWith("abc");
    expect(client.downloadFile).toHaveBeenCalledExactlyOnceWith(
      "photos/file_7.jpg",
      MAX_BYTES,
    );
  });

  it("refuses images declared too large without contacting Telegram", async () => {
    const { client, download } = setup();

    const result = await download({ fileId: "abc", fileSize: MAX_BYTES + 1 });

    expect(result).toStrictEqual(err({ type: "IMAGE_TOO_LARGE" }));
    expect(client.getFile).not.toHaveBeenCalled();
  });

  it("refuses images that turn out too large", async () => {
    const { download } = setup({
      downloadFile: () =>
        Promise.resolve(
          err({
            type: "FILE_TOO_LARGE",
            method: "downloadFile",
            maxBytes: MAX_BYTES,
          }),
        ),
    });

    expect(await download({ fileId: "abc", fileSize: null })).toStrictEqual(
      err({ type: "IMAGE_TOO_LARGE" }),
    );
  });

  it("reports files Telegram cannot serve", async () => {
    const { download } = setup({
      getFile: () => Promise.resolve(ok({ filePath: null, fileSize: null })),
    });

    expect(await download({ fileId: "abc", fileSize: null })).toStrictEqual(
      err({ type: "DOWNLOAD_FAILED", reason: "file not available" }),
    );
  });

  it.each([
    [
      "the file lookup",
      {
        getFile: () =>
          Promise.resolve(
            err({
              type: "NETWORK_ERROR",
              method: "getFile",
              timedOut: true,
            } as const),
          ),
      },
      "getFile NETWORK_ERROR",
    ],
    [
      "the download",
      {
        downloadFile: () =>
          Promise.resolve(
            err({
              type: "API_ERROR",
              method: "downloadFile",
              status: 404,
              description: "Not Found",
            } as const),
          ),
      },
      "download API_ERROR",
    ],
  ])("reports a failure of %s", async (_step, client, reason) => {
    const { download } = setup(client);

    expect(await download({ fileId: "abc", fileSize: null })).toStrictEqual(
      err({ type: "DOWNLOAD_FAILED", reason }),
    );
  });
});
