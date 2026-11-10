/** "Made with CREA" line, same as the web (lib/made-with-crea.ts there). */
function madeWithCreaHtml(_kind: "callsheet"): string {
  return `<p style="margin:28px 0 0;text-align:center;font-size:10px;color:#999;font-family:system-ui,-apple-system,sans-serif">Made with <a href="https://creaservices.de/?ref=callsheet" style="color:#777;text-decoration:none;font-weight:600">CREA</a> · creaservices.de</p>`;
}

/**
 * Studio-grade call sheet (A4, print to PDF). Industry-standard structure:
 * three-column header, notice banner, locations table, schedule, cast,
 * crew grouped by department. CREA look: white page, black type, yellow accents.
 * Copy of the web template (crea-services lib/call-sheet-studio.ts). Keep both in sync.
 */

export type StudioKeyContact = { role: string; name: string; phone?: string };
export type StudioLocation = {
  set: { name: string; address: string; phone?: string; note?: string };
  parking?: { name: string; address: string; note?: string };
  hospital?: { name: string; address: string; phone?: string };
};
export type StudioScheduleRow =
  | {
      kind: "scene";
      start: string;
      scene: string;
      intExt: string;
      description: string;
      dayNight: string;
      cast: string;
      location: string;
      pages: string;
      est: string;
    }
  | { kind: "break"; start: string; label: string; description: string; est: string };
export type StudioCastRow = {
  /** Cast number as used in the schedule's cast column. */
  no: string;
  name: string;
  character: string;
  status: string;
  pickup: string;
  call: string;
  hmu: string;
  onSet: string;
  wrap: string;
};
export type StudioCrewRow = { department: string; name: string; role: string; call: string };

export type StudioCallSheet = {
  /** logoDataUrl: optional company logo as a data URL (never uploaded anywhere). */
  company: { name: string; address?: string; phone?: string; logoDataUrl?: string | null };
  keyContacts: StudioKeyContact[];
  projectTitle: string;
  date: string; // YYYY-MM-DD
  dayNumber?: number | null;
  dayCount?: number | null;
  generalCall: string;
  safetyNote: string;
  times: { crewCall?: string; breakfast?: string; talentCall?: string; shootingCall?: string; lunch?: string; wrap?: string };
  weather?: { summary?: string; high?: number | null; low?: number | null; sunrise?: string | null; sunset?: string | null; rain?: number | null };
  notice?: string;
  locations: StudioLocation[];
  schedule: StudioScheduleRow[];
  cast: StudioCastRow[];
  crew: StudioCrewRow[];
  /** Extras and stand-ins. */
  extras?: Array<{ label: string; count?: string; arrive?: string; ready?: string }>;
  /** Free notes at the end: department notes, wrap notes, next shoot day. */
  notes?: Array<{ title: string; body: string }>;
};

const esc = (s: string | number | null | undefined) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const ml = (s: string | undefined) => esc(s).replace(/\n/g, "<br/>");
const has = (s: string | undefined | null) => Boolean(s && String(s).trim());

/** "7:31 AM" → "07:31" so the sheet uses one clock format. */
function clock24(t: string | null | undefined): string {
  const m = String(t ?? "").trim().match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])?$/);
  if (!m) return String(t ?? "");
  let h = Number(m[1]);
  if (m[3]) {
    const pm = m[3].toLowerCase() === "pm";
    if (pm && h < 12) h += 12;
    if (!pm && h === 12) h = 0;
  }
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

