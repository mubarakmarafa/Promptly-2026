#!/usr/bin/env node
// Reads local AI chat history (Claude Code, Codex, Cursor), computes prompting stats,
// and writes a compact, redacted JSON file for the agent to analyse.
// Usage: node extract.mjs [--out path] [--days N] [--sample N]
//
// Query mode prints matching prompts (redacted) instead of writing the file, so the agent can dig for evidence:
//   node extract.mjs --grep "maybe|i wonder" [--limit 20] [--from 2026-05-01] [--to 2026-06-30]
//   node extract.mjs --from 2026-05-01 --to 2026-05-31 --limit 30     (a spread of prompts from a date range)
// Output: { total, pct, byMonth, matches: [{ text, source, date, hour }] }. Same input, same output, every time.
// Each query's numbers are also saved to facts.json next to the data file, where render.mjs picks them up to fill
// {{q:"pattern"}} placeholders and to check the numbers in the persona. A fresh extraction clears them.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { execFileSync } from "node:child_process";

const HOME = os.homedir();
const args = parseArgs(process.argv.slice(2));
const OUT = args.out ?? path.join(os.tmpdir(), "how-i-ai", "wrapped-data.json");
const SINCE = args.days ? Date.now() - Number(args.days) * 864e5 : 0;
const SAMPLE_SIZE = Number(args.sample ?? 120);
const FACTS = path.join(path.dirname(OUT), "facts.json");
// A whole-history query is keyed by its pattern alone, which is what {{q:"pattern"}} looks up.
const factKey = (a) => (a.from || a.to ? `${a.grep ?? ""} @ ${a.from ?? ""}..${a.to ?? ""}` : String(a.grep));
// Ignore the last few minutes so the /wrapped session doesn't analyse itself.
const UNTIL = Date.now() - 5 * 60e3;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) out[argv[i].slice(2)] = argv[i + 1]?.startsWith("--") ? true : argv[++i] ?? true;
  }
  return out;
}

// ---------- redaction ----------

const SECRET_PATTERNS = [
  /\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}/g,
  /\bsk-ant-[A-Za-z0-9_-]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b[A-Fa-f0-9]{32,}\b/g,
  /\b[A-Za-z0-9+/_-]{40,}={0,2}/g,
];

function redact(text) {
  let t = text;
  for (const re of SECRET_PATTERNS) t = t.replace(re, "[secret]");
  t = t.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]");
  t = t.replace(/(https?:\/\/[^\s?#]+)[?#]\S*/g, "$1");
  t = t.replace(/\+?\d[\d\s().-]{8,}\d/g, (m) => (m.replace(/\D/g, "").length >= 10 ? "[phone]" : m));
  t = t.split(HOME).join("~").replace(/\/Users\/[^/\s]+/g, "~");
  return t;
}

// ---------- prompt cleaning ----------

const NOISE_PREFIXES = [
  "<", "# AGENTS", "# In app browser", ">>>", "Caveat:", "Automation:",
  "The next image is untrusted", "[Request interrupted", "This session is being continued",
  "Update on pull request #", "Your turn ended while you were waiting",
];
// Prompts sent by buttons, harnesses and automations rather than typed by a person.
const MACHINE_PATTERNS = [/Implement the plan as specified, it is attached/, /^\S.{0,120}\bwhich Supacode is watching\b/];

function cleanPrompt(raw) {
  if (typeof raw !== "string") return null;
  let images = 0;
  // Codex wraps attachments and selections around the actual request.
  const mine = raw.match(/## My request(?: for Codex)?:\s*([\s\S]*)$/);
  if (mine) raw = mine[1];
  let text = raw
    .replace(/\[Image[^\]]*\]/g, () => (images++, ""))
    .replace(/```(?:browser_element|chat_selection)[\s\S]*?```/g, " ")
    .replace(/<pasted_content[\s\S]*?<\/pasted_content[^>]*>/g, " [pasted] ")
    .replace(/<supacode_context[\s\S]*?<\/supacode_context>/g, () => (images++, ""))
    .replace(/\[Assistant quote\]\([^)]*\)/g, "")
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .trim();
  if (!text) return images ? { text: "", images } : null;
  if (NOISE_PREFIXES.some((p) => text.startsWith(p))) return null;
  if (MACHINE_PATTERNS.some((re) => re.test(text))) return null;
  return { text, images };
}

// ---------- collectors ----------

const prompts = []; // { text, images, ts, source, project, session }
const meta = {
  claudeCode: { sessions: new Set(), models: {}, outputTokens: 0, files: 0 },
  codex: { sessions: new Set(), models: {}, files: 0 },
  cursor: { sessions: new Set(), models: {} },
};

function addPrompt(p) {
  if (!p.ts || p.ts < SINCE || p.ts > UNTIL) return;
  prompts.push(p);
}

async function* readJsonl(file) {
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    try {
      yield JSON.parse(line);
    } catch {}
  }
}

