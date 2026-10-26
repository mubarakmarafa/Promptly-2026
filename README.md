<img src="assets/icon.svg" width="64" height="64" alt="">

# Promptly 2026

By [Moby](https://www.callmemoby.design/) and [Chelsea](https://chelsealuna.com/).

Spotify Wrapped for your prompting. Run `/promptly` in Claude Code or Codex and your own agent reads your local chat history, works out your prompting personality, and builds a story you can tap through and share.

It covers Claude Code, Codex and Cursor history together, so you also find out who you've been cheating on.

## Install

```bash
npx skills add mubarakmarafa/Promptly-2026 -g
```

Then open Claude Code and type `/promptly`, or `$promptly` in Codex. It takes about a minute, and your story opens when it's done.

This uses the open [skills](https://skills.sh) installer, which also works with Cursor, OpenCode and most other agents. It'll ask which ones to install for.

<details>
<summary>Other ways to install</summary>

**Ask your agent.** Paste this into Claude Code or Codex:

```
Install the promptly skill from https://github.com/mubarakmarafa/Promptly-2026 into my user skills folder, then run it.
```

**Shell script** (Claude Code and Codex, no npm):

```bash
curl -fsSL https://raw.githubusercontent.com/mubarakmarafa/Promptly-2026/main/install.sh | bash
```

**Claude Code plugin.** The command is namespaced as `/promptly:promptly`:

```
/plugin marketplace add mubarakmarafa/Promptly-2026
/plugin install promptly@promptly
```

</details>

Requires Node 18+, and Node 22.5+ to include Cursor history.

## How it works

1. `scripts/extract.mjs` reads your history locally and computes the stats: when you prompt, how long your prompts are, your catchphrases, your manners, your top projects. It redacts secrets, emails and paths, then saves the stats plus a small sample of prompts to a temp file. It takes a few seconds and has no dependencies.
2. Your agent reads that file, runs a few more queries against your history to check its hunches, and writes your personality: an archetype, three tells (what your writing gives away), captions, three greatest-hits quotes, a few receipts (prompts of yours marked up like a design crit, with a verdict), a read on how your prompting changed from your first months to now, and a judgement-day verdict on whether the machines will spare you. Every number in its writing is filled in by the scripts from your real data; the page won't render if the agent made one up.
3. `scripts/render.mjs` puts it all into a single HTML file on your Desktop: a live colour field that morphs between slides, with your stats drawn as pictures (your agents over time, a thermal clock, a calendar of every day you showed up, the skills you call versus the ones your agent picks, a trait fingerprint), plus a few of your own prompts marked up and roasted. Pinch any slide to zoom into its chart's small print and drag it around, while the slide's words and card stay put (on a computer, pinch the trackpad or ctrl-scroll); a tap zooms back out, and sharing or saving keeps the framing you chose. On a phone, tilting it slides the colours under the words. Every slide has buttons to share or save it as an image, copy an embed snippet for a portfolio, show just the picture, switch between light and dark, or start again; tap the progress bar to jump to any slide. If you have Vercel, Netlify, Cloudflare or the GitHub CLI logged in, the agent offers to publish it there once you're happy, and only does it when you say so.

Before it starts, it asks what to call you, what you do, and which colours you like (warm, cool, electric or a mix). Light and dark mode follow your device until you switch them on the page. Your personality type comes from how you write (what you care about, how you treat your agents, how you handle bugs), not from the commands you repeat most.

## Privacy

- Nothing leaves your machine except what your own agent already sends to its model: the stats, a sample of redacted prompts (about 200, including the early and recent ones it compares), and the redacted examples from any queries it runs. Publishing, below, is the one exception, and only when you ask.
- The HTML page contains only aggregate stats and the quotes you approve. The raw sample stays in your temp folder.
- The page loads its fonts from Google Fonts. Sharing or saving a slide also downloads a small screenshot library (modern-screenshot, from jsDelivr) to capture that slide; the capture happens in your browser and nothing is uploaded. Repo names show as symbols until you tap one, and screenshots, embeds and published pages always keep them hidden. Apart from that, the embed snippet carries the whole page, so anything on it goes wherever you paste it.
- Publishing is opt-in: nothing goes online unless you tell the agent to, and it uses your own Vercel, Netlify, Cloudflare or GitHub account. A published page is public to anyone with the link.
- Your agent asks before anything goes on the page that you might not want to share. Pass `--hide-projects` to `render.mjs` to leave out project names, or `--hide-skills` to leave out the skills you use. A skill named after one of your projects is hidden like a project name.

## Where it looks

| Tool | Location |
|---|---|
| Claude Code | `~/.claude/projects/**/*.jsonl` |
| Codex | `~/.codex/sessions/**/*.jsonl` |
| Cursor | `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb` (needs Node 22.5+) |

Subagent conversations, automations, tool output and harness messages are filtered out, so the stats reflect what you typed.
