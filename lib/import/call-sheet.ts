import type { ImportSheet } from "./tabular";

export const IMPORT_BUCKET = "call-sheet-imports";
export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;

export type ImportSection = "day" | "locations" | "scenes" | "cast" | "crew" | "extras" | "ignore";

export type ImportColumn =
  | "ignore"
  | "scene"
  | "int_ext"
  | "description"
  | "cast"
  | "location"
  | "address"
  | "time"
  | "move"
  | "notes"
  | "name"
  | "role"
  | "call"
  | "email"
  | "phone"
  | "character"
  | "hmu"
  | "wardrobe"
  | "count"
  | "ready"
  | "general_call"
  | "breakfast"
  | "shoot_call"
  | "lunch"
  | "wrap"
  | "date"
  | "parking"
  | "basecamp"
  | "hospital";

export const IMPORT_COLUMN_OPTIONS: { id: ImportColumn; label: string }[] = [
  { id: "ignore", label: "Ignore" },
  { id: "scene", label: "Scene" },
  { id: "int_ext", label: "INT/EXT" },
  { id: "description", label: "Description" },
  { id: "cast", label: "Cast" },
  { id: "location", label: "Location" },
  { id: "address", label: "Address" },
  { id: "time", label: "Time" },
  { id: "move", label: "Move" },
  { id: "notes", label: "Notes" },
  { id: "name", label: "Name" },
  { id: "role", label: "Role" },
  { id: "call", label: "Call time" },
  { id: "email", label: "Email" },
  { id: "phone", label: "Phone" },
  { id: "character", label: "Character" },
  { id: "hmu", label: "HMU" },
  { id: "wardrobe", label: "Wardrobe" },
  { id: "count", label: "Count" },
  { id: "ready", label: "Ready" },
  { id: "general_call", label: "General call" },
  { id: "breakfast", label: "Breakfast" },
  { id: "shoot_call", label: "Shoot call" },
  { id: "lunch", label: "Lunch" },
  { id: "wrap", label: "Wrap" },
  { id: "date", label: "Date" },
  { id: "parking", label: "Parking" },
  { id: "basecamp", label: "Basecamp" },
  { id: "hospital", label: "Hospital" },
];

export type ImportPlan = {
  name: string;
  section: ImportSection;
  headerRow: number;
  headers: string[];
  columns: ImportColumn[];
};

export type ImportPerson = {
  name: string;
  role: string;
  email: string;
  phone: string;
  callTime: string;
  kind: "cast" | "crew";
  character: string;
  hmu: string;
  wardrobe: string;
  match: "project" | "account" | "unknown";
  key: string;
};

export type ImportedCallSheet = {
  v: 2;
  people: Record<string, { call_time?: string; kind?: "cast" | "crew"; character?: string; hmu?: string; wardrobe?: string }>;
  day: {
    general_call: string;
    breakfast: string;
    shoot_call: string;
    lunch: string;
    safety_note: string;
    safety_meeting: string;
  };
  places: { parking: string; basecamp: string; hmu: string; wardrobe: string; hospital: string };
  special: string;
  departments: { camera: string; sound: string; wardrobe: string };
  background: { label: string; count?: number; in?: string; ready?: string }[];
  contacts: { upm: string; first_ad: string; second_ad: string; medic_name: string; medic_phone: string };
  scenes: {
    scene: string;
    int_ext: string;
    description: string;
    cast: string;
    location: string;
    move: string;
    time: string;
    location_id: string;
  }[];
  locations: { id: string; name: string; address: string; notes?: string }[];
};

export type CallSheetImportPreview = {
  fileName: string;
  sheets: ImportSheet[];
  plans: ImportPlan[];
  document: ImportedCallSheet;
  wrapTime: string;
  notes: string;
  people: ImportPerson[];
  warnings: string[];
  fileDate: string;
  dateDiffers: boolean;
  counts: { scenes: number; locations: number; cast: number; crew: number; extras: number };
};

export type ProjectCrewRef = { key: string; email: string; name: string };
export type KnownAccount = { email: string; profileId: string };
export type SheetChoice = { section: ImportSection; columns: ImportColumn[]; headerRow: number };

const DAY_FIELDS = new Set<ImportColumn>([
  "general_call",
  "breakfast",
  "shoot_call",
  "lunch",
  "wrap",
  "date",
  "parking",
  "basecamp",
  "hospital",
]);