function walk(dir, pred, depth = 0, maxDepth = 6, acc = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && depth < maxDepth) walk(p, pred, depth + 1, maxDepth, acc);
    else if (e.isFile() && pred(p)) acc.push(p);
  }
  return acc;
}

async function collectClaudeCode() {
  const root = path.join(HOME, ".claude", "projects");
  // Top-level session files only; nested ones are subagent transcripts.
  const files = walk(root, (p) => p.endsWith(".jsonl") && path.dirname(path.dirname(p)) === root, 0, 1);
  const seenMsgIds = new Set();
  for (const file of files) {
    meta.claudeCode.files++;
    for await (const e of readJsonl(file)) {
      if (e.type === "assistant" && e.message?.id && !seenMsgIds.has(e.message.id)) {
        seenMsgIds.add(e.message.id);
        const m = e.message.model;
        if (m && !m.startsWith("<")) meta.claudeCode.models[m] = (meta.claudeCode.models[m] ?? 0) + 1;
        meta.claudeCode.outputTokens += e.message.usage?.output_tokens ?? 0;
        continue;
      }
      if (e.type !== "user" || e.isSidechain || e.isMeta) continue;
      if (e.promptSource === "system" || e.turnOrigin === "task_notification" || e.turnOrigin === "scheduled") continue;
      const c = e.message?.content;
      let raw = null;
      let extraImages = 0;
      if (typeof c === "string") raw = c;
      else if (Array.isArray(c) && c.some((b) => b.type === "text") && !c.some((b) => b.type === "tool_result")) {
        raw = c.filter((b) => b.type === "text").map((b) => b.text).join("\n");
        extraImages = c.filter((b) => b.type === "image").length;
      }
      const cleaned = cleanPrompt(raw);
      if (!cleaned) continue;
      meta.claudeCode.sessions.add(e.sessionId);
      addPrompt({
        ...cleaned,
        images: cleaned.images + extraImages,
        ts: Date.parse(e.timestamp),
        source: "claude-code",
        project: projectName(e.cwd),
        session: e.sessionId,
      });
    }
  }
}

async function collectCodex() {
  const root = path.join(HOME, ".codex", "sessions");
  const files = walk(root, (p) => p.endsWith(".jsonl"));
  for (const file of files) {
    let session = file;
    let cwd = null;
    let skip = false;
    for await (const e of readJsonl(file)) {
      const p = e.payload ?? {};
      if (e.type === "session_meta") {
        if (JSON.stringify(p.source ?? "").includes("subagent")) {
          skip = true;
          break;
        }
        session = p.id ?? file;
        cwd = p.cwd ?? cwd;
        continue;
      }
      if (e.type === "turn_context") {
        cwd = p.cwd ?? cwd;
        if (p.model && p.model !== "codex-auto-review") meta.codex.models[p.model] = (meta.codex.models[p.model] ?? 0) + 1;
        continue;
      }
      if (e.type !== "response_item" || p.type !== "message" || p.role !== "user") continue;
      const raw = (p.content ?? []).filter((b) => b.type === "input_text").map((b) => b.text).join("\n");
      const images = (p.content ?? []).filter((b) => b.type === "input_image").length;
      const cleaned = cleanPrompt(raw);
      if (!cleaned) continue;
      meta.codex.sessions.add(session);
      addPrompt({
        ...cleaned,
        images: cleaned.images + images,
        ts: Date.parse(e.timestamp),
        source: "codex",
        project: projectName(cwd),
        session,
      });
    }
    if (!skip) meta.codex.files++;
  }
}

