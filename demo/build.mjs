#!/usr/bin/env node
// Builds demo/index.html: Moby's real results poured into the current template.
// Edit skills/promptly/templates/promptly.html, run this, and open demo/index.html to see the change.
//
//   node demo/build.mjs [--mood mixed|warm|cool|electric] [--mode auto|light|dark] [--out file.html]
//   node demo/build.mjs --import ~/Desktop/promptly-2026.html    refresh demo/promptly.json from a rendered page first
//
// demo/promptly.json is a page's data block: aggregate stats and the persona, no raw prompts. Importing swaps
// project names (and skills named after projects) for symbols, as deploy.mjs does, because this repo is public.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/, "")] = argv[i + 1];

const here = path.dirname(fileURLToPath(import.meta.url));
const dataPath = path.join(here, "promptly.json");

if (args.import) {
  const html = fs.readFileSync(args.import.replace(/^~(?=\/)/, process.env.HOME), "utf8");
  const m = html.match(/<script id="promptly-data" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) {
    console.error(`${args.import} doesn't look like a Promptly page`);
    process.exit(1);
  }
  const GLYPHS = "!<>-_\\/[]{}=+*^?#%&@$~|:;░▒▓";
  const disguise = (s) => [...s].map((c, k) => (/\s/.test(c) ? c : GLYPHS[(c.charCodeAt(0) * 7 + k * 13) % GLYPHS.length])).join("");
  const page = JSON.parse(m[1]);
  // A published page is already disguised; disguising it again would scramble the symbols, not the names.
  if (!page.projectsHidden) {
    page.projectsHidden = true;
    page.stats.projects = (page.stats.projects ?? []).map((p) => ({ ...p, name: disguise(p.name) }));
    if (page.stats.skills) page.stats.skills.top = page.stats.skills.top.map((k) => (k.private ? { ...k, name: disguise(k.name) } : k));
  }
  fs.writeFileSync(dataPath, JSON.stringify(page, null, 2) + "\n");
  console.log(`updated ${dataPath}`);
}

const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
data.look = { ...data.look, ...(args.mood && { mood: args.mood }), ...(args.mode && { mode: args.mode }) };

const template = fs.readFileSync(path.join(here, "..", "skills", "promptly", "templates", "promptly.html"), "utf8");
const out = path.resolve(args.out ?? path.join(here, "index.html"));
fs.writeFileSync(out, template.replace("/*__PROMPTLY_DATA__*/", () => JSON.stringify(data).replace(/</g, "\\u003c")));
console.log(`wrote ${out} (${data.look.mood}, ${data.look.mode})`);