const SYNONYMS: { field: ImportColumn; words: string[] }[] = [
  { field: "scene", words: ["scene no", "scene number", "szenennummer", "szene", "scene", "sc"] },
  { field: "int_ext", words: ["int/ext", "int ext", "i/e"] },
  { field: "description", words: ["beschreibung", "description", "action", "inhalt"] },
  { field: "cast", words: ["darsteller", "cast"] },
  { field: "address", words: ["adresse", "address", "street"] },
  { field: "location", words: ["location name", "drehort", "location", "motiv", "set", "ort"] },
  { field: "time", words: ["scene time", "uhrzeit", "zeit", "start", "time"] },
  { field: "move", words: ["move after", "umzug", "move"] },
  { field: "notes", words: ["bemerkung", "notizen", "notes", "note"] },
  { field: "character", words: ["character", "figur"] },
  { field: "call", words: ["call time", "crew call", "aufruf", "call"] },
  { field: "email", words: ["e-mail", "email", "mail"] },
  { field: "phone", words: ["telefon", "mobile", "handy", "phone"] },
  { field: "hmu", words: ["hair and makeup", "makeup", "maske", "hmu"] },
  { field: "wardrobe", words: ["kostum", "kostüm", "wardrobe"] },
  { field: "role", words: ["position", "funktion", "role", "rolle", "job"] },
  { field: "name", words: ["name", "person", "crew"] },
  { field: "count", words: ["anzahl", "count", "number"] },
  { field: "ready", words: ["bereit", "ready"] },
  { field: "general_call", words: ["general call", "allgemeiner aufruf", "crew call"] },
  { field: "breakfast", words: ["fruhstuck", "frühstück", "breakfast"] },
  { field: "shoot_call", words: ["shooting call", "shoot call", "drehbeginn"] },
  { field: "lunch", words: ["mittagessen", "mittag", "lunch"] },
  { field: "wrap", words: ["drehende", "feierabend", "wrap"] },
  { field: "date", words: ["shoot date", "drehtag", "datum", "date"] },
  { field: "parking", words: ["parkplatz", "parken", "parking"] },
  { field: "basecamp", words: ["base camp", "basislager", "basecamp"] },
  { field: "hospital", words: ["krankenhaus", "klinik", "hospital"] },
];

const DEPARTMENTS = new Set([
  "camera",
  "kamera",
  "dop",
  "sound",
  "ton",
  "audio",
  "grip",
  "electric",
  "gaffer",
  "licht",
  "beleuchtung",
  "art",
  "wardrobe",
  "kostum",
  "kostüm",
  "costume",
  "hmu",
  "hair",
  "makeup",
  "maske",
  "production",
  "produktion",
  "stunts",
  "locations",
  "regie",
]);

