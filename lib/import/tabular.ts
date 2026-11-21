import { inflateSync, unzipSync, unzlibSync } from "fflate";

export const XLS_MESSAGE = "Please save the file as .xlsx and upload again.";
export const SCANNED_PDF_MESSAGE =
  "This PDF has no readable text. Please upload the Excel or a text-based PDF.";

export type ImportSheet = { name: string; rows: string[][] };

const MAX_SHEETS = 12;
const MAX_ROWS = 800;
const MAX_COLS = 24;

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

function columnIndex(ref: string): number {
  const letters = ref.replace(/[0-9]/g, "").toUpperCase();
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return Math.max(0, n - 1);
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
  const rows = rowXml.map((row) => {
    const cells: string[] = [];
    const found = row.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g);
    for (const match of found) {
      const attrs = match[1] ?? "";
      const inner = match[2] ?? "";
      const ref = attrs.match(/\br="([A-Z]+)\d+"/i)?.[1] ?? "";
      const index = ref ? columnIndex(ref) : cells.length;
      if (index >= MAX_COLS) continue;
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
    return cells.slice(0, MAX_COLS);
  });
  return rows.slice(0, MAX_ROWS);
}

function sheetNames(workbookXml: string): string[] {
  return [...workbookXml.matchAll(/<sheet\b[^>]*\bname="([^"]+)"/g)].map((m) => decodeXml(m[1]));
}

function parseXlsx(bytes: Uint8Array): ImportSheet[] | { error: string } {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    return { error: "This Excel file could not be opened. Save it as .xlsx and try again." };
  }
  const names = Object.keys(files);
  const sharedName = names.find((name) => name === "xl/sharedStrings.xml");
  const strings = sharedName ? sharedStrings(new TextDecoder().decode(files[sharedName])) : [];
  const workbook = names.find((name) => name === "xl/workbook.xml");
  const labels = workbook ? sheetNames(new TextDecoder().decode(files[workbook])) : [];
  const sheets = names
    .filter((name) => /xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((a, b) => {
      const na = Number(a.match(/sheet(\d+)/)?.[1] ?? 0);
      const nb = Number(b.match(/sheet(\d+)/)?.[1] ?? 0);
      return na - nb;
    })
    .slice(0, MAX_SHEETS);
  if (sheets.length === 0) return { error: "No worksheet found in this Excel file." };
  return sheets.map((name, index) => ({
    name: labels[index]?.trim() || `Sheet ${index + 1}`,
    rows: worksheetRows(new TextDecoder().decode(files[name]), strings),
  }));
}

function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  const first = src.split(/\r?\n/, 1)[0] ?? "";
  const commas = (first.match(/,/g) ?? []).length;
  const semis = (first.match(/;/g) ?? []).length;
  const delim = semis > commas ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === delim) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row.slice(0, MAX_COLS));
      row = [];
      cell = "";
      if (rows.length >= MAX_ROWS) break;
    } else if (ch !== "\r") cell += ch;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row.slice(0, MAX_COLS));
  }
  return rows;
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
  const token =
    /\((?:\\.|[^\\)])*\)\s*Tj|\[(?:.|\n)*?\]\s*TJ|[-+]?\d*\.?\d+\s+[-+]?\d*\.?\d+\s+Td|[-+]?\d*\.?\d+(?:\s+[-+]?\d*\.?\d+){5}\s+Tm/g;
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
        } else cursorX -= Number(bit) / 20;
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
  return lines.slice(0, MAX_ROWS).map((line) => {
    const ordered = [...line].sort((a, b) => a.x - b.x);
    const cells: string[] = [];
    let current = "";
    let lastX = ordered[0]?.x ?? 0;
    for (const glyph of ordered) {
      const gap = glyph.x - lastX;
      if (current && gap > 14) {
        cells.push(current.trim());
        current = glyph.text;
      } else current += glyph.text;
      lastX = glyph.x + Math.max(4, glyph.text.length * 4);
    }
    if (current.trim()) cells.push(current.trim());
    if (cells.length === 1 && /\s{2,}|\t/.test(cells[0])) {
      return cells[0]
        .split(/\t|\s{2,}/)
        .map((cell) => cell.trim())
        .filter(Boolean)
        .slice(0, MAX_COLS);
    }
    return cells.slice(0, MAX_COLS);
  });
}

function parsePdf(bytes: Uint8Array): ImportSheet[] | { error: string } {
  const rows = rowsFromGlyphs(pdfGlyphs(pdfStreams(bytes))).filter((row) => row.some((cell) => cell.trim()));
  if (rows.length < 2) return { error: SCANNED_PDF_MESSAGE };
  return [{ name: "PDF", rows }];
}

function looksLikeXls(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
}

/** Read CSV, .xlsx, or a text PDF into tables. .xls is refused. Runs in the browser and on the server. */
export function readImportTables(name: string, bytes: Uint8Array): ImportSheet[] | { error: string } {
  const lower = name.trim().toLowerCase();
  if (lower.endsWith(".xls") && !lower.endsWith(".xlsx")) return { error: XLS_MESSAGE };
  if (looksLikeXls(bytes) && !lower.endsWith(".xlsx")) return { error: XLS_MESSAGE };
  if (lower.endsWith(".csv") || lower.endsWith(".txt") || lower.endsWith(".tsv")) {
    return [{ name: "CSV", rows: parseCsv(new TextDecoder().decode(bytes)) }];
  }
  if (lower.endsWith(".xlsx")) return parseXlsx(bytes);
  if (lower.endsWith(".pdf")) return parsePdf(bytes);
  return { error: "Upload an Excel file (.xlsx), a CSV, or a PDF." };
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export function emailsInSheets(sheets: ImportSheet[]): string[] {
  const found = new Set<string>();
  for (const sheet of sheets) {
    for (const row of sheet.rows) {
      for (const cell of row) {
        for (const match of cell.matchAll(EMAIL_RE)) found.add(match[0].toLowerCase());
      }
    }
  }
  return [...found];
}
