#!/usr/bin/env node
// Merges extracted stats with the agent-written persona into a self-contained HTML page.
// Usage: node render.mjs --data promptly-data.json --persona persona.json [--mood mixed|warm|cool|electric] [--mode auto|light|dark] [--out file.html] [--hide-projects] [--skip-number-check] [--skip-length-check]
//
// Every number in the persona's own writing has to come from the data. Write {{path}} for a stat (e.g.
// {{time.longestStreak.length}}, {{style.pleasePct}}%, {{totals.words|k}}) or {{q:"pattern"}} / {{q:"pattern"|pct}} for
// a query run with `extract.mjs --grep "pattern"`. They're filled in here. Any other digit has to match a real figure,
// or nothing is written and the unverified numbers are listed.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith("--")) args[argv[i].slice(2)] = argv[i + 1]?.startsWith("--") || argv[i + 1] === undefined ? true : argv[++i];
}

const here = path.dirname(fileURLToPath(import.meta.url));
const dataPath = args.data ?? path.join(os.tmpdir(), "promptly", "promptly-data.json");
const personaPath = args.persona ?? path.join(os.tmpdir(), "promptly", "persona.json");
const out = args.out ?? path.join(os.homedir(), "Desktop", "promptly-2026.html");

const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const persona = JSON.parse(fs.readFileSync(personaPath, "utf8"));

const problems = [];
if (!persona.archetype?.name) problems.push("archetype.name is required");
if (!persona.archetype?.tagline) problems.push("archetype.tagline is required");
if (!Array.isArray(persona.traits) || persona.traits.length < 3) problems.push("traits needs 3-4 entries");
if (!Array.isArray(persona.quotes) || persona.quotes.length < 1) problems.push("quotes needs 1-3 entries");
if (problems.length) {
  console.error(`persona.json is incomplete:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}

// ---------- numbers ----------

const factsPath = path.join(path.dirname(dataPath), "facts.json");
const facts = fs.existsSync(factsPath) ? JSON.parse(fs.readFileSync(factsPath, "utf8")) : {};
// What the persona's numbers can be checked against: the aggregates, not daily counts, which would vouch for almost
// any small number.
const { sample: _s, shortSample: _ss, moments: _m, errors: _e, userFirstName: _u, eras: _er, ...truthData } = data;
const truthSource = { ...truthData, time: { ...truthData.time, byDay: undefined, bySourceDay: undefined }, eras: _er && { early: _er.early?.stats, recent: _er.recent?.stats } };
const truth = new Set();
const collect = (v) => { if (typeof v === "number") truth.add(v); else if (v && typeof v === "object") Object.values(v).forEach(collect); };
collect(truthSource);
// Shares of all prompts, which the agent may quote as a percentage.
const total = data.totals?.prompts || 1, share = (n) => Math.round((n / total) * 1000) / 10;
for (const n of [...Object.values(data.bySource ?? {}), ...(data.time?.byWeekday ?? []), ...(data.time?.byHour ?? []), ...(data.phrases?.catchphrases ?? []).map((c) => c.count), ...(data.projects ?? []).map((p) => p.count)]) truth.add(share(n));
for (const f of Object.values(facts)) { truth.add(f.total); truth.add(f.pct); Object.values(f.byMonth ?? {}).forEach((n) => truth.add(n)); }

const numberProblems = [];
const fmtNum = (v, f) => (f === "k" ? `${Math.round(v / 1000)}k` : f === "pct" ? `${v}%` : typeof v === "number" && Number.isInteger(v) ? v.toLocaleString("en-US") : String(v));
function fill(str, where) {
  return str
    .replace(/\{\{\s*q:"((?:[^"\\]|\\.)*)"\s*(?:\|\s*(\w+)\s*)?\}\}/g, (all, pattern, f) => {
      const fact = facts[pattern];
      if (!fact) { numberProblems.push(`${where}: no query saved for "${pattern}". Run: node scripts/extract.mjs --grep "${pattern}"`); return all; }
      return f === "pct" ? `${fact.pct}%` : fmtNum(fact.total);
    })
    .replace(/\{\{\s*([\w.-]+)\s*(?:\|\s*(\w+)\s*)?\}\}/g, (all, p, f) => {
      const v = p.split(".").reduce((o, k) => o?.[k], truthData);
      if (typeof v !== "number") { numberProblems.push(`${where}: {{${p}}} isn't a number in the data`); return all; }
      return fmtNum(v, f);
    });
}
// Times, dates, years, ordinals, hex colours and anything quoted are words, not claims about the data.
const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?";
const EXEMPT = [
  /["“][^"”]*["”]/g,
  /\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/gi,
  new RegExp(`\\b${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?\\b|\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}`, "gi"),
  /\b(?:19|20)\d{2}\b/g,
  /\b\d+(?:st|nd|rd|th)\b/gi,
  /#[0-9a-f]{3,8}\b/gi,
];
const matches = (v, dec, unit) => [...truth].some((t) => {
  const s = unit === "k" ? t / 1000 : unit === "m" ? t / 1e6 : t, k = 10 ** dec;
  return Math.round(s * k) / k === v || (dec === 0 && Math.floor(s) === v);
});
function check(str, where) {
  let plain = str;
  for (const re of EXEMPT) plain = plain.replace(re, " ");
  for (const m of plain.matchAll(/(?<![\w#.\-])(\d[\d,]*(?:\.\d+)?)(k|m)?(?![\w])/gi)) {
    const raw = m[1].replace(/,/g, ""), dec = raw.includes(".") ? raw.split(".")[1].length : 0;
    if (!matches(Number(raw), dec, m[2]?.toLowerCase())) numberProblems.push(`${where}: "${m[0]}" isn't in the data, in "${str.length > 90 ? str.slice(0, 90) + "…" : str}"`);
  }
}
// Verbatim prompts (`text`), their labels (`meta`) and names are the user's words; everything else is the agent's.
function walk(v, where) {
  if (typeof v === "string") { const out = fill(v, where); if (!/(^|\.)(text|meta|name|role)$/.test(where)) check(out, where); return out; }
  if (Array.isArray(v)) return v.map((x, i) => walk(x, `${where}[${i}]`));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === "look" || k === "shifts" || k === "value" ? x : walk(x, where ? `${where}.${k}` : k)]));
  return v;
}
Object.assign(persona, walk(persona, ""));
if (numberProblems.length && !args["skip-number-check"]) {
  console.error(`persona.json has numbers that can't be traced to the data:\n  ${numberProblems.join("\n  ")}\n\nUse {{path}} for a stat or {{q:"pattern"}} for a query you ran with extract.mjs --grep, or reword without the number.`);
  process.exit(1);
}

// ---------- lengths ----------

// Each slide is laid out to hold its copy up to these limits without the type getting too small to read, so longer
// copy has to be trimmed rather than squeezed in. Words, unless it says chars.
const words = (s) => String(s ?? "").split(/\s+/).filter(Boolean).length;
const LIMITS = {
  "archetype.name": [36, "chars"], "archetype.tagline": [14], "archetype.description": [60], "captions.*": [30],
  "tells[].label": [4], "tells[].note": [25], "quotes[].text": [30], "quotes[].caption": [20],
  "receipts[].text": [25], "receipts[].marks[].note": [8], "receipts[].verdict": [3], "receipts[].take": [50],
  "evolution.then.text": [20], "evolution.now.text": [20], "evolution.read": [55],
  "doomsday.title": [6], "doomsday.read": [50], "doomsday.sentence": [12],
  prediction: [20],
};
const strings = (v, where = "") => typeof v === "string" ? [[where, v]]
  : Array.isArray(v) ? v.flatMap((x, i) => strings(x, `${where}[${i}]`))
  : v && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => strings(x, where ? `${where}.${k}` : k)) : [];