function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
}

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function norm(value: string): string {
  return clean(value)
    .toLowerCase()
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/ß/g, "ss")
    .replace(/[_./]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function guessColumn(header: string): ImportColumn {
  const n = norm(header);
  if (!n) return "ignore";
  let best: { field: ImportColumn; len: number } | null = null;
  for (const row of SYNONYMS) {
    for (const word of row.words) {
      const w = norm(word);
      if (n === w || n.startsWith(`${w} `) || n.endsWith(` ${w}`)) {
        if (!best || w.length > best.len) best = { field: row.field, len: w.length };
      }
    }
  }
  return best?.field ?? "ignore";
}

export function parseClock(raw: string): string {
  const text = clean(raw);
  if (!text) return "";
  if (/^\d+(\.\d+)?$/.test(text)) {
    const n = Number(text);
    if (n > 0 && n < 1) {
      const mins = Math.round(n * 24 * 60);
      const h = Math.floor(mins / 60) % 24;
      const m = mins % 60;
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    }
    if (/^\d{3,4}$/.test(text)) {
      const padded = text.padStart(4, "0");
      const h = Number(padded.slice(0, 2));
      const m = Number(padded.slice(2));
      if (h <= 23 && m <= 59) return `${padded.slice(0, 2)}:${padded.slice(2)}`;
    }
  }
  const m = text.match(/^(\d{1,2})[:.](\d{2})(?::\d{2})?\s*([ap]m)?$/i);
  if (!m) return "";
  let h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59 || h > 23) return "";
  const ap = m[3]?.toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (h > 23) return "";
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export function parseDate(raw: string): string {
  const text = clean(raw);
  if (!text) return "";
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  if (/^\d{4,6}(\.\d+)?$/.test(text)) {
    const serial = Math.floor(Number(text));
    if (serial > 20000 && serial < 80000) {
      const utc = Date.UTC(1899, 11, 30) + serial * 86400000;
      const d = new Date(utc);
      const y = d.getUTCFullYear();
      const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
      const day = String(d.getUTCDate()).padStart(2, "0");
      return `${y}-${mo}-${day}`;
    }
  }
  const m = text.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$/);
  if (!m) return "";
  const a = Number(m[1]);
  const b = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  const dot = text.includes(".");
  let day = a;
  let month = b;
  if (!dot && a <= 12 && b <= 12) {
    month = a;
    day = b;
  } else if (a > 12) {
    day = a;
    month = b;
  } else if (b > 12) {
    month = a;
    day = b;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function emptyDocument(): ImportedCallSheet {
  return {
    v: 2,
    people: {},
    day: { general_call: "", breakfast: "", shoot_call: "", lunch: "", safety_note: "", safety_meeting: "" },
    places: { parking: "", basecamp: "", hmu: "", wardrobe: "", hospital: "" },
    special: "",
    departments: { camera: "", sound: "", wardrobe: "" },
    background: [],
    contacts: { upm: "", first_ad: "", second_ad: "", medic_name: "", medic_phone: "" },
    scenes: [],
    locations: [],
  };
}

function scoreRow(row: string[]): number {
  return row.reduce((n, cell) => n + (guessColumn(cell) === "ignore" ? 0 : 1), 0);
}

function guessSection(columns: ImportColumn[]): ImportSection {
  const has = (field: ImportColumn) => columns.includes(field);
  if (has("scene")) return "scenes";
  if (has("address") && (has("name") || has("location"))) return "locations";
  if (has("character")) return "cast";
  if (has("count")) return "extras";
  if (has("name") && (has("role") || has("email") || has("call") || has("phone"))) return "crew";
  if (columns.some((col) => DAY_FIELDS.has(col))) return "day";
  return "ignore";
}

function isDepartment(row: string[]): string {
  const filled = row.map(clean).filter(Boolean);
  if (filled.length !== 1) return "";
  const label = norm(filled[0]).replace(/ department$/, "");
  return DEPARTMENTS.has(label) ? filled[0] : "";
}

function isSeparator(row: string[]): boolean {
  const filled = row.map(clean).filter(Boolean);
  return filled.length > 0 && filled.every((cell) => /^[-_=]+$/.test(cell));
}

function cell(row: string[], columns: ImportColumn[], field: ImportColumn): string {
  const index = columns.indexOf(field);
  return index >= 0 ? clean(row[index] ?? "") : "";
}

function clip(value: string, max: number): string {
  return value.trim().slice(0, max);
}

function explicitBasecamp(name: string): boolean {
  const n = norm(name);
  return n === "basecamp" || n === "base camp" || n === "basislager";
}

function contactSlot(role: string): "upm" | "first_ad" | "second_ad" | "medic" | "" {
  const n = norm(role);
  if (n.includes("upm") || n.includes("unit production") || n.includes("produktionleitung") || n.includes("produktionsleitung")) return "upm";
  if (n.includes("2nd ad") || n.includes("second ad") || n.includes("2 ad")) return "second_ad";
  if (n.includes("1st ad") || n.includes("first ad") || n.includes("1 ad")) return "first_ad";
  if (n.includes("medic") || n.includes("sanit")) return "medic";
  return "";
}

function planSheet(sheet: ImportSheet, choice?: SheetChoice): ImportPlan {
  const rows = sheet.rows.map((row) => row.map(clean));
  let headerRow = 0;
  let best = 0;
  const limit = Math.min(rows.length, 20);
  for (let i = 0; i < limit; i++) {
    const score = scoreRow(rows[i] ?? []);
    if (score > best) {
      best = score;
      headerRow = i;
    }
  }
  if (choice && choice.headerRow >= 0 && choice.headerRow < rows.length) headerRow = choice.headerRow;
  const headers = (rows[headerRow] ?? []).map((cell) => cell || "");
  let columns = headers.map((header) => guessColumn(header));
  if (choice && choice.columns.length) {
    columns = headers.map((_, i) => choice.columns[i] ?? "ignore");
  }
  const seen = new Set<ImportColumn>();
  columns = columns.map((col) => {
    if (col === "ignore") return col;
    if (seen.has(col)) return "ignore";
    seen.add(col);
    return col;
  });
  const section = choice?.section ?? (best >= 2 ? guessSection(columns) : "day");
  return { name: sheet.name, section, headerRow, headers, columns };
}

export function previewCallSheetImport(input: {
  fileName: string;
  sheets: ImportSheet[];
  shootDay: string;
  choices?: Record<string, SheetChoice>;
  projectCrew?: ProjectCrewRef[];
  knownAccounts?: KnownAccount[];
}): CallSheetImportPreview {
  const doc = emptyDocument();
  const warnings: string[] = [];
  const notes: string[] = [];
  const people: ImportPerson[] = [];
  let fileDate = "";
  const crew = input.projectCrew ?? [];
  const accounts = input.knownAccounts ?? [];
  const plans = input.sheets.map((sheet) => planSheet(sheet, input.choices?.[sheet.name]));

  const setDay = (field: ImportColumn, value: string) => {
    const clock = parseClock(value);
    if (field === "date") {
      const date = parseDate(value);
      if (date) fileDate = date;
      else if (value) warnings.push(`Date "${value}" was not recognised.`);
      return;
    }
    if (field === "parking" || field === "basecamp" || field === "hospital") {
      if (value) doc.places[field] = clip(value, 300);
      return;
    }
    if (field === "wrap") return;
    const key = field as "general_call" | "breakfast" | "shoot_call" | "lunch";
    if (key in doc.day) {
      if (!clock && value) warnings.push(`Time "${value}" was not a clock.`);
      if (clock) doc.day[key] = clock;
    }
  };

  const rememberLocation = (name: string, address: string, note: string) => {
    const label = clip(name, 120);
    if (!label) return;
    const existing = doc.locations.find((loc) => norm(loc.name) === norm(label));
    if (existing) {
      if (!existing.address && address) existing.address = clip(address, 300);
      if (!existing.notes && note) existing.notes = clip(note, 2000);
      return;
    }
    if (doc.locations.length >= 30) {
      warnings.push("Only the first 30 locations are kept.");
      return;
    }
    const row: ImportedCallSheet["locations"][number] = { id: newId(), name: label, address: clip(address, 300) };
    if (note.trim()) row.notes = clip(note, 2000);
    doc.locations.push(row);
    if (explicitBasecamp(label) && !doc.places.basecamp) {
      doc.places.basecamp = [label, row.address].filter(Boolean).join(", ");
    }
  };

  for (let s = 0; s < input.sheets.length; s++) {
    const sheet = input.sheets[s];
    const plan = plans[s];
    const rows = sheet.rows.map((row) => row.map(clean));
    for (let r = 0; r < plan.headerRow; r++) {
      const row = rows[r] ?? [];
      const filled = row.filter(Boolean);
      if (filled.length === 2) setDay(guessColumn(filled[0]), filled[1]);
      else if (filled.length === 1) {
        const bits = filled[0].split(/:\s+/);
        if (bits.length === 2) setDay(guessColumn(bits[0]), bits[1]);
      }
    }
    if (plan.section === "ignore") continue;
    let department = "";
    for (let r = plan.headerRow + 1; r < rows.length; r++) {
      const row = rows[r] ?? [];
      if (!row.some(Boolean) || isSeparator(row)) continue;
      const dept = isDepartment(row);
      if (dept && (plan.section === "crew" || plan.section === "cast")) {
        department = dept;
        continue;
      }
      if (plan.section === "day") {
        const label = guessColumn(row[0] ?? "");
        if (DAY_FIELDS.has(label)) setDay(label, row[1] ?? "");
        continue;
      }
      if (plan.section === "locations") {
        const name = cell(row, plan.columns, "name") || cell(row, plan.columns, "location");
        rememberLocation(name, cell(row, plan.columns, "address"), cell(row, plan.columns, "notes"));
        continue;
      }
      if (plan.section === "scenes") {
        if (doc.scenes.length >= 500) {
          warnings.push("Only the first 500 scenes are kept.");
          break;
        }
        const location = cell(row, plan.columns, "location");
        const address = cell(row, plan.columns, "address");
        if (location) rememberLocation(location, address, "");
        const timeRaw = cell(row, plan.columns, "time");
        const time = parseClock(timeRaw);
        if (timeRaw && !time) warnings.push(`Scene time "${timeRaw}" was not a clock.`);
        const note = cell(row, plan.columns, "notes");
        if (note) notes.push(note);
        doc.scenes.push({
          scene: clip(cell(row, plan.columns, "scene"), 80),
          int_ext: clip(cell(row, plan.columns, "int_ext"), 16),
          description: clip(cell(row, plan.columns, "description"), 2000),
          cast: clip(cell(row, plan.columns, "cast"), 200),
          location: clip(location, 300),
          move: clip(cell(row, plan.columns, "move"), 300),
          time,
          location_id: "",
        });
        continue;
      }
      if (plan.section === "extras") {
        const label = cell(row, plan.columns, "name") || cell(row, plan.columns, "cast") || cell(row, plan.columns, "description");
        if (!label) continue;
        const count = Number(cell(row, plan.columns, "count"));
        const ready = cell(row, plan.columns, "ready");
        doc.background.push({
          label: clip(label, 120),
          count: Number.isFinite(count) && count > 0 ? Math.round(count) : undefined,
          ready: ready || undefined,
        });
        continue;
      }
      const name = cell(row, plan.columns, "name");
      if (!name) continue;
      const roleCell = cell(row, plan.columns, "role");
      const role = department ? `${department} · ${roleCell || "Crew"}` : roleCell;
      const email = cell(row, plan.columns, "email").toLowerCase();
      const callRaw = cell(row, plan.columns, "call");
      const callTime = parseClock(callRaw);
      if (callRaw && !callTime) warnings.push(`Call time "${callRaw}" was not a clock.`);
      const known = email ? crew.find((row) => row.email.trim().toLowerCase() === email) : undefined;
      const account = !known && email ? accounts.find((row) => row.email.trim().toLowerCase() === email) : undefined;
      const person: ImportPerson = {
        name: clip(name, 120),
        role: clip(role, 120),
        email,
        phone: clip(cell(row, plan.columns, "phone"), 40),
        callTime,
        kind: plan.section === "cast" ? "cast" : "crew",
        character: clip(cell(row, plan.columns, "character"), 80),
        hmu: parseClock(cell(row, plan.columns, "hmu")) || clip(cell(row, plan.columns, "hmu"), 40),
        wardrobe: clip(cell(row, plan.columns, "wardrobe"), 40),
        match: known ? "project" : account ? "account" : "unknown",
        key: known?.key || `manual:${newId()}`,
      };
      people.push(person);
      const slot = contactSlot(role);
      const contactLine = [person.name, person.phone].filter(Boolean).join(", ");
      if (slot === "upm") doc.contacts.upm = contactLine;
      if (slot === "first_ad") doc.contacts.first_ad = contactLine;
      if (slot === "second_ad") doc.contacts.second_ad = contactLine;
      if (slot === "medic") {
        doc.contacts.medic_name = person.name;
        doc.contacts.medic_phone = person.phone;
      }
    }
  }

  for (const plan of plans) {
    if (plan.section !== "day" && plan.section !== "scenes" && plan.section !== "locations") continue;
    const sheet = input.sheets.find((item) => item.name === plan.name);
    if (!sheet || plan.section === "scenes" || plan.section === "locations") continue;
    const next = sheet.rows[plan.headerRow + 1];
    if (next) {
      plan.columns.forEach((field, index) => {
        if (DAY_FIELDS.has(field)) setDay(field, next[index] ?? "");
      });
    }
  }

  for (const scene of doc.scenes) {
    const hit = doc.locations.find((loc) => norm(loc.name) === norm(scene.location));
    scene.location_id = hit?.id ?? "";
  }

  let wrapTime = "";
  for (const plan of plans) {
    const sheet = input.sheets.find((item) => item.name === plan.name);
    if (!sheet) continue;
    const rows = sheet.rows;
    for (let r = 0; r < plan.headerRow; r++) {
      const filled = (rows[r] ?? []).map(clean).filter(Boolean);
      const label = filled.length === 2 ? filled[0] : filled[0]?.split(/:\s+/)[0] ?? "";
      const value = filled.length === 2 ? filled[1] : filled[0]?.split(/:\s+/)[1] ?? "";
      if (guessColumn(label) === "wrap") wrapTime = parseClock(value) || wrapTime;
    }
    const index = plan.columns.indexOf("wrap");
    if (index >= 0) {
      const value = clean(rows[plan.headerRow + 1]?.[index] ?? "");
      const clock = parseClock(value);
      if (clock) wrapTime = clock;
    }
  }

  const shoot = input.shootDay.slice(0, 10);
  const dateDiffers = Boolean(fileDate && shoot && fileDate !== shoot);
  if (dateDiffers) warnings.push(`The file date is ${fileDate}. This import stays on ${shoot}.`);

  for (const person of people) {
    doc.people[person.key] = {
      call_time: person.callTime || undefined,
      kind: person.kind,
      character: person.character || undefined,
      hmu: person.hmu || undefined,
      wardrobe: person.wardrobe || undefined,
    };
  }

  const cast = people.filter((p) => p.kind === "cast").length;
  const crewCount = people.filter((p) => p.kind === "crew").length;
  return {
    fileName: input.fileName,
    sheets: input.sheets,
    plans,
    document: doc,
    wrapTime,
    notes: notes.join("\n"),
    people,
    warnings,
    fileDate,
    dateDiffers,
    counts: {
      scenes: doc.scenes.length,
      locations: doc.locations.length,
      cast,
      crew: crewCount,
      extras: doc.background.length,
    },
  };
}

function fillEmpty(current: string, incoming: string): string {
  return current.trim() ? current : incoming;
}

export function mergeImportedCallSheet(
  current: ImportedCallSheet,
  incoming: ImportedCallSheet,
  mode: "replace" | "add",
  currentWrap: string,
  currentNotes: string,
  incomingWrap: string,
  incomingNotes: string
): { document: ImportedCallSheet; wrapTime: string; notes: string } {
  if (mode === "replace") {
    return {
      document: incoming,
      wrapTime: incomingWrap || currentWrap,
      notes: incomingNotes.trim() ? incomingNotes : currentNotes,
    };
  }
  const locations = [...current.locations];
  const idMap = new Map<string, string>();
  for (const loc of incoming.locations) {
    const hit = locations.find((row) => norm(row.name) === norm(loc.name));
    if (hit) idMap.set(loc.id, hit.id);
    else if (locations.length < 30) {
      locations.push(loc);
      idMap.set(loc.id, loc.id);
    }
  }
  const scenes = [
    ...current.scenes,
    ...incoming.scenes.map((scene) => ({ ...scene, location_id: idMap.get(scene.location_id) || scene.location_id })),
  ].slice(0, 500);
  const people = { ...current.people };
  for (const [key, cell] of Object.entries(incoming.people)) {
    const prev = people[key];
    people[key] = prev ? { ...cell, ...prev, call_time: prev.call_time || cell.call_time } : cell;
  }
  return {
    document: {
      ...current,
      v: 2,
      people,
      day: {
        general_call: fillEmpty(current.day.general_call, incoming.day.general_call),
        breakfast: fillEmpty(current.day.breakfast, incoming.day.breakfast),
        shoot_call: fillEmpty(current.day.shoot_call, incoming.day.shoot_call),
        lunch: fillEmpty(current.day.lunch, incoming.day.lunch),
        safety_note: current.day.safety_note,
        safety_meeting: current.day.safety_meeting,
      },
      places: {
        parking: fillEmpty(current.places.parking, incoming.places.parking),
        basecamp: fillEmpty(current.places.basecamp, incoming.places.basecamp),
        hmu: fillEmpty(current.places.hmu, incoming.places.hmu),
        wardrobe: fillEmpty(current.places.wardrobe, incoming.places.wardrobe),
        hospital: fillEmpty(current.places.hospital, incoming.places.hospital),
      },
      background: [...current.background, ...incoming.background],
      contacts: {
        upm: fillEmpty(current.contacts.upm, incoming.contacts.upm),
        first_ad: fillEmpty(current.contacts.first_ad, incoming.contacts.first_ad),
        second_ad: fillEmpty(current.contacts.second_ad, incoming.contacts.second_ad),
        medic_name: fillEmpty(current.contacts.medic_name, incoming.contacts.medic_name),
        medic_phone: fillEmpty(current.contacts.medic_phone, incoming.contacts.medic_phone),
      },
      scenes,
      locations,
    },
    wrapTime: currentWrap.trim() ? currentWrap : incomingWrap,
    notes: [currentNotes.trim(), incomingNotes.trim()].filter(Boolean).join("\n"),
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function callSheetImportObjectPath(projectId: string, userId: string, fileName: string): string | { error: string } {
  const lower = fileName.trim().toLowerCase();
  if (lower.endsWith(".xls") && !lower.endsWith(".xlsx")) return { error: "Please save the file as .xlsx and upload again." };
  const ext = lower.endsWith(".xlsx") ? "xlsx" : lower.endsWith(".csv") ? "csv" : lower.endsWith(".pdf") ? "pdf" : lower.endsWith(".txt") ? "txt" : "";
  if (!ext) return { error: "Upload an Excel file (.xlsx), a CSV, or a PDF." };
  if (!UUID_RE.test(projectId) || !UUID_RE.test(userId)) return { error: "This project cannot import a file." };
  return `${projectId}/${userId}/${newId()}.${ext}`;
}

export function assertCallSheetImportPath(path: string, projectId: string, userId: string): string | { error: string } {
  if (path.includes("..") || path.includes("\\")) return { error: "That file path is not valid." };
  const parts = path.split("/");
  if (parts.length !== 3) return { error: "That file path is not valid." };
  if (parts[0] !== projectId || parts[1] !== userId) return { error: "That file path is not valid." };
  if (!/^[0-9a-f-]{36}\.(xlsx|csv|pdf|txt)$/i.test(parts[2])) return { error: "That file path is not valid." };
  return path;
}

export type StudioImportFields = {
  date?: string;
  generalCall?: string;
  times: { crewCall?: string; breakfast?: string; shootingCall?: string; lunch?: string; wrap?: string };
  notice?: string;
  locations: { set: { name: string; address: string; note?: string }; parking?: { name: string; address: string; note?: string }; hospital?: { name: string; address: string; phone?: string } }[];
  schedule: { kind: "scene"; start: string; scene: string; intExt: string; description: string; dayNight: string; cast: string; location: string; pages: string; est: string }[];
  cast: { no: string; name: string; character: string; status: string; pickup: string; call: string; hmu: string; onSet: string; wrap: string }[];
  crew: { department: string; name: string; role: string; call: string }[];
};

/** Fields the public generator can copy into its form. The PDF builder is not involved. */
export function studioFieldsFromImport(preview: CallSheetImportPreview): StudioImportFields {
  const doc = preview.document;
  const parking = doc.places.parking
    ? { name: "Parking", address: doc.places.parking, note: "" }
    : undefined;
  const hospital = doc.places.hospital ? { name: "Hospital", address: doc.places.hospital } : undefined;
  const locations = doc.locations.map((loc, index) => ({
    set: { name: loc.name, address: loc.address, note: loc.notes ?? "" },
    parking: index === 0 ? parking : undefined,
    hospital: index === 0 ? hospital : undefined,
  }));
  return {
    date: preview.fileDate || undefined,
    generalCall: doc.day.general_call || undefined,
    times: {
      crewCall: doc.day.general_call || undefined,
      breakfast: doc.day.breakfast || undefined,
      shootingCall: doc.day.shoot_call || undefined,
      lunch: doc.day.lunch || undefined,
      wrap: preview.wrapTime || undefined,
    },
    notice: preview.notes || undefined,
    locations,
    schedule: doc.scenes.map((scene) => ({
      kind: "scene" as const,
      start: scene.time,
      scene: scene.scene,
      intExt: scene.int_ext,
      description: scene.description,
      dayNight: "",
      cast: scene.cast,
      location: scene.location,
      pages: "",
      est: "",
    })),
    cast: preview.people
      .filter((p) => p.kind === "cast")
      .map((p, i) => ({
        no: String(i + 1),
        name: p.name,
        character: p.character,
        status: "",
        pickup: "",
        call: p.callTime,
        hmu: p.hmu,
        onSet: "",
        wrap: "",
      })),
    crew: preview.people
      .filter((p) => p.kind === "crew")
      .map((p) => {
        const [department, ...rest] = p.role.split(" · ");
        return {
          department: rest.length ? department : "",
          name: p.name,
          role: rest.length ? rest.join(" · ") : p.role,
          call: p.callTime,
        };
      }),
  };
}
