#!/usr/bin/env node
// Builds demo/index.html: Moby's real results poured into the current template.
// Edit skills/promptly/templates/promptly.html, run this, and open demo/index.html to see the change.
//
//   node demo/build.mjs [--mood mixed|warm|cool|electric] [--mode auto|light|dark] [--out file.html]
//   node demo/build.mjs --import ~/Desktop/promptly-2026.html    refresh demo/promptly.json from a rendered page first
//   node demo/build.mjs --serve [port]    serve it at http://localhost:4174, rebuilt from the template on every refresh
//
// demo/promptly.json is a page's data block: aggregate stats and the persona, no raw prompts. Importing swaps
// project names (and skills named after projects) for symbols, as deploy.mjs does, because this repo is public.

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith("--")) args[argv[i].slice(2)] = argv[i + 1] === undefined || argv[i + 1].startsWith("--") ? true : argv[++i];
}

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

const template = path.join(here, "..", "skills", "promptly", "templates", "promptly.html");
function build() {
  const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  data.look = { ...data.look, ...(args.mood && { mood: args.mood }), ...(args.mode && { mode: args.mode }) };
  return { look: data.look, html: fs.readFileSync(template, "utf8").replace("/*__PROMPTLY_DATA__*/", () => JSON.stringify(data).replace(/</g, "\\u003c")) };
}

if ("serve" in args) {
  const port = typeof args.serve === "string" ? Number(args.serve) : 4174;
  http
    .createServer((req, res) => {
      if (req.url !== "/" && !req.url.startsWith("/?")) return res.writeHead(404).end();
      try {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(build().html);
      } catch (e) {
        res.writeHead(500, { "content-type": "text/plain" }).end(String(e.stack ?? e));
      }
    })
    .listen(port, () => console.log(`demo at http://localhost:${port}, refresh to pick up template changes`));
} else {
  const { look, html } = build();
  const out = path.resolve(args.out ?? path.join(here, "index.html"));
  fs.writeFileSync(out, html);
  console.log(`wrote ${out} (${look.mood}, ${look.mode})`);
}
