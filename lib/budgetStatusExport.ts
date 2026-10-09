import { formatMoneyAmount } from '@/lib/projectInternalBudget'

/** Snapshot model for the project-space budget PDF. Keep in sync with crea-services/lib/budget-status-export.ts. */

export type BudgetStatusProject = {
  title: string;
  location?: string | null;
  statusLabel?: string | null;
  scheduleStart?: string | null;
  scheduleEnd?: string | null;
  clientLabel?: string | null;
};

export type BudgetStatusCrewLine = {
  displayName: string;
  dayUnits: number;
  dayRate: number;
  halfDayRate: number | null;
  subtotal: number;
};

export type BudgetStatusEquipmentLine = {
  displayName: string;
  qty: number;
  unitPrice: number;
  subtotal: number;
  period?: string | null;
};

export type BudgetStatusExpenseLine = {
  label: string;
  planned: number;
  actual: number;
};

export type BudgetStatusExportInput = {
  project: BudgetStatusProject;
  exportedAt: Date;
  currency: string;
  hideCrew: boolean;
  totalBudget: number | null;
  productionBudget: number | null;
  currentHeadroom: number | null;
  crewLogged: number;
  crewLoggedHours: number;
  crewOpen: number;
  equipmentTotal: number;
  otherCurrent: number;
  productionRemaining: number | null;
  forecastRemaining: number | null;
  wrapUpVariance: number | null;
  otherPlanned: number;
  otherSpent: number;
  crewBookedTotal: number;
  currenciesMixed: boolean;
  equipmentPeriod?: string | null;
  crewLines: BudgetStatusCrewLine[];
  equipmentLines: BudgetStatusEquipmentLine[];
  expenseLines: BudgetStatusExpenseLine[];
};

export type BudgetStatusTone = "over" | "under" | "neutral";

export type BudgetStatusRow = { label: string; value: string };

export type BudgetStatusBlock =
  | { kind: "rows"; title: string; caption?: string; rows: BudgetStatusRow[] }
  | { kind: "table"; title: string; caption?: string; headers: string[]; rows: string[][] };

export type BudgetStatusDocument = {
  projectTitle: string;
  exportedStamp: string;
  facts: BudgetStatusRow[];
  standPhrase: string;
  standAmount: string;
  standTone: BudgetStatusTone;
  blocks: BudgetStatusBlock[];
};

export function formatBudgetExportStamp(date: Date): string {
  const datePart = new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
  const timePart = new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
  const tz = new Intl.DateTimeFormat("de-DE", { timeZoneName: "short" })
    .formatToParts(date)
    .find((part) => part.type === "timeZoneName")?.value;
  return tz ? `${datePart}, ${timePart} ${tz}` : `${datePart}, ${timePart}`;
}

export function budgetStandPhrase(headroom: number | null): string {
  if (headroom == null) return "No total budget set";
  if (headroom < 0) return "Over budget";
  if (headroom > 0) return "Under budget";
  return "On budget";
}

export function budgetStandTone(headroom: number | null): BudgetStatusTone {
  if (headroom == null || headroom === 0) return "neutral";
  return headroom < 0 ? "over" : "under";
}

export function signedBudgetAmount(amount: number | null, currency: string): string {
  if (amount == null) return "—";
  const sign = amount < 0 ? "−" : amount > 0 ? "+" : "";
  return `${sign}${formatMoneyAmount(Math.abs(amount), currency)}`;
}