async function collectCursor() {
  const db = path.join(HOME, "Library", "Application Support", "Cursor", "User", "globalStorage", "state.vscdb");
  if (!fs.existsSync(db)) return;
  let DatabaseSync;
  try {
    process.removeAllListeners("warning");
    ({ DatabaseSync } = await import("node:sqlite"));
  } catch {
    return; // Node < 22.5
  }
  const conn = new DatabaseSync(db, { readOnly: true });
  // Subagent conversations are written by the agent, not the user.
  const subagents = new Set(
    conn
      .prepare(`select key from cursorDiskKV where key like 'composerData:%' and json_valid(value) and json_extract(value,'$.subagentInfo') is not null`)
      .all()
      .map((r) => r.key.split(":")[1]),
  );
  const rows = conn
    .prepare(
      `select key, json_extract(value,'$.text') as text, json_extract(value,'$.createdAt') as createdAt,
              json_array_length(json_extract(value,'$.images')) as images
       from cursorDiskKV where key like 'bubbleId:%' and json_valid(value) and json_extract(value,'$.type') = 1`,
    )
    .all();
  for (const r of rows) {
    const cleaned = cleanPrompt(r.text);
    if (!cleaned) continue;
    const composer = r.key.split(":")[1];
    if (subagents.has(composer)) continue;
    meta.cursor.sessions.add(composer);
    addPrompt({
      ...cleaned,
      images: cleaned.images + (r.images ?? 0),
      ts: typeof r.createdAt === "number" ? r.createdAt : Date.parse(r.createdAt),
      source: "cursor",
      project: null,
      session: composer,
    });
  }
  const models = conn
    .prepare(
      `select json_extract(value,'$.modelConfig.modelName') as m, count(*) as n
       from cursorDiskKV where key like 'composerData:%' and json_valid(value) group by m`,
    )
    .all();
  for (const { m, n } of models) if (m && m !== "default") meta.cursor.models[m] = n;
  conn.close();
}

function projectName(cwd) {
  if (!cwd) return null;
  if (cwd === HOME) return "~ (home)";
  // Codex Desktop names scratch folders after the first prompt, so the name would leak prompt text.
  if (/\/Codex\/\d{4}-\d{2}-\d{2}\/[^/]+\/?$/.test(cwd)) return "Codex chats";
  // Same for scratch folders like "2026-10-12-check-my-threads-9471c7e8".
  if (/^\d{4}-\d{2}-\d{2}-/.test(path.basename(cwd))) return "Scratch chats";
  // Worktree managers nest checkouts as .../worktrees/<repo>/<branch>; credit the repo.
  const wt = cwd.match(/\/worktrees\/([^/]+)\/[^/]+\/?$/);
  if (wt && !/^[0-9a-f]{3,}$/i.test(wt[1])) return wt[1];
  // Collapse worktree and export suffixes: "app-20f164d4" and "app-Conversations-2026-07-14" become "app".
  return path
    .basename(cwd)
    .replace(/-[0-9a-f]{6,}$/i, "")
    .replace(/(-[A-Za-z]+){0,2}-\d{4}-\d{2}-\d{2}$/, "") || null;
}

// ---------- stats ----------

const words = (t) => t.match(/[\p{L}\p{N}']+/gu) ?? [];
const count = (arr, f) => arr.reduce((n, x) => n + (f(x) ? 1 : 0), 0);
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);
const dayKey = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const topN = (obj, n) =>
  Object.entries(obj)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => ({ name: k, count: v }));

