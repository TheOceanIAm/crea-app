import { inflateSync, unzipSync, unzlibSync } from "fflate";

export type ShotSheetStatus = "open" | "rolling" | "done" | "pick";

export const SHOT_SHEET_STATUSES: ShotSheetStatus[] = ["open", "rolling", "done", "pick"];

export type ShotSheetRow = {
  id: string;
  cells: string[];
  status: ShotSheetStatus;
};

export type ShotSheet = {
  columns: string[];
  rows: ShotSheetRow[];
  sourceName: string;
};

export type ParsedShotTable = {
  columns: string[];
  rows: { cells: string[]; status: ShotSheetStatus }[];
  truncated: boolean;
};

const MAX_COLS = 16;
const MAX_ROWS = 300;

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(parseInt(num, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function cleanCell(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function statusFromCell(value: string): ShotSheetStatus | null {
  const t = value.trim().toLowerCase();
  if (t === "open" || t === "todo" || t === "to do") return "open";
  if (t === "rolling" || t === "in progress" || t === "shooting") return "rolling";
  if (t === "done" || t === "complete" || t === "completed" || t === "ok" || t === "✓" || t === "x") return "done";
  if (t === "pick" || t === "picked" || t === "select") return "pick";
  return null;
}

function columnIndex(ref: string): number {
  const letters = ref.replace(/[0-9]/g, "").toUpperCase();
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return Math.max(0, n - 1);
}

function matrixFromRows(rawRows: string[][]): ParsedShotTable | { error: string } {
  const rows = rawRows
    .map((row) => row.map(cleanCell))
    .filter((row) => row.some((cell) => cell.length > 0));
  if (rows.length < 2) {
    return { error: "The file needs a header row and at least one shot." };
  }

  let truncated = false;
  let width = Math.max(...rows.map((row) => row.length));
  if (width > MAX_COLS) {
    width = MAX_COLS;
    truncated = true;
  }
  const header = rows[0].slice(0, width);
  const statusAt = header.findIndex((name) => /^(status|state)$/i.test(name));
  const columns: string[] = [];
  header.forEach((name, index) => {
    if (index === statusAt) return;
    const label = name || `Column ${columns.length + 1}`;
    const taken = columns.filter((col) => col.toLowerCase() === label.toLowerCase()).length;
    columns.push(taken > 0 ? `${label} ${taken + 1}` : label);
  });
  if (columns.length === 0) return { error: "The header row is empty." };

  const body = rows.slice(1);
  const limited = body.length > MAX_ROWS ? body.slice(0, MAX_ROWS) : body;
  if (limited.length !== body.length) truncated = true;

  const parsedRows = limited.map((row) => {
    const cells: string[] = [];
    row.slice(0, width).forEach((cell, index) => {
      if (index === statusAt) return;
      cells.push(cell);
    });
    while (cells.length < columns.length) cells.push("");
    const status = statusAt >= 0 ? statusFromCell(row[statusAt] ?? "") ?? "open" : "open";
    return { cells: cells.slice(0, columns.length), status };
  });

  return { columns, rows: parsedRows, truncated };
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === "," || ch === "\t" || ch === ";") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

function sharedStrings(xml: string): string[] {
  const items = xml.match(/<si\b[\s\S]*?<\/si>/g) ?? [];
  return items.map((item) => {
    const parts = [...item.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1]));
    return parts.join("");
  });
}

function worksheetRows(xml: string, strings: string[]): string[][] {
  const rowXml = xml.match(/<row\b[\s\S]*?<\/row>/g) ?? [];
  return rowXml.map((row) => {
    const cells: string[] = [];
    const found = row.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g);
    for (const match of found) {
      const attrs = match[1] ?? "";
      const inner = match[2] ?? "";
      const ref = attrs.match(/\br="([A-Z]+)\d+"/i)?.[1] ?? "";
      const index = ref ? columnIndex(ref) : cells.length;
      const kind = attrs.match(/\bt="([^"]+)"/)?.[1] ?? "";
      let value = "";
      if (kind === "s") {
        const n = Number(inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "");
        value = strings[n] ?? "";
      } else if (kind === "inlineStr") {
        value = [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1])).join("");
      } else {
        value = decodeXml(inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "");
      }
      while (cells.length < index) cells.push("");
      cells[index] = value;
    }
    return cells;
  });
}