function longDate(ymd: string): string {
  const d = new Date(`${ymd.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

/** "1/8" style page counts summed, e.g. 5/8 + 1 2/8 → "1 7/8". */
function sumPages(rows: StudioScheduleRow[]): string {
  let eighths = 0;
  for (const r of rows) {
    if (r.kind !== "scene") continue;
    const t = r.pages.trim();
    const m = t.match(/^(?:(\d+)\s+)?(\d+)\/8$/) || t.match(/^(\d+)$/);
    if (!m) continue;
    if (t.includes("/")) eighths += (Number(m[1] ?? 0) * 8) + Number(m[2]);
    else eighths += Number(m[1]) * 8;
  }
  if (!eighths) return "";
  const whole = Math.floor(eighths / 8);
  const rest = eighths % 8;
  return [whole ? String(whole) : "", rest ? `${rest}/8` : ""].filter(Boolean).join(" ");
}

function groupCrew(crew: StudioCrewRow[]): Array<[string, StudioCrewRow[]]> {
  const map = new Map<string, StudioCrewRow[]>();
  for (const c of crew) {
    if (!has(c.name)) continue;
    const dept = c.department.trim() || "Crew";
    map.set(dept, [...(map.get(dept) ?? []), c]);
  }
  return [...map.entries()];
}

/** Split department groups into two columns with roughly equal row counts. */
function twoColumns(groups: Array<[string, StudioCrewRow[]]>) {
  const total = groups.reduce((n, [, r]) => n + r.length + 1, 0);
  const left: typeof groups = [];
  const right: typeof groups = [];
  let acc = 0;
  for (const g of groups) {
    if (acc < total / 2) {
      left.push(g);
      acc += g[1].length + 1;
    } else right.push(g);
  }
  return [left, right];
}

export function buildStudioCallSheetHtml(cs: StudioCallSheet, opts: { autoPrint?: boolean } = {}): string {
  const dayLabel =
    cs.dayNumber && cs.dayCount ? `Day ${cs.dayNumber} of ${cs.dayCount}` : cs.dayNumber ? `Day ${cs.dayNumber}` : "";

  const contacts = cs.keyContacts
    .filter((k) => has(k.name))
    .map(
      (k) =>
        `<tr><td class="k">${esc(k.role)}</td><td class="v">${esc(k.name)}${has(k.phone) ? `<span class="ph">${esc(k.phone)}</span>` : ""}</td></tr>`,
    )
    .join("");

  const timeRows = (
    [
      ["Crew call", cs.times.crewCall],
      ["Breakfast", cs.times.breakfast],
      ["Talent call", cs.times.talentCall],
      ["Shooting call", cs.times.shootingCall],
      ["Lunch", cs.times.lunch],
      ["Est. wrap", cs.times.wrap],
    ] as const
  )
    .filter(([, v]) => has(v))
    .map(([k, v]) => `<tr><td class="k">${k}</td><td class="v">${esc(v)}</td></tr>`)
    .join("");

  const w = cs.weather;
  const weatherHtml =
    w && (w.high != null || has(w.summary))
      ? `<div class="wx">
          <div class="wx-t">${w.high != null ? `${esc(w.high)}°` : ""}${w.low != null ? `<span> / ${esc(w.low)}°</span>` : ""}</div>
          <div class="wx-s">${esc(w.summary)}${w.rain != null ? ` · ${esc(w.rain)}% rain` : ""}</div>
          ${has(w.sunrise) || has(w.sunset) ? `<div class="wx-s">Sunrise ${esc(clock24(w.sunrise))} · Sunset ${esc(clock24(w.sunset))}</div>` : ""}
        </div>`
      : "";

  const locRows = cs.locations
    .filter((l) => has(l.set.name) || has(l.set.address))
    .map(
      (l, i) => `<tr>
        <td class="num"><span class="box">${i + 1}</span></td>
        <td><b>${esc(l.set.name)}</b><br/>${ml(l.set.address)}${has(l.set.phone) ? `<br/>${esc(l.set.phone)}` : ""}${has(l.set.note) ? `<div class="note">${ml(l.set.note)}</div>` : ""}</td>
        <td>${l.parking && (has(l.parking.name) || has(l.parking.address)) ? `<b>${esc(l.parking.name)}</b><br/>${ml(l.parking.address)}${has(l.parking.note) ? `<div class="note">${ml(l.parking.note)}</div>` : ""}` : "<span class=\"muted\">Same as set</span>"}</td>
        <td>${l.hospital && has(l.hospital.name) ? `<b>${esc(l.hospital.name)}</b><br/>${ml(l.hospital.address)}${has(l.hospital.phone) ? `<br/>${esc(l.hospital.phone)}` : ""}` : "<span class=\"muted\">TBD</span>"}</td>
      </tr>`,
    )
    .join("");

  const schedRows = cs.schedule
    .map((r) =>
      r.kind === "scene"
        ? `<tr>
            <td class="tm">${esc(r.start)}</td>
            <td class="c"><span class="sm">Scene</span><br/><b>${esc(r.scene)}</b></td>
            <td><b>${esc([r.intExt, r.location].filter(has).join(". ").toUpperCase())}</b><br/>${esc(r.description)}</td>
            <td class="c">${esc(r.dayNight)}</td>
            <td class="c">${esc(r.cast)}</td>
            <td class="c">${esc(r.pages)}</td>
            <td class="c">${esc(r.est)}</td>
          </tr>`
        : `<tr class="brk">
            <td class="tm">${esc(r.start)}</td>
            <td class="c"><b>${esc(r.label)}</b></td>
            <td colspan="4">${esc(r.description)}</td>
            <td class="c">${esc(r.est)}</td>
          </tr>`,
    )
    .join("");
  const pages = sumPages(cs.schedule);

  const castRows = cs.cast
    .filter((c) => has(c.name))
    .map(
      (c, i) =>
        `<tr><td class="c">${esc(c.no || i + 1)}</td><td><b>${esc(c.name)}</b></td><td>${esc(c.character)}</td><td class="c">${esc(c.status)}</td><td class="c">${esc(c.pickup)}</td><td class="c"><b>${esc(c.call)}</b></td><td class="c">${esc(c.hmu)}</td><td class="c">${esc(c.onSet)}</td><td class="c">${esc(c.wrap)}</td></tr>`,
    )
    .join("");

  const groups = groupCrew(cs.crew);
  const crewCol = (gs: typeof groups) =>
    `<table class="crew"><thead><tr><th>Name</th><th class="c">Call</th></tr></thead><tbody>${gs
      .map(
        ([dept, rows]) =>
          `<tr class="dept"><td colspan="2">${esc(dept)}</td></tr>${rows
            .map(
              (r) =>
                `<tr><td><b>${esc(r.name)}</b><br/><span class="sm">${esc(r.role)}</span></td><td class="c">${esc(r.call || cs.times.crewCall || cs.generalCall)}</td></tr>`,
            )
            .join("")}`,
      )
      .join("")}</tbody></table>`;
  const [left, right] = twoColumns(groups);
  const crewCount = groups.reduce((n, [, r]) => n + r.length, 0);

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>${esc(cs.projectTitle)} · Call sheet ${esc(cs.date)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;700&display=swap" rel="stylesheet">
<style>
  /* margin 0 hides the browser's own header and footer (about:blank, date, URL);
     the spacer rows of table.sheet repeat on every page and give the real margin. */
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 28px; font-family: "DM Sans", system-ui, -apple-system, sans-serif; color: #111; background: #fff; font-size: 10.5px; line-height: 1.35; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  table.sheet { width: 100%; border-collapse: collapse; }
  table.sheet > thead td, table.sheet > tfoot td { height: 0; padding: 0; }
  table.sheet > tbody > tr > td { padding: 0; }
  @media print {
    body { padding: 0 10mm; font-size: 10px; }
    table.sheet > thead td, table.sheet > tfoot td { height: 11mm; }
    h2 { margin-top: 12px; }
    .head { padding-bottom: 10px; }
    table.t td { padding: 4px 6px; }
    table.crew td { padding: 3px 6px; }
    .notice { margin-top: 10px; padding: 8px 10px; }
  }
  .head { display: grid; grid-template-columns: 1fr 1.15fr 1fr; border-bottom: 2px solid #111; padding-bottom: 14px; }
  .head > div { padding: 0 14px; }
  .head > div + div { border-left: 1px solid #ddd; }
  .head > div:first-child { padding-left: 0; } .head > div:last-child { padding-right: 0; }
  .logo { display: block; max-height: 46px; max-width: 170px; object-fit: contain; margin-bottom: 8px; }
  .co { font-family: "Bebas Neue", sans-serif; font-size: 26px; line-height: .95; letter-spacing: .02em; margin-bottom: 6px; }
  .muted { color: #777; }
  table.kv { width: 100%; border-collapse: collapse; margin-top: 10px; }
  table.kv td { padding: 2.5px 0; border-bottom: 1px solid #f0f0f0; vertical-align: top; }
  table.kv .k { color: #666; white-space: nowrap; padding-right: 8px; }
  table.kv .v { text-align: right; font-weight: 500; }
  .ph { display: block; color: #777; font-weight: 400; font-size: 9.5px; }
  .mid { text-align: center; }
  .title { font-size: 17px; font-weight: 700; margin: 2px 0 8px; }
  .lbl { font-size: 8.5px; letter-spacing: .14em; text-transform: uppercase; color: #666; font-weight: 700; }
  .call { font-family: "Bebas Neue", sans-serif; font-size: 58px; line-height: .9; margin: 4px 0 8px; }
  .call-bar { width: 44px; height: 4px; background: #FFDC00; margin: 0 auto 8px; }
  .safety { color: #444; font-size: 9.5px; }
  .day { font-size: 9px; letter-spacing: .14em; text-transform: uppercase; font-weight: 700; }
  .date { font-size: 15px; font-weight: 700; margin: 2px 0 6px; }
  .wx { border-top: 1px solid #f0f0f0; padding-top: 6px; }
  .wx-t { font-size: 18px; font-weight: 700; } .wx-t span { color: #777; font-weight: 400; font-size: 13px; }
  .wx-s { color: #666; font-size: 9px; }
  .notice { margin: 14px 0 4px; padding: 10px 12px; background: #FFF6BF; border-left: 4px solid #FFDC00; font-size: 10px; }
  h2 { display: flex; justify-content: space-between; align-items: baseline; margin: 18px 0 0; padding-bottom: 4px; border-bottom: 2px solid #111; font-family: "Bebas Neue", sans-serif; font-size: 20px; font-weight: 400; letter-spacing: .02em; }
  h2 small { font-family: "DM Sans", sans-serif; font-size: 9px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #666; }
  table.t { width: 100%; border-collapse: collapse; }
  table.t th { text-align: left; font-size: 8px; letter-spacing: .12em; text-transform: uppercase; color: #555; font-weight: 700; padding: 6px; border-bottom: 1px solid #ccc; }
  table.t td { padding: 6px; border-bottom: 1px solid #e6e6e6; vertical-align: top; }
  .c { text-align: center; } .tm { white-space: nowrap; font-weight: 700; }
  .num { width: 26px; } .box { display: inline-block; width: 18px; height: 18px; line-height: 16px; text-align: center; border: 1.5px solid #111; font-weight: 700; font-size: 9px; }
  .note { margin-top: 4px; font-style: italic; color: #555; }
  .sm { font-size: 8.5px; color: #777; }
  .nb { padding: 8px 0; border-bottom: 1px solid #e6e6e6; } .nb .lbl { margin-bottom: 2px; }
  tr.brk td { background: #fafafa; }
  tr.tot td { border-bottom: none; font-weight: 700; }
  .crew-wrap { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; align-items: start; }
  table.crew { width: 100%; border-collapse: collapse; }
  table.crew th { text-align: left; font-size: 8px; letter-spacing: .12em; text-transform: uppercase; color: #555; padding: 6px; border-bottom: 1px solid #ccc; }
  table.crew td { padding: 5px 6px; border-bottom: 1px solid #e6e6e6; }
  table.crew tr.dept td { background: #111; color: #FFDC00; font-size: 8px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; padding: 4px 6px; }
  section { break-inside: avoid; }
  h2 { break-after: avoid; }
  tr { break-inside: avoid; }
  tr.dept { break-after: avoid; }
</style></head><body>
<table class="sheet"><thead><tr><td></td></tr></thead><tfoot><tr><td></td></tr></tfoot><tbody><tr><td>
  <div class="head">
    <div>
      ${cs.company.logoDataUrl ? `<img class="logo" src="${esc(cs.company.logoDataUrl)}" alt="${esc(cs.company.name)}"/>` : ""}
      ${!cs.company.logoDataUrl || has(cs.company.name) ? `<div class="co"${cs.company.logoDataUrl ? ' style="font-size:15px"' : ""}>${esc(cs.company.name || "Production company")}</div>` : ""}
      ${has(cs.company.address) ? `<div class="muted">${ml(cs.company.address)}</div>` : ""}
      ${has(cs.company.phone) ? `<div class="muted">${esc(cs.company.phone)}</div>` : ""}
      ${contacts ? `<table class="kv">${contacts}</table>` : ""}
    </div>
    <div class="mid">
      <div class="title">${esc(cs.projectTitle || "Untitled shoot")}</div>
      <div class="lbl">General call</div>
      <div class="call">${esc(cs.generalCall || "TBD")}</div>
      <div class="call-bar"></div>
      <div class="safety">${ml(cs.safetyNote)}</div>
    </div>
    <div>
      ${dayLabel ? `<div class="day">${esc(dayLabel)}</div>` : ""}
      <div class="date">${esc(longDate(cs.date))}</div>
      ${weatherHtml}
      ${timeRows ? `<table class="kv">${timeRows}</table>` : ""}
    </div>
  </div>

  ${has(cs.notice) ? `<div class="notice">${ml(cs.notice)}</div>` : ""}

  ${locRows ? `<section><h2>Locations <small>${cs.locations.filter((l) => has(l.set.name) || has(l.set.address)).length} total</small></h2>
  <table class="t"><thead><tr><th>#</th><th>Set location</th><th>Parking</th><th>Nearest hospital</th></tr></thead><tbody>${locRows}</tbody></table></section>` : ""}

  ${schedRows ? `<section><h2>Schedule ${dayLabel ? `<small>${esc(dayLabel)}</small>` : ""}</h2>
  <table class="t"><thead><tr><th>Start</th><th class="c">Scene</th><th>Description</th><th class="c">D/N</th><th class="c">Cast</th><th class="c">Pages</th><th class="c">Est.</th></tr></thead>
  <tbody>${schedRows}${pages ? `<tr class="tot"><td colspan="5" style="text-align:right">Total</td><td class="c">${esc(pages)}</td><td></td></tr>` : ""}</tbody></table></section>` : ""}

  ${castRows ? `<section><h2>Cast <small>${cs.cast.filter((c) => has(c.name)).length} total</small></h2>
  <table class="t"><thead><tr><th class="c">ID</th><th>Name</th><th>Role</th><th class="c">Status</th><th class="c">Pickup</th><th class="c">Call</th><th class="c">HMU</th><th class="c">On set</th><th class="c">Wrap</th></tr></thead><tbody>${castRows}</tbody></table></section>` : ""}

  ${crewCount ? `<section><h2>Crew <small>${crewCount} total</small></h2>
  <div class="crew-wrap">${crewCol(left)}${right.length ? crewCol(right) : "<div></div>"}</div></section>` : ""}

  ${cs.extras && cs.extras.some((e) => has(e.label)) ? `<section><h2>Extras & stand-ins</h2>
  <table class="t"><thead><tr><th>Who</th><th class="c">Qty</th><th class="c">Arrive</th><th class="c">Ready</th></tr></thead><tbody>${cs.extras
    .filter((e) => has(e.label))
    .map((e) => `<tr><td>${esc(e.label)}</td><td class="c">${esc(e.count)}</td><td class="c">${esc(e.arrive)}</td><td class="c">${esc(e.ready)}</td></tr>`)
    .join("")}</tbody></table></section>` : ""}

  ${cs.notes && cs.notes.some((n) => has(n.body)) ? `<section><h2>Notes</h2>${cs.notes
    .filter((n) => has(n.body))
    .map((n) => `<div class="nb"><div class="lbl">${esc(n.title)}</div><div>${ml(n.body)}</div></div>`)
    .join("")}</section>` : ""}

  ${madeWithCreaHtml("callsheet")}
</td></tr></tbody></table>
  ${opts.autoPrint ? `<script>window.onload = function(){ setTimeout(function(){ window.print(); }, 400); };</script>` : ""}
</body></html>`;
}