const USERNAME = os.userInfo().username.toLowerCase();
const stripCode = (t) => t.replace(/```[\s\S]*?```/g, " ").replace(/`[^`]*`/g, " ").replace(/<[^>]+>/g, " ").replace(/\S*[/\\.]\S*\.\S+/g, " ");

const RE = {
  please: /\b(please|pls|plz)\b/i,
  thanks: /\b(thanks|thank you|thx|ty|cheers|appreciate)\b/i,
  sorry: /\b(sorry|apologi[sz]e|my bad)\b/i,
  swear: /\b(fuck\w*|shit\w*|damn\w*|wtf|ffs|bloody|crap|hell)\b/i,
  praise: /\b(perfect|amazing|awesome|love it|love this|brilliant|beautiful|nice|great job|legend|chef'?s kiss)\b/i,
  frustration: /\b(still (not|doesn'?t|broken)|doesn'?t work|not working|broken|wrong|again|why (is|are|did|does)|undo|revert|no no)\b/i,
  greeting: /^(hi|hey|hello|yo|sup|morning|good morning|hiya|howdy)\b/i,
  question: /\?\s*$/,
  exclaim: /!/,
  code: /```|`[^`]+`/,
  emoji: /\p{Extended_Pictographic}/u,
  url: /https?:\/\//,
};

const STOP = new Set(
  "the a an and or but to of in on for with is it this that i you me my we can could would should be do does are was if so just at as from have has not no yes what how it's i'm let's lets there its will your our up out all also then them they some any make like when want think now into one new where add okay ok please need get see use know don't dont more here only did were been into than which who way thing things really well right sure going want there's that's yeah yep sorry thanks".split(" "),
);

const CATCHPHRASES = [
  "make it", "fix it", "fix this", "do it", "go ahead", "let's go", "lets go", "continue", "try again", "same thing",
  "doesn't work", "still", "perfect", "love it", "looks good", "lgtm", "ship it", "yo dawg", "hmm", "actually",
  "basically", "quick", "real quick", "can you", "could you", "i want", "i need", "what if", "why", "nice",
];

const sortedKeys = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));

// How someone writes in one stretch of time, so the early and recent stretches can be compared.
const HEDGE = /\b(maybe|perhaps|i wonder|kind of|kinda|sort of|i think|not sure|might|possibly)\b/i;
const LAUGH = /\b(ha(ha)+h?|hah|lol|lmao)\b/i;
function eraStats(list) {
  const n = list.length, wc = list.map((p) => words(p.text).length).sort((a, b) => a - b);
  const share = (f) => pct(count(list, f), n);
  return {
    prompts: n,
    medianWords: wc[Math.floor(wc.length / 2)] ?? 0,
    questionPct: share((p) => RE.question.test(p.text)),
    pleasePct: share((p) => RE.please.test(p.text)),
    hedgePct: share((p) => HEDGE.test(p.text)),
    laughPct: share((p) => LAUGH.test(p.text)),
    exclaimPct: share((p) => RE.exclaim.test(p.text)),
    praisePct: share((p) => RE.praise.test(p.text)),
    frustrationPct: share((p) => RE.frustration.test(p.text)),
    lowercaseStartPct: share((p) => /^[a-z]/.test(p.text.trim())),
    opsPct: share((p) => isOps(p.text)),
  };
}
function era(list) {
  return list.length ? { from: dayKey(list[0].ts), to: dayKey(list.at(-1).ts), stats: eraStats(list), sample: voiceSample(list, 25).filter(Boolean) } : null;
}

function capsRage(t) {
  const letters = t.replace(/[^A-Za-z]/g, "");
  return letters.length >= 8 && letters === letters.toUpperCase();
}

function longestStreak(days) {
  const sorted = [...days].sort();
  let best = { length: 0 }, cur = 0, start = null, prev = null;
  for (const d of sorted) {
    const t = Date.parse(d + "T12:00:00");
    if (prev && t - prev < 1.5 * 864e5) cur++;
    else (cur = 1), (start = d);
    if (cur > best.length) best = { length: cur, from: start, to: d };
    prev = t;
  }
  return best;
}

// Short operational commands ("restart the server", "push it") are habits, not personality.
const OPS = /^(?:(?:ok(?:ay)?|hey|yo|now|pls|please|can you|could you|would you|go ahead and|let'?s)[\s,!.]*)*(?:re-?start|refresh|reload|run|start|stop|kill|push|pull|merge|commit|deploy|rebuild|build|continue|retry|try (?:it |this |that )?again|check (?:again|origin|it)|install|update|switch|rebase|stash|ship|open|spin up|get the server|do it|go|done|progress)\b/i;
const isOps = (t) => words(t).length <= 12 && OPS.test(t.trim());

// Language that shows how someone thinks: reasons, opinions, feelings, what they want for users.
const VOICE = /\b(because|since|so that|i think|i feel|i want|i'?d (?:like|love)|ideally|should|feels?|looks?|love|hate|annoy\w*|wonder|maybe|what if|instead|rather|users?|people|honestly|actually|kind of|i'?m not sure|curious|why)\b/gi;

// A stable stand-in for randomness, from the prompt's own text, so the same history always gives the same sample.
const jitter = (t) => { let h = 2166136261; for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619); return (h >>> 0) / 2 ** 32; };

// Spread across time, one pick per bucket, scored by `score`.
function spreadPick(list, n, score) {
  const sorted = [...list].sort((a, b) => a.ts - b.ts);
  const bucketSize = Math.max(1, Math.floor(sorted.length / n));
  const picks = [];
  for (let i = 0; i < sorted.length && picks.length < n; i += bucketSize) {
    picks.push(sorted.slice(i, i + bucketSize).sort((a, b) => score(b) - score(a))[0]);
  }
  return picks.map(fmtQuote);
}

function voiceSample(list, n) {
  const candidates = list.filter((p) => {
    const w = words(p.text).length;
    return w >= 8 && w <= 160 && !isOps(p.text);
  });
  return spreadPick(candidates, n, (p) =>
    (p.text.match(VOICE)?.length ?? 0) * 1.5 + (RE.praise.test(p.text) ? 1 : 0) + (RE.frustration.test(p.text) ? 1 : 0) +
    (/!{2,}|\?{2,}|\.{3}|hah|lol|:\)|:\//i.test(p.text) ? 1 : 0) + jitter(p.text) * 2,
  );
}

function shortSample(list, n) {
  const candidates = list.filter((p) => {
    const w = words(p.text).length;
    return w >= 1 && w < 8;
  });
  return spreadPick(candidates, n, (p) => jitter(p.text));
}

function fmtQuote(p) {
  if (!p) return null;
  const d = new Date(p.ts);
  let text = redact(p.text).replace(/\s+/g, " ").trim();
  if (text.length > 400) text = text.slice(0, 400) + "…";
  return { text, source: p.source, project: p.project, date: dayKey(p.ts), hour: d.getHours(), weekday: d.getDay() };
}

function computeStats(list) {
  const n = list.length;
  const wc = list.map((p) => words(p.text).length);
  const sortedWc = [...wc].sort((a, b) => a - b);
  const byHour = Array(24).fill(0);
  const byWeekday = Array(7).fill(0);
  const byMonth = {};
  const byDay = {};
  const bySourceDay = {};
  const bySource = {};
  const byProject = {};
  const openers = {};
  const vocab = {};
  const oneLiners = {};
  const phraseCounts = Object.fromEntries(CATCHPHRASES.map((c) => [c, 0]));
  const frustrationByMonth = {};

  for (const p of list) {
    const d = new Date(p.ts);
    byHour[d.getHours()]++;
    byWeekday[d.getDay()]++;
    const month = dayKey(p.ts).slice(0, 7);
    byMonth[month] = (byMonth[month] ?? 0) + 1;
    byDay[dayKey(p.ts)] = (byDay[dayKey(p.ts)] ?? 0) + 1;
    bySource[p.source] = (bySource[p.source] ?? 0) + 1;
    const sd = (bySourceDay[p.source] ??= {});
    sd[dayKey(p.ts)] = (sd[dayKey(p.ts)] ?? 0) + 1;
    if (p.project) byProject[p.project] = (byProject[p.project] ?? 0) + 1;
    const w = words(p.text.toLowerCase());
    if (w[0]) openers[w[0]] = (openers[w[0]] ?? 0) + 1;
    // Long prompts are usually pasted logs or code, which drown out the user's own vocabulary.
    const prose = w.length <= 250 ? words(stripCode(p.text).toLowerCase()) : [];
    for (const x of prose) if (x.length > 2 && !STOP.has(x) && x !== USERNAME && !/^\d+$/.test(x)) vocab[x] = (vocab[x] ?? 0) + 1;
    if (w.length > 0 && w.length <= 3) {
      const k = p.text.toLowerCase().replace(/[^\p{L}\p{N}' ]/gu, "").trim();
      if (k) oneLiners[k] = (oneLiners[k] ?? 0) + 1;
    }
    const lower = " " + p.text.toLowerCase() + " ";
    for (const c of CATCHPHRASES) if (lower.includes(" " + c)) phraseCounts[c]++;
    if (RE.frustration.test(p.text) || RE.swear.test(p.text) || capsRage(p.text))
      frustrationByMonth[month] = (frustrationByMonth[month] ?? 0) + 1;
  }

  const days = Object.keys(byDay);
  const busiest = topN(byDay, 1)[0];
  const lateNight = byHour.slice(0, 5).reduce((a, b) => a + b, 0);
  const peakHour = byHour.indexOf(Math.max(...byHour));
  const longestIdx = wc.indexOf(Math.max(...wc));
  const latest = [...list]
    .filter((p) => new Date(p.ts).getHours() < 5)
    .sort((a, b) => ((new Date(b.ts).getHours() + 19) % 24) - ((new Date(a.ts).getHours() + 19) % 24))[0];
  const firstSorted = [...list].sort((a, b) => a.ts - b.ts);
  const sessions = new Set(list.map((p) => p.session));

  return {
    totals: {
      prompts: n,
      sessions: sessions.size,
      words: wc.reduce((a, b) => a + b, 0),
      activeDays: days.length,
      firstDate: firstSorted[0] && dayKey(firstSorted[0].ts),
      lastDate: firstSorted.at(-1) && dayKey(firstSorted.at(-1).ts),
      imagesAttached: list.reduce((a, p) => a + (p.images ?? 0), 0),
    },
    bySource,
    time: {
      byHour,
      byWeekday,
      byMonth,
      byDay: sortedKeys(byDay),
      bySourceDay: Object.fromEntries(Object.entries(bySourceDay).map(([k, v]) => [k, sortedKeys(v)])),
      peakHour,
      lateNightPct: pct(lateNight, n),
      weekendPct: pct(byWeekday[0] + byWeekday[6], n),
      busiestDay: busiest && { date: busiest.name, prompts: busiest.count },
      longestStreak: longestStreak(days),
      avgPromptsPerActiveDay: days.length ? Math.round(n / days.length) : 0,
    },
    style: {
      avgWords: n ? Math.round(wc.reduce((a, b) => a + b, 0) / n) : 0,
      medianWords: sortedWc[Math.floor(n / 2)] ?? 0,
      longestPromptWords: sortedWc.at(-1) ?? 0,
      oneWordPct: pct(count(wc, (x) => x === 1), n),
      novelPct: pct(count(wc, (x) => x >= 150), n),
      pleasePct: pct(count(list, (p) => RE.please.test(p.text)), n),
      thanksPct: pct(count(list, (p) => RE.thanks.test(p.text)), n),
      sorryCount: count(list, (p) => RE.sorry.test(p.text)),
      swearCount: count(list, (p) => RE.swear.test(p.text)),
      capsRageCount: count(list, (p) => capsRage(p.text)),
      praiseCount: count(list, (p) => RE.praise.test(p.text)),
      frustrationCount: count(list, (p) => RE.frustration.test(p.text)),
      greetingPct: pct(count(list, (p) => RE.greeting.test(p.text)), n),
      questionPct: pct(count(list, (p) => RE.question.test(p.text)), n),
      exclaimPct: pct(count(list, (p) => RE.exclaim.test(p.text)), n),
      lowercaseStartPct: pct(count(list, (p) => /^[a-z]/.test(p.text)), n),
      codePct: pct(count(list, (p) => RE.code.test(p.text)), n),
      emojiPct: pct(count(list, (p) => RE.emoji.test(p.text)), n),
      urlPct: pct(count(list, (p) => RE.url.test(p.text)), n),
      imagePct: pct(count(list, (p) => p.images > 0), n),
      opsPct: pct(count(list, (p) => isOps(p.text)), n),
    },
    phrases: {
      topOpeners: topN(openers, 10),
      topWords: topN(vocab, 25),
      topShortReplies: topN(oneLiners, 12),
      catchphrases: topN(phraseCounts, 12).filter((x) => x.count > 0),
    },
    projects: topN(byProject, 8),
    frustrationByMonth,
    moments: {
      longestPrompt: fmtQuote(list[longestIdx]),
      latestNightPrompt: fmtQuote(latest),
      firstPrompt: fmtQuote(firstSorted[0]),
      angriest: fmtQuote(list.find((p) => capsRage(p.text)) ?? list.find((p) => RE.swear.test(p.text))),
      politest: fmtQuote(list.find((p) => RE.please.test(p.text) && RE.thanks.test(p.text))),
    },
  };
}

function firstName() {
  try {
    const name = execFileSync("git", ["config", "--global", "user.name"], { encoding: "utf8" }).trim();
    // Skip handles like "mubarakmarafa"; only a name with a space is clearly a real name.
    if (name.includes(" ")) return name.split(" ")[0];
  } catch {}
  try {
    const full = execFileSync("id", ["-F"], { encoding: "utf8" }).trim();
    if (full) return full.split(" ")[0];
  } catch {}
  return null;
}

// ---------- main ----------

const started = Date.now();
const errors = [];
for (const [name, fn] of [["claude-code", collectClaudeCode], ["codex", collectCodex], ["cursor", collectCursor]]) {
  try {
    await fn();
  } catch (err) {
    errors.push(`${name}: ${err.message}`);
  }
}

// Drop repeated long prompts (automations, pasted templates); keep repeated short replies like "yes".
const freq = {};
for (const p of prompts) if (p.text.length > 40) freq[p.text] = (freq[p.text] ?? 0) + 1;
const human = prompts.filter((p) => !(p.text.length > 40 && freq[p.text] >= 4)).sort((a, b) => a.ts - b.ts);

// Query mode: print what matches and stop.
if (args.grep || args.from || args.to) {
  let re;
  try { re = args.grep ? new RegExp(args.grep, "i") : null; } catch (err) { console.error(`bad --grep: ${err.message}`); process.exit(1); }
  const hits = human.filter((p) => (!re || re.test(p.text)) && (!args.from || dayKey(p.ts) >= args.from) && (!args.to || dayKey(p.ts) <= args.to));
  const byMonth = {};
  for (const p of hits) byMonth[dayKey(p.ts).slice(0, 7)] = (byMonth[dayKey(p.ts).slice(0, 7)] ?? 0) + 1;
  const limit = Number(args.limit ?? 20);
  const picks = re ? spreadPick(hits, limit, (p) => jitter(p.text)) : voiceSample(hits, limit);
  const fact = { total: hits.length, pct: pct(hits.length, human.length), byMonth: sortedKeys(byMonth) };
  const facts = (() => { try { return JSON.parse(fs.readFileSync(FACTS, "utf8")); } catch { return {}; } })();
  facts[factKey(args)] = fact;
  fs.mkdirSync(path.dirname(FACTS), { recursive: true });
  fs.writeFileSync(FACTS, JSON.stringify(facts, null, 1));
  console.log(JSON.stringify({ ...fact, matches: picks.filter(Boolean).map(({ text, source, date, hour }) => ({ text, source, date, hour })) }, null, 1));
  process.exit(0);
}

const stats = computeStats(human);
// The first and last stretch of their history, a sixth of their prompts each, to see how their prompting changed.
const slice = Math.max(1, Math.floor(human.length / 6));
const output = {
  generatedAt: new Date().toISOString(),
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  userFirstName: firstName(),
  sources: {
    "claude-code": {
      prompts: stats.bySource["claude-code"] ?? 0,
      sessions: meta.claudeCode.sessions.size,
      models: topN(meta.claudeCode.models, 5),
      outputTokens: meta.claudeCode.outputTokens,
    },
    codex: { prompts: stats.bySource.codex ?? 0, sessions: meta.codex.sessions.size, models: topN(meta.codex.models, 5) },
    cursor: { prompts: stats.bySource.cursor ?? 0, sessions: meta.cursor.sessions.size, models: topN(meta.cursor.models, 5) },
  },
  ...stats,
  sample: voiceSample(human, SAMPLE_SIZE).filter(Boolean),
  shortSample: shortSample(human, 30).filter(Boolean),
  eras: human.length >= 60 ? { early: era(human.slice(0, slice)), recent: era(human.slice(-slice)) } : null,
  errors,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(output, null, 1));
fs.rmSync(FACTS, { force: true });
const kb = Math.round(fs.statSync(OUT).size / 1024);
console.log(
  `how-i-ai: ${human.length} prompts across ${stats.totals.sessions} sessions ` +
    `(claude-code ${output.sources["claude-code"].prompts}, codex ${output.sources.codex.prompts}, cursor ${output.sources.cursor.prompts}) ` +
    `in ${((Date.now() - started) / 1000).toFixed(1)}s`,
);
console.log(`wrote ${OUT} (${kb} KB)`);
if (errors.length) console.log(`warnings:\n  ${errors.join("\n  ")}`);