function parseXlsx(bytes: Uint8Array): string[][] | { error: string } {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    return { error: "This Excel file could not be opened. Save it as .xlsx and try again." };
  }
  const names = Object.keys(files);
  const sheetName =
    names.find((name) => name === "xl/worksheets/sheet1.xml") ??
    names.find((name) => /xl\/worksheets\/sheet\d+\.xml$/.test(name));
  if (!sheetName) return { error: "No worksheet found in this Excel file." };
  const sheetXml = new TextDecoder().decode(files[sheetName]);
  const sharedName = names.find((name) => name === "xl/sharedStrings.xml");
  const strings = sharedName ? sharedStrings(new TextDecoder().decode(files[sharedName])) : [];
  return worksheetRows(sheetXml, strings);
}

function findAscii(bytes: Uint8Array, needle: string, from = 0): number {
  const n = needle.length;
  for (let i = from; i <= bytes.length - n; i++) {
    let ok = true;
    for (let j = 0; j < n; j++) {
      if (bytes[i + j] !== needle.charCodeAt(j)) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }
  return -1;
}

function latin1(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

function pdfStreams(bytes: Uint8Array): string {
  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < bytes.length) {
    const at = findAscii(bytes, "stream", cursor);
    if (at < 0) break;
    let start = at + 6;
    if (bytes[start] === 13) start++;
    if (bytes[start] === 10) start++;
    const end = findAscii(bytes, "endstream", start);
    if (end < 0) break;
    let data = bytes.slice(start, end);
    while (data.length && (data[data.length - 1] === 10 || data[data.length - 1] === 13)) {
      data = data.slice(0, -1);
    }
    const dict = latin1(bytes.slice(Math.max(0, at - 240), at));
    if (dict.includes("FlateDecode")) {
      try {
        data = unzlibSync(data);
      } catch {
        try {
          data = inflateSync(data);
        } catch {
          cursor = end + 9;
          continue;
        }
      }
    }
    chunks.push(latin1(data));
    cursor = end + 9;
  }
  return chunks.join("\n");
}

function decodePdfLiteral(body: string): string {
  let out = "";
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== "\\") {
      out += body[i];
      continue;
    }
    const n = body[++i];
    if (n === "n") out += "\n";
    else if (n === "r") out += "\r";
    else if (n === "t") out += "\t";
    else if (n === "(" || n === ")" || n === "\\") out += n;
    else if (n >= "0" && n <= "7") {
      let oct = n;
      for (let k = 0; k < 2 && body[i + 1] >= "0" && body[i + 1] <= "7"; k++) oct += body[++i];
      out += String.fromCharCode(parseInt(oct, 8));
    } else if (n) out += n;
  }
  return out;
}

type PdfGlyph = { x: number; y: number; text: string };

