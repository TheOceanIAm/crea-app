/**
 * Story body copy is three lines. Longer postings are condensed to the role
 * pitch instead of filling the frame with the full listing.
 */
const STORY_DESC_CHAR_BUDGET = 168;

const ROLE_HEADING =
  /^(the role|your role|about the role|about the job|the job|die rolle|deine rolle|über die rolle|uber die rolle|aufgaben|das machst du)\b/i;

function isHeading(line: string): boolean {
  const value = line.trim();
  if (!value || value.length > 48) return false;
  if (/[.!?]$/.test(value)) return false;
  if (ROLE_HEADING.test(value)) return true;
  return /^(what you.?ll do|what they.?re looking for|what we.?re looking for|requirements|responsibilities|qualifications|about|overview|anforderungen|wir suchen|dein profil|benefits)\b/i.test(
    value
  );
}

function sentencesOf(paragraph: string): string[] {
  const clean = paragraph.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const parts: string[] = [];
  const boundary = /[.!?](?=\s+[A-Z])/g;
  let start = 0;
  let match: RegExpExecArray | null;
  while ((match = boundary.exec(clean))) {
    const end = match.index + 1;
    const token = clean.slice(start, end);
    const shortName = /(?:^|\s)([A-Za-z]{1,3})\.$/.exec(token);
    if (shortName && match[0] === ".") continue;
    parts.push(token.trim());
    start = end;
    while (clean[start] === " ") start += 1;
  }
  const rest = clean.slice(start).trim();
  if (rest) parts.push(rest);
  return parts.filter((sentence) => sentence.length > 1);
}

function isBulletLine(line: string): boolean {
  return /^([•*\-–—]|\d+[.)])\s+/.test(line.trim());
}

function fitStoryLines(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= 155) return clean;
  const window = clean.slice(0, 165);
  const comma = window.lastIndexOf(", ");
  const and = window.lastIndexOf(" and ");
  const dot = window.lastIndexOf(". ");
  const late = Math.max(comma, and);
  if (late >= 80) {
    const base = clean.slice(0, late).replace(/[.,;:\s]+$/, "");
    return /[.!?]$/.test(base) ? base : `${base}.`;
  }
  if (dot >= 40) return clean.slice(0, dot + 1).trim();
  const clipped = clean.slice(0, 150).replace(/\s+\S*$/, "").replace(/[.,;:]+$/, "").trim();
  return `${clipped}.`;
}
export function summarizeStoryDescription(raw: string): string {
  const text = raw.replace(/\r\n/g, "\n").replace(/\u0000/g, "").trim();
  if (!text || text === "—") return text;

  const nonEmpty = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const flat = nonEmpty.join(" ");
  if (flat.length <= STORY_DESC_CHAR_BUDGET && nonEmpty.length <= 3 && !nonEmpty.some(isBulletLine)) {
    return text;
  }

  const blocks = text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);
  const prose: string[] = [];
  const roleBits: string[] = [];
  for (const block of blocks) {
    const rawLines = block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    let roleBlock = false;
    const lines: string[] = [];
    for (const line of rawLines) {
      if (lines.length === 0 && isHeading(line)) {
        if (ROLE_HEADING.test(line)) roleBlock = true;
        continue;
      }
      lines.push(line);
    }
    if (lines.length === 0) continue;
    const bullets = lines.filter(isBulletLine);
    if (bullets.length > 0 && bullets.length >= lines.length / 2) continue;
    const sentences = sentencesOf(lines.join(" "));
    if (roleBlock) roleBits.push(...sentences);
    else prose.push(...sentences);
  }

  const parts = roleBits.length > 0 ? roleBits : prose.length > 0 ? prose : [flat];
  return fitStoryLines(parts.join(" "));
}