function formatIsoDate(iso: string | null | undefined): string | null {
  const day = (iso ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const [year, month, date] = day.split("-");
  return `${date}.${month}.${year}`;
}

export function formatScheduleLabel(start?: string | null, end?: string | null): string | null {
  const from = formatIsoDate(start);
  const to = formatIsoDate(end);
  if (from && to && from !== to) return `${from} – ${to}`;
  return from || to;
}

export function budgetStatusFilename(title: string, exportedAt: Date): string {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "project";
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${exportedAt.getFullYear()}-${pad(exportedAt.getMonth() + 1)}-${pad(exportedAt.getDate())}-${pad(exportedAt.getHours())}${pad(exportedAt.getMinutes())}`;
  return `${slug}-budget-${stamp}.pdf`;
}

function money(amount: number | null | undefined, currency: string): string {
  return formatMoneyAmount(amount, currency);
}

function crewDetail(line: BudgetStatusCrewLine, currency: string): string {
  const days = `${line.dayUnits % 1 === 0 ? String(line.dayUnits) : line.dayUnits.toFixed(1)}d equiv`;
  if (line.halfDayRate != null && line.halfDayRate > 0) {
    return `${days} · day ${money(line.dayRate, currency)} / half ${money(line.halfDayRate, currency)}`;
  }
  return `${days} · ${money(line.dayRate, currency)} day`;
}

function countedExpense(line: BudgetStatusExpenseLine): { amount: number; source: "Actual" | "Plan" } {
  if (line.actual > 0) return { amount: line.actual, source: "Actual" };
  return { amount: line.planned, source: "Plan" };
}

export function buildBudgetStatusDocument(input: BudgetStatusExportInput): BudgetStatusDocument {
  const currency = input.currency.trim().toUpperCase() || "EUR";
  const title = input.project.title.trim() || "Project";
  const facts: BudgetStatusRow[] = [{ label: "Exported", value: formatBudgetExportStamp(input.exportedAt) }];
  const location = input.project.location?.trim();
  if (location) facts.push({ label: "Location", value: location });
  const status = input.project.statusLabel?.trim();
  if (status) facts.push({ label: "Status", value: status });
  const schedule = formatScheduleLabel(input.project.scheduleStart, input.project.scheduleEnd);
  if (schedule) facts.push({ label: "Shoot dates", value: schedule });
  const client = input.project.clientLabel?.trim();
  if (client) facts.push({ label: "Client", value: client });

  const currentRows: BudgetStatusRow[] = [
    {
      label: "Total project budget",
      value: input.totalBudget != null ? money(input.totalBudget, currency) : "Not set",
    },
  ];
  if (!input.hideCrew && input.productionBudget != null) {
    currentRows.push({ label: "Production bucket", value: money(input.productionBudget, currency) });
  }
  if (!input.hideCrew) {
    currentRows.push(
      { label: `Crew logged (${input.crewLoggedHours}h)`, value: money(input.crewLogged, currency) },
      { label: "Crew still booked", value: money(input.crewOpen, currency) },
    );
  }
  currentRows.push(
    { label: "Equipment (kit list)", value: money(input.equipmentTotal, currency) },
    { label: "Other expenses (actual or plan)", value: money(input.otherCurrent, currency) },
  );
  if (!input.hideCrew && input.productionRemaining != null) {
    currentRows.push({
      label: "Remaining in production bucket",
      value: money(input.productionRemaining, currency),
    });
  }
  currentRows.push({
    label: budgetStandPhrase(input.currentHeadroom),
    value: signedBudgetAmount(input.currentHeadroom, currency),
  });

  const blocks: BudgetStatusBlock[] = [
    {
      kind: "rows",
      title: "Current stand",
      caption: "During the shoot — logged hours so far, plus booked days that have no timesheet yet.",
      rows: currentRows,
    },
  ];

  if (!input.hideCrew) {
    blocks.push({
      kind: "table",
      title: "Crew",
      caption: input.currenciesMixed
        ? "Some day rates use a different currency than this plan — totals may be misleading."
        : "Booked day-equivalents × profile rates.",
      headers: ["Name", "Booking", "Amount"],
      rows:
        input.crewLines.length === 0
          ? []
          : input.crewLines.map((line) => [
              line.displayName.trim() || "Crew member",
              crewDetail(line, currency),
              money(line.subtotal, currency),
            ]),
    });
  }

  blocks.push({
    kind: "table",
    title: "Equipment",
    caption: input.equipmentPeriod?.trim()
      ? `Rental: ${input.equipmentPeriod.trim()}. Kit-list qty × unit price.`
      : "Kit-list qty × unit price. Items without a price are omitted.",
    headers: ["Item", "Qty × price", "Amount"],
    rows: input.equipmentLines.map((line) => {
      const period =
        line.period && line.period !== input.equipmentPeriod ? ` · ${line.period}` : "";
      return [
        line.displayName.trim() || "Equipment",
        `${line.qty} × ${money(line.unitPrice, currency)}${period}`,
        money(line.subtotal, currency),
      ];
    }),
  });

  blocks.push({
    kind: "table",
    title: "Other expenses",
    caption: "Counted now uses the actual amount when it is above zero, otherwise the plan.",
    headers: ["Label", "Planned", "Actual", "Counted now"],
    rows: input.expenseLines.map((line) => {
      const counted = countedExpense(line);
      return [
        line.label.trim() || "Expense",
        money(line.planned, currency),
        money(line.actual, currency),
        `${money(counted.amount, currency)} (${counted.source})`,
      ];
    }),
  });

  const forecastRows: BudgetStatusRow[] = [];
  if (!input.hideCrew) forecastRows.push({ label: "Crew (booked)", value: money(input.crewBookedTotal, currency) });
  forecastRows.push(
    { label: "Equipment (kit list)", value: money(input.equipmentTotal, currency) },
    { label: "Other expenses (planned)", value: money(input.otherPlanned, currency) },
    { label: "Headroom", value: signedBudgetAmount(input.forecastRemaining, currency) },
  );
  blocks.push({
    kind: "rows",
    title: "Forecast",
    caption: "Before the shoot — uses planned other expenses.",
    rows: forecastRows,
  });

  const wrapRows: BudgetStatusRow[] = [];
  if (!input.hideCrew) wrapRows.push({ label: "Crew (booked)", value: money(input.crewBookedTotal, currency) });
  wrapRows.push(
    { label: "Equipment (kit list)", value: money(input.equipmentTotal, currency) },
    { label: "Other expenses (actual)", value: money(input.otherSpent, currency) },
    { label: "Balance", value: signedBudgetAmount(input.wrapUpVariance, currency) },
  );
  blocks.push({
    kind: "rows",
    title: "Wrap-up",
    caption: "After the shoot — uses actual spend on other expenses.",
    rows: wrapRows,
  });

  return {
    projectTitle: title,
    exportedStamp: formatBudgetExportStamp(input.exportedAt),
    facts,
    standPhrase: budgetStandPhrase(input.currentHeadroom),
    standAmount: signedBudgetAmount(input.currentHeadroom, currency),
    standTone: budgetStandTone(input.currentHeadroom),
    blocks,
  };
}
