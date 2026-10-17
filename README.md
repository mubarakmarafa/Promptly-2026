<img src="assets/icon.svg" width="64" height="64" alt="">

# How I AI

Spotify Wrapped for your prompting. Run `/wrapped` in Claude Code or Codex and your own agent reads your local chat history, works out your prompting personality, and builds a story you can tap through and share.

It covers Claude Code, Codex and Cursor history together, so you also find out who you've been cheating on.

## Install

```bash
npx skills add mubarakmarafa/how-i-ai -g
```

Then open Claude Code and type `/wrapped`, or `$wrapped` in Codex. It takes about a minute, and your Wrapped opens when it's done.

This uses the open [skills](https://skills.sh) installer, which also works with Cursor, OpenCode and most other agents. It'll ask which ones to install for.

<details>
<summary>Other ways to install</summary>

**Ask your agent.** Paste this into Claude Code or Codex:

```
Install the wrapped skill from https://github.com/mubarakmarafa/how-i-ai into my user skills folder, then run it.
```

**Shell script** (Claude Code and Codex, no npm):

```bash
curl -fsSL https://raw.githubusercontent.com/mubarakmarafa/how-i-ai/main/install.sh | bash
```

**Claude Code plugin.** The command is namespaced as `/how-i-ai:wrapped`:

```
/plugin marketplace add mubarakmarafa/how-i-ai
/plugin install how-i-ai@how-i-ai
```

</details>

Requires Node 18+, and Node 22.5+ to include Cursor history.

## How it works

1. `scripts/extract.mjs` reads your history locally and computes the stats: when you prompt, how long your prompts are, your catchphrases, your manners, your top projects. It redacts secrets, emails and paths, then saves the stats plus a small sample of prompts to a temp file. It takes a few seconds and has no dependencies.
2. Your agent reads that file and writes your personality: an archetype, captions, a roast, and three greatest-hits quotes.
3. `scripts/render.mjs` puts it all into a single HTML file on your Desktop. The last slide saves a share image.

## Privacy

- Nothing leaves your machine except what your own agent already sends to its model: the stats and a sample of about 150 redacted prompts.
- The HTML page contains only aggregate stats and the quotes you approve. The raw sample stays in your temp folder.
- Your agent asks before anything goes on the page that you might not want to share. Pass `--hide-projects` to `render.mjs` to leave out project names.

## Where it looks

| Tool | Location |
|---|---|
| Claude Code | `~/.claude/projects/**/*.jsonl` |
| Codex | `~/.codex/sessions/**/*.jsonl` |
| Cursor | `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb` (needs Node 22.5+) |

Subagent conversations, automations, tool output and harness messages are filtered out, so the stats reflect what you typed.
