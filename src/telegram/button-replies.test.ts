import { describe, expect, it } from "vitest";

import type { MarkedSend } from "../copilot/sends.ts";
import { romeDay } from "../shared/time.ts";
import {
  BUSY_NOTICE,
  EXPIRED_BUTTON_NOTICE,
  pressNotice,
  sentNotice,
} from "./button-replies.ts";

// Sunday 27 September 2026, 10:42 in Italy.
const NOW = new Date("2026-09-27T08:42:00Z");

describe("sentNotice", () => {
  it.each<[MarkedSend, string]>([
    [
      {
        type: "RECORDED",
        style: "BEST",
        sentAt: NOW,
        situation: {
          type: "WAITING",
          number: 1,
          lastOutboundAt: NOW,
          dueDay: romeDay(NOW) + 3,
        },
      },
      "✅ Segnato come inviato. Se non risponde, te lo ricordo in /oggi da mercoledì 30/09.",
    ],
    [
      {
        type: "RECORDED",
        style: "BEST",
        sentAt: NOW,
        situation: { type: "PAUSED", pause: "FOLLOW_UP_LIMIT" },
      },
      "✅ Segnato. Era l'ultimo follow-up: se non risponde mi fermo qui.",
    ],
    [
      {
        type: "RECORDED",
        style: null,
        sentAt: NOW,
        situation: { type: "PAUSED", pause: "CLOSED" },
      },
      "✅ Segnato: saluto finale inviato. Non ti proporrò altri messaggi finché non ti riscrive.",
    ],
    [
      { type: "RECORDED", style: "BEST", sentAt: NOW, situation: null },
      "✅ Segnato come inviato.",
    ],
    [
      { type: "CORRECTED", style: "DIRECT", sentAt: NOW, situation: null },
      "✅ Corretto: segnato DIRECT come inviato.",
    ],
    [
      { type: "UNCHANGED", style: "BEST", sentAt: NOW, situation: null },
      "✅ Già segnato come inviato il 27/09 alle 10:42.",
    ],
    [
      { type: "NOT_LINKED" },
      "🤷 Non so di quale prospect parla questo messaggio: non l'ho segnato.",
    ],
    [
      { type: "UNAVAILABLE" },
      "⚠️ Memoria non disponibile: non l'ho segnato. Riprova tra poco.",
    ],
  ])("tells what happened: %j", (marked, notice) => {
    expect(sentNotice(marked, NOW)).toBe(notice);
  });
});

describe("notices", () => {
  it("fit in the 200 characters of a notice", () => {
    const notices = [
      EXPIRED_BUTTON_NOTICE,
      BUSY_NOTICE,
      ...(["MORE", "NATURAL", "DIRECT", "FOLLOW_UP", "ANALYZE"] as const).map(
        (action) => pressNotice(action) ?? "",
      ),
      sentNotice(
        {
          type: "RECORDED",
          style: "ALTERNATIVE",
          sentAt: NOW,
          situation: {
            type: "WAITING",
            number: 2,
            lastOutboundAt: NOW,
            dueDay: romeDay(NOW) + 7,
          },
        },
        NOW,
      ),
      sentNotice(
        {
          type: "RECORDED",
          style: null,
          sentAt: NOW,
          situation: { type: "PAUSED", pause: "CLOSED" },
        },
        NOW,
      ),
    ];

    for (const notice of notices) {
      expect(notice.length).toBeLessThanOrEqual(200);
    }
  });
});