const lengthProblems = strings(persona).flatMap(([where, s]) => {
  const [max, unit = "words"] = LIMITS[where.replace(/\[\d+\]/g, "[]").replace(/^captions\..+/, "captions.*")] ?? [];
  const n = unit === "chars" ? s.length : words(s);
  return max && n > max ? [`${where}: ${n} ${unit}, limit ${max}, in "${s.length > 90 ? s.slice(0, 90) + "…" : s}"`] : [];
});
if (lengthProblems.length && !args["skip-length-check"]) {
  console.error(`persona.json has copy too long for its slide:\n  ${lengthProblems.join("\n  ")}\n\nTrim each one to its limit (the slides are laid out for these lengths), then run this again.`);
  process.exit(1);
}

// Only aggregate stats and the quotes the agent chose go into the page.
// The raw prompt sample and auto-picked moments stay on disk.
const { sample, shortSample, moments, errors, userFirstName, eras, ...stats } = data;
if (args["hide-projects"]) stats.projects = [];
// Early and recent stretches keep their numbers; their prompt samples stay on disk too.
if (eras?.early && eras?.recent) stats.eras = Object.fromEntries(Object.entries(eras).map(([k, { from, to, stats: s }]) => [k, { from, to, stats: s }]));

const payload = {
  name: persona.name ?? null,
  role: persona.role ?? null,
  sources: stats.sources,
  stats,
  persona,
};

// The user's colour preferences. Flags override what the agent put in persona.json.
const LOOKS = { mood: ["mixed", "warm", "cool", "electric"], mode: ["auto", "light", "dark"] };
const look = { mood: args.mood ?? persona.look?.mood ?? "mixed", mode: args.mode ?? persona.look?.mode ?? "auto" };
for (const [key, allowed] of Object.entries(LOOKS)) {
  if (!allowed.includes(look[key])) {
    console.error(`unknown ${key} "${look[key]}", expected one of: ${allowed.join(", ")}`);
    process.exit(1);
  }
}
payload.look = look;
const template = fs.readFileSync(path.join(here, "..", "templates", "promptly.html"), "utf8");
const json = JSON.stringify(payload).replace(/</g, "\\u003c");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, template.replace("/*__PROMPTLY_DATA__*/", () => json));
console.log(`wrote ${out} (${look.mood}, ${look.mode})`);
