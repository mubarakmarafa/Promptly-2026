#!/usr/bin/env node
// Merges extracted stats with the agent-written persona into a self-contained HTML page.
// Usage: node render.mjs --data wrapped-data.json --persona persona.json [--mood mixed|warm|cool|electric] [--mode auto|light|dark] [--out file.html] [--hide-projects]

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
const dataPath = args.data ?? path.join(os.tmpdir(), "how-i-ai", "wrapped-data.json");
const personaPath = args.persona ?? path.join(os.tmpdir(), "how-i-ai", "persona.json");
const out = args.out ?? path.join(os.homedir(), "Desktop", "how-i-ai-wrapped.html");

const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const persona = JSON.parse(fs.readFileSync(personaPath, "utf8"));

const problems = [];
if (!persona.archetype?.name) problems.push("archetype.name is required");
if (!persona.archetype?.tagline) problems.push("archetype.tagline is required");
if (!persona.roast) problems.push("roast is required");
if (!Array.isArray(persona.traits) || persona.traits.length < 3) problems.push("traits needs 3-4 entries");
if (!Array.isArray(persona.quotes) || persona.quotes.length < 1) problems.push("quotes needs 1-3 entries");
if (problems.length) {
  console.error(`persona.json is incomplete:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}

// Only aggregate stats and the quotes the agent chose go into the page.
// The raw prompt sample and auto-picked moments stay on disk.
const { sample, shortSample, moments, errors, userFirstName, ...stats } = data;
if (args["hide-projects"]) stats.projects = [];

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
const template = fs.readFileSync(path.join(here, "..", "templates", "wrapped.html"), "utf8");
const json = JSON.stringify(payload).replace(/</g, "\\u003c");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, template.replace("/*__WRAPPED_DATA__*/", () => json));
console.log(`wrote ${out} (${look.mood}, ${look.mode})`);
