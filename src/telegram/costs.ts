// What the analyses cost, in Italian and in Telegram HTML: a line under each
// answer and the reply to /credito. Every figure is an estimate (see
// ai/pricing.ts).
import { remaining, type Spending } from "../ai/spending.ts";
import { escapeHtml } from "./suggestions.ts";

/** Below this credit the line warns Alex to top up, in millionths of a dollar. */
export const LOW_CREDIT_MICRO_USD = 2_000_000;

/** The share of the monthly limit left below which the line warns Alex. */
const LOW_LIMIT_SHARE = 0.1;

const DOLLARS = new Intl.NumberFormat("it-IT", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const DAY = new Intl.DateTimeFormat("it-IT", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "Europe/Rome",
});

/** Dollars as Alex reads them, such as "1.234,56 $" or "<0,01 $", escaped. */
export const formatUsd = (microUsd: number): string =>
  escapeHtml(
    microUsd > 0 && microUsd < 5_000
      ? "<0,01 $"
      : `${DOLLARS.format(Math.max(0, microUsd) / 1_000_000)} $`,
  );

export type CostContext = Readonly<{
  /** What the generations of this answer cost, when it is known. */
  costMicroUsd: number | null;
  /** The month and the credit, when they could be read. */
  spending: Spending | null;
  monthlyLimitMicroUsd: number | null;
}>;

const limitLeft = (spending: Spending, limit: number): number =>
  Math.max(0, limit - spending.monthMicroUsd);

/**
 * "💳 Questa analisi ~0,06 $ · mese ~1,24 $, restano ~18,76 $ di 20,00 $ ·
 * credito ~23,76 $", or null when there is nothing to say. It warns when the
 * month is close to its limit or the credit is running out.
 */
export const costLine = ({
  costMicroUsd,
  spending,
  monthlyLimitMicroUsd: limit,
}: CostContext): string | null => {
  const credit = spending?.credit ?? null;
  const parts = [
    costMicroUsd === null ? null : `Questa analisi ~${formatUsd(costMicroUsd)}`,
    spending === null
      ? null
      : `mese ~${formatUsd(spending.monthMicroUsd)}` +
        (limit === null
          ? ""
          : `, restano ~${formatUsd(limitLeft(spending, limit))} di ${formatUsd(limit)}`),
    credit === null ? null : `credito ~${formatUsd(remaining(credit))}`,
  ].filter((part) => part !== null);
  if (parts.length === 0) {
    return null;
  }
  const low =
    spending !== null &&
    ((limit !== null &&
      limitLeft(spending, limit) <= limit * LOW_LIMIT_SHARE) ||
      (credit !== null && remaining(credit) < LOW_CREDIT_MICRO_USD));
  const [first = "", ...rest] = parts;
  const sentence = [
    first.charAt(0).toUpperCase() + first.slice(1),
    ...rest,
  ].join(" · ");
  return `${low ? "⚠️" : "💳"} ${sentence}`;
};

const CREDIT_EXAMPLE = "/credito 25,40";

/** The reply to /credito: the month, the limit and the credit left. */
export const spendingReport = (
  spending: Spending,
  monthlyLimitMicroUsd: number | null,
): string => {
  const { credit } = spending;
  const month =
    `Questo mese: ~${formatUsd(spending.monthMicroUsd)}` +
    (monthlyLimitMicroUsd === null
      ? ""
      : `, restano ~${formatUsd(limitLeft(spending, monthlyLimitMicroUsd))} di ${formatUsd(monthlyLimitMicroUsd)}`);
  const creditLine =
    credit === null
      ? `Credito: non impostato. Leggilo sulla Console di Claude e scrivilo qui, per esempio ${CREDIT_EXAMPLE}.`
      : `Credito: ~${formatUsd(remaining(credit))} (${formatUsd(credit.amountMicroUsd)} il ${DAY.format(credit.setAt)}, meno ~${formatUsd(credit.spentMicroUsd)} spesi da allora)`;
  return [
    "💳 <b>Costi stimati</b>",
    month,
    creditLine,
    "",
    "Sono stime calcolate dai token di ogni analisi: le cifre esatte sono sulla Console di Claude.",
  ].join("\n");
};

export const creditSetReply = (amountMicroUsd: number): string =>
  `✅ Credito impostato a ${formatUsd(amountMicroUsd)}: da ora tolgo il costo stimato di ogni analisi.`;

export const INVALID_CREDIT_REPLY = `Scrivi il credito in dollari, come lo vedi sulla Console di Claude: per esempio ${CREDIT_EXAMPLE}.`;

export const SPENDING_UNAVAILABLE_REPLY =
  "⚠️ Non riesco a leggere i costi: il database non risponde. Riprova tra poco.";