function pdfGlyphs(content: string): PdfGlyph[] {
  const glyphs: PdfGlyph[] = [];
  let x = 0;
  let y = 0;
  const token = /\((?:\\.|[^\\)])*\)\s*Tj|\[(?:.|\n)*?\]\s*TJ|[-+]?\d*\.?\d+\s+[-+]?\d*\.?\d+\s+Td|[-+]?\d*\.?\d+(?:\s+[-+]?\d*\.?\d+){5}\s+Tm/g;
  for (const match of content.matchAll(token)) {
    const raw = match[0];
    if (raw.endsWith("Tm")) {
      const nums = raw.replace(/Tm$/, "").trim().split(/\s+/).map(Number);
      x = nums[4] ?? x;
      y = nums[5] ?? y;
    } else if (raw.endsWith("Td")) {
      const nums = raw.replace(/Td$/, "").trim().split(/\s+/).map(Number);
      x += nums[0] ?? 0;
      y += nums[1] ?? 0;
    } else if (raw.endsWith("Tj")) {
      const body = raw.slice(raw.indexOf("(") + 1, raw.lastIndexOf(")"));
      glyphs.push({ x, y, text: decodePdfLiteral(body) });
    } else if (raw.endsWith("TJ")) {
      let cursorX = x;
      for (const part of raw.matchAll(/\((?:\\.|[^\\)])*\)|[-+]?\d+(?:\.\d+)?/g)) {
        const bit = part[0];
        if (bit.startsWith("(")) {
          const text = decodePdfLiteral(bit.slice(1, -1));
          glyphs.push({ x: cursorX, y, text });
          cursorX += text.length * 4;
        } else {
          cursorX -= Number(bit) / 20;
        }
      }
      x = cursorX;
    }
  }
  return glyphs.filter((g) => g.text.trim().length > 0);
}

function rowsFromGlyphs(glyphs: PdfGlyph[]): string[][] {
  const sorted = [...glyphs].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: PdfGlyph[][] = [];
  for (const glyph of sorted) {
    const line = lines.find((entry) => Math.abs(entry[0].y - glyph.y) < 3);
    if (line) line.push(glyph);
    else lines.push([glyph]);
  }
  return lines.map((line) => {
    const ordered = [...line].sort((a, b) => a.x - b.x);
    const cells: string[] = [];
    let current = "";
    let lastX = ordered[0]?.x ?? 0;
    for (const glyph of ordered) {
      const gap = glyph.x - lastX;
      if (current && gap > 14) {
        cells.push(current.trim());
        current = glyph.text;
      } else {
        current += glyph.text;
      }
      lastX = glyph.x + Math.max(4, glyph.text.length * 4);
    }
    if (current.trim()) cells.push(current.trim());
    if (cells.length === 1 && /\s{2,}|\t/.test(cells[0])) {
      return cells[0].split(/\t|\s{2,}/).map((cell) => cell.trim()).filter(Boolean);
    }
    return cells;
  });
}

function parsePdf(bytes: Uint8Array): string[][] | { error: string } {
  const content = pdfStreams(bytes);
  const glyphs = pdfGlyphs(content);
  const rows = rowsFromGlyphs(glyphs).filter((row) => row.some((cell) => cell.trim()));
  if (rows.length < 2) {
    return { error: "No table found in this PDF. Export the shot list as .xlsx and upload that." };
  }
  return rows;
}

export function parseShotFile(name: string, bytes: Uint8Array): ParsedShotTable | { error: string } {
  const lower = name.trim().toLowerCase();
  let matrix: string[][] | { error: string };
  if (lower.endsWith(".csv") || lower.endsWith(".txt") || lower.endsWith(".tsv")) {
    matrix = parseCsv(new TextDecoder().decode(bytes));
  } else if (lower.endsWith(".xlsx")) {
    matrix = parseXlsx(bytes);
  } else if (lower.endsWith(".xls")) {
    return { error: "Save the sheet as .xlsx and upload that file." };
  } else if (lower.endsWith(".pdf")) {
    matrix = parsePdf(bytes);
  } else {
    return { error: "Upload an Excel file (.xlsx) or a PDF." };
  }
  if ("error" in matrix) return matrix;
  return matrixFromRows(matrix);
}

export function sheetFromParsed(table: ParsedShotTable, sourceName: string): ShotSheet {
  return {
    columns: table.columns,
    sourceName,
    rows: table.rows.map((row) => ({ id: newId(), cells: row.cells, status: row.status })),
  };
}

const STORY_COLUMN = /^(action|description|notes?|dialogue|direction|brief)$/i;

