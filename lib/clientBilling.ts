export const UPFRONT_KINDS = ["percent_25", "percent_50", "percent_75", "paid", "custom"] as const;

export type UpfrontKind = (typeof UPFRONT_KINDS)[number];
export type CustomUpfrontMode = "percent" | "amount";
export type ClientBillingState = "unset" | "waiting" | "cleared";

export type ClientBillingInput = {
  clientBudget: number | null;
  upfrontKind: UpfrontKind;
  customMode: CustomUpfrontMode | null;
  customPercent: number | null;
  customAmount: number | null;
  receivedAmount: number | null;
};

function thousandsGroups(parts: string[]): boolean {
  return parts.length > 1 && parts[0].length > 0 && parts[0].length <= 3 && parts.slice(1).every((part) => part.length === 3);
}

/** Accepts 15000, 15.000, 15.000,50, and 15,50. A dot before exactly three digits is a thousands mark. */
export function parseBillingNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value * 100) / 100;
  if (typeof value !== "string") return null;
  const raw = value.trim().replace(/\s/g, "");
  if (!raw) return null;

  const lastComma = raw.lastIndexOf(",");
  const lastDot = raw.lastIndexOf(".");
  let normalized = raw;
  if (lastComma >= 0 && lastDot >= 0) {
    normalized = lastComma > lastDot ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/,/g, "");
  } else if (lastComma >= 0) {
    normalized = thousandsGroups(raw.split(",")) ? raw.replace(/,/g, "") : raw.replace(",", ".");
  } else if (lastDot >= 0 && thousandsGroups(raw.split("."))) {
    normalized = raw.replace(/\./g, "");
  }

  const n = Number(normalized);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

export function upfrontKindLabel(kind: UpfrontKind): string {
  if (kind === "percent_25") return "25%";
  if (kind === "percent_50") return "50%";
  if (kind === "percent_75") return "75%";
  if (kind === "paid") return "Paid";
  return "Custom";
}

/** Amount the client must send before production is cleared to start. */
export function upfrontDue(input: ClientBillingInput): number | null {
  if (input.upfrontKind === "custom" && input.customMode === "amount") {
    if (input.customAmount == null || input.customAmount < 0) return null;
    return Math.round(input.customAmount * 100) / 100;
  }
  const budget = input.clientBudget;
  if (budget == null || budget < 0) return null;
  let pct = 0.5;
  if (input.upfrontKind === "percent_25") pct = 0.25;
  else if (input.upfrontKind === "percent_75") pct = 0.75;
  else if (input.upfrontKind === "paid") pct = 1;
  else if (input.upfrontKind === "custom") {
    if (input.customPercent == null || input.customPercent < 0) return null;
    pct = input.customPercent / 100;
  }
  return Math.round(budget * pct * 100) / 100;
}

export function clientBillingState(input: ClientBillingInput): ClientBillingState {
  const due = upfrontDue(input);
  if (due == null) return "unset";
  const received = input.receivedAmount ?? 0;
  return received + 0.001 >= due ? "cleared" : "waiting";
}

export function quoteTotal(lines: { amount: number | null }[]): number {
  const sum = lines.reduce((s, line) => s + (line.amount != null && line.amount > 0 ? line.amount : 0), 0);
  return Math.round(sum * 100) / 100;
}
