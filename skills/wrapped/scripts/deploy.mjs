#!/usr/bin/env node
// Publishes the wrapped page to a host the user is already logged in to.
// Usage:
//   node deploy.mjs --detect                         which hosts are installed and logged in
//   node deploy.mjs --to vercel [--file page.html]   publish (vercel | netlify | cloudflare | github)
//   add --preview for a Vercel or Netlify preview URL instead of production, --name to change the site name
//
// Before anything leaves the machine, repo names in the page's data are swapped for symbols, the same way the embed
// does it, so a public page never carries them.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith("--")) args[argv[i].slice(2)] = argv[i + 1]?.startsWith("--") || argv[i + 1] === undefined ? true : argv[++i];
}
const file = args.file ?? path.join(os.homedir(), "Desktop", "how-i-ai-wrapped.html");
const name = String(args.name ?? "how-i-ai-wrapped").toLowerCase().replace(/[^a-z0-9-]/g, "-");

const run = (cmd, cmdArgs, opts = {}) => {
  const r = spawnSync(cmd, cmdArgs, { encoding: "utf8", timeout: opts.timeout ?? 15000, cwd: opts.cwd, stdio: opts.inherit ? ["inherit", "pipe", "pipe"] : "pipe" });
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
};
const has = (cmd) => run("which", [cmd]).ok;
// Vercel is often run through npx rather than installed.
const vc = (a, opts) => (has("vercel") ? run("vercel", a, opts) : run("npx", ["--yes", "vercel", ...a], { timeout: 60000, ...opts }));

// Each host: how to tell it's ready, and how to publish a folder holding index.html.
const HOSTS = {
  vercel: {
    ready: () => (has("vercel") || has("npx")) && vc(["whoami"]).ok,
    account: () => vc(["whoami"]).out.split("\n").map((l) => l.trim()).filter((l) => /^[\w.@-]+$/.test(l)).at(-1) ?? "",
    deploy: (dir) => vc(["deploy", dir, "--yes", ...(args.preview ? [] : ["--prod"])], { timeout: 180000 }),
  },
  netlify: {
    ready: () => has("netlify") && run("netlify", ["status"]).ok,
    account: () => (run("netlify", ["status"]).out.match(/Email:\s*(\S+)/) ?? [])[1] ?? "",
    deploy: (dir) => run("netlify", ["deploy", "--dir", dir, "--create-site", name, ...(args.preview ? [] : ["--prod"])], { timeout: 180000 }),
  },
  cloudflare: {
    ready: () => has("wrangler") && run("wrangler", ["whoami"]).ok,
    account: () => (run("wrangler", ["whoami"]).out.match(/associated with the email (\S+)/) ?? [])[1] ?? "",
    deploy: (dir) => {
      // Creating a project that already exists fails harmlessly.
      run("wrangler", ["pages", "project", "create", name, "--production-branch", "main"], { timeout: 60000 });
      return run("wrangler", ["pages", "deploy", dir, "--project-name", name, "--branch", "main"], { timeout: 180000 });
    },
  },
  github: {
    ready: () => has("gh") && has("git") && run("gh", ["auth", "status"]).ok,
    account: () => run("gh", ["api", "user", "--jq", ".login"]).out,
    deploy: (dir) => {
      const login = run("gh", ["api", "user", "--jq", ".login"]).out;
      const steps = [
        ["git", ["init", "-q", "-b", "main"]],
        ["git", ["add", "index.html"]],
        ["git", ["-c", "user.name=how-i-ai", "-c", "user.email=how-i-ai@users.noreply.github.com", "commit", "-q", "-m", "Publish How I AI Wrapped"]],
      ];
      for (const [c, a] of steps) { const r = run(c, a, { cwd: dir }); if (!r.ok) return r; }
      // A repo of this name from an earlier deploy gets the new page pushed over it.
      const exists = run("gh", ["repo", "view", `${login}/${name}`]).ok;
      const push = exists
        ? (run("git", ["remote", "add", "origin", `https://github.com/${login}/${name}.git`], { cwd: dir }), run("git", ["push", "-f", "-q", "origin", "main"], { cwd: dir, timeout: 120000 }))
        : run("gh", ["repo", "create", name, "--public", "--source", dir, "--push"], { cwd: dir, timeout: 120000 });
      if (!push.ok) return push;
      run("gh", ["api", "-X", "POST", `repos/${login}/${name}/pages`, "-f", "source[branch]=main", "-f", "source[path]=/"]);
      return { ok: true, out: `https://${login}.github.io/${name}/ (GitHub Pages can take a minute to go live)` };
    },
  },
};

if (args.detect) {
  const found = Object.entries(HOSTS).map(([k, h]) => ({ host: k, ready: h.ready() })).map((x) => ({ ...x, account: x.ready ? HOSTS[x.host].account() : null }));
  console.log(JSON.stringify(found, null, 1));
  process.exit(0);
}

const host = HOSTS[args.to];
if (!host) {
  console.error(`--to must be one of: ${Object.keys(HOSTS).join(", ")}`);
  process.exit(1);
}
if (!host.ready()) {
  console.error(`${args.to} isn't installed or logged in on this machine`);
  process.exit(1);
}

// Swap repo names for symbols in the page's data.
const GLYPHS = "!<>-_\\/[]{}=+*^?#%&@$~|:;░▒▓";
const disguise = (s) => [...s].map((c, k) => (/\s/.test(c) ? c : GLYPHS[(c.charCodeAt(0) * 7 + k * 13) % GLYPHS.length])).join("");
const html = fs.readFileSync(file, "utf8");
const DATA = /(<script id="wrapped-data" type="application\/json">)([\s\S]*?)(<\/script>)/;
const m = html.match(DATA);
if (!m) {
  console.error(`${file} doesn't look like a How I AI page`);
  process.exit(1);
}
const data = JSON.parse(m[2]);
data.projectsHidden = true;
data.stats.projects = (data.stats.projects ?? []).map((p) => ({ ...p, name: disguise(p.name) }));
const json = JSON.stringify(data).replace(/</g, "\\u003c");

const dir = path.join(os.tmpdir(), "how-i-ai-deploy", name);
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "index.html"), html.replace(DATA, (_, a, __, b) => a + json + b));

const r = host.deploy(dir);
if (!r.ok) {
  console.error(`deploy failed:\n${r.out}`);
  process.exit(1);
}
// Hosts print several URLs; the last one is the address to share (the production alias where there is one).
const urls = r.out.match(/https:\/\/[^\s"'<>)]+/g) ?? [];
console.log(urls.at(-1) ?? r.out);