/** Short facts stay in the header strip. Action and other long copy sit underneath, full width. */
export function splitShotColumns(
  columns: string[],
  rows: { cells: string[] }[]
): { compact: number[]; story: number[] } {
  const compact: number[] = [];
  const story: number[] = [];
  columns.forEach((name, index) => {
    const longest = rows.reduce((max, row) => Math.max(max, (row.cells[index] ?? "").trim().length), 0);
    if (STORY_COLUMN.test(name.trim()) || longest > 72) story.push(index);
    else compact.push(index);
  });
  if (compact.length === 0 && story.length > 0) {
    compact.push(story.shift() as number);
  }
  return { compact, story };
}

const GLANCE_COLUMN = [/^scene$/i, /^location$/i, /time/i, /^framing$/i, /^lens$/i];

/** Collapsed row: shot title, a few short facts, and the action line. Everything else stays inside. */
export function shotGlance(
  columns: string[],
  cells: string[]
): { label: string; value: string; facts: string } {
  const shotIndex = columns.findIndex((name) => /^(shot|slate|#)$/i.test(name.trim()));
  const titleIndex = shotIndex >= 0 ? shotIndex : 0;
  const value = (cells[titleIndex] ?? "").trim() || "—";
  const used = new Set<number>([titleIndex]);
  const facts: string[] = [];
  for (const pattern of GLANCE_COLUMN) {
    const index = columns.findIndex((name) => pattern.test(name.trim()));
    if (index < 0 || used.has(index)) continue;
    const value = (cells[index] ?? "").trim();
    if (!value) continue;
    used.add(index);
    facts.push(value);
  }
  return { label: columns[titleIndex], value, facts: facts.join(" · ") };
}

export function columnsMatch(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((name, i) => name.trim().toLowerCase() === b[i].trim().toLowerCase());
}

export function appendRows(current: ShotSheet, incoming: ShotSheet): ShotSheet | { error: string } {
  if (!columnsMatch(current.columns, incoming.columns)) {
    return { error: "These columns do not match the list already on this day. Replace the day to use them." };
  }
  return { ...current, rows: [...current.rows, ...incoming.rows] };
}

export function emptyRow(columns: string[]): ShotSheetRow {
  return { id: newId(), cells: columns.map(() => ""), status: "open" };
}

export function nextSheetStatus(current: ShotSheetStatus): ShotSheetStatus {
  const i = SHOT_SHEET_STATUSES.indexOf(current);
  return SHOT_SHEET_STATUSES[i === -1 || i >= SHOT_SHEET_STATUSES.length - 1 ? 0 : i + 1];
}

export function shotSheetKey(projectId: string, shootDay: string): string {
  return `crea-shot-sheet-preview:${projectId}:${shootDay}`;
}

const SHEET_STATUS = new Set<ShotSheetStatus>(SHOT_SHEET_STATUSES);

/** A row from production_shot_sheets. Returns null when the payload is not a sheet. */
export function shotSheetFromDb(raw: {
  columns?: unknown;
  rows?: unknown;
  source_name?: unknown;
  sourceName?: unknown;
}): ShotSheet | null {
  if (!Array.isArray(raw.columns) || raw.columns.some((name) => typeof name !== "string")) return null;
  if (!Array.isArray(raw.rows)) return null;
  const columns = raw.columns.slice(0, MAX_COLS);
  if (columns.length === 0) return null;
  const rows: ShotSheetRow[] = [];
  for (const item of raw.rows.slice(0, MAX_ROWS)) {
    if (!item || typeof item !== "object") continue;
    const record = item as { id?: unknown; cells?: unknown; status?: unknown };
    const cells = Array.isArray(record.cells)
      ? record.cells.map((cell) => String(cell ?? "")).slice(0, columns.length)
      : [];
    while (cells.length < columns.length) cells.push("");
    const status = SHEET_STATUS.has(record.status as ShotSheetStatus)
      ? (record.status as ShotSheetStatus)
      : "open";
    const id = typeof record.id === "string" && record.id ? record.id : newId();
    rows.push({ id, cells, status });
  }
  const sourceName =
    typeof raw.source_name === "string"
      ? raw.source_name
      : typeof raw.sourceName === "string"
        ? raw.sourceName
        : "";
  return { columns, rows, sourceName };
}
