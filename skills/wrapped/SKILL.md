---
name: wrapped
description: Turn the user's local AI chat history (Claude Code, Codex, Cursor) into a Spotify Wrapped-style page about their prompting personality. Use when the user says /wrapped, asks for their "AI wrapped", "prompting wrapped", "how I AI", or wants a fun summary of how they talk to their agents.
---

# How I AI · Wrapped

You're making the user a shareable, Spotify Wrapped-style story about how they prompt. A script does the counting; your job is the personality: the archetype, captions, roast and quote picks. That's what makes it fun, so put real effort into it.

The scripts are in `scripts/`, next to this file. Resolve paths relative to this file's directory.

## Privacy rules

Follow these the whole way through. The user's history contains work code, secrets and private conversations.

- Everything stays on this machine. Don't upload, fetch or send the data anywhere.
- Don't explore the history directories yourself. They can be gigabytes and contain secrets. Use only the extractor's output.
- Don't paste raw prompts into the chat, apart from the 3 quotes you pick.
- Quotes must be safe to post publicly. Skip anything with colleague or customer names, company secrets, unreleased product details, credentials, URLs, health or relationship content, or anything the user might regret sharing. If in doubt, pick a different one.

## Steps

### 1. Extract

```bash
node scripts/extract.mjs
```

This takes a few seconds and prints the path of the JSON it wrote. Options: `--days 365` limits the time range; `--out <path>` changes the location. Node 22.5+ is needed for Cursor support. On older Node, Cursor is skipped and the rest still works.

If it reports 0 prompts, tell the user which tools are supported (Claude Code, Codex, Cursor) and stop.

### 2. Read the data

Read the JSON file. Key fields:

- `totals`, `sources`, `time`, `style`, `phrases`, `projects`: aggregate stats.
- `moments`: the longest prompt, the latest-night prompt, the first prompt, the angriest and the politest.
- `userFirstName`: the user's first name if the machine knows it, otherwise null. Use it for `name` in the persona.
- `sample`: about 150 redacted prompts spread across time. This is your main material for understanding the person.

Read the whole sample. Look for:

- Verbal tics: "okay so", "hmm", "nice nice", "yo".
- How they react when things break, and when things work.
- Whether they plan or improvise, and whether they explain context or fire one-liners.
- What they keep asking for again and again.
- Their punctuation habits.

The stats tell you *what*; the sample tells you *who*.

### 3. Write the persona

Write `persona.json` in the same directory as the data file:

```json
{
  "name": "First name, or null if unknown",
  "archetype": {
    "name": "The ___ ___ (2-4 words)",
    "tagline": "A short line in their voice, ideally a paraphrase of something they actually say",
    "description": "2-3 sentences explaining the archetype with specific evidence"
  },
  "captions": {
    "intro": "...", "numbers": "...", "tools": "...", "clock": "...", "rhythm": "...",
    "style": "...", "phrases": "...", "manners": "...", "projects": "..."
  },
  "quotes": [
    { "title": "2-3 word label", "text": "verbatim prompt, trimmed if needed", "meta": "Tool · Month, time", "caption": "your one-line reaction" }
  ],
  "traits": [
    { "left": "Polite", "right": "Blunt", "value": 0, "note": "one line of evidence" }
  ],
  "roast": "2-3 sentences",
  "compliment": "1-2 sentences",
  "prediction": "One line about their next year of prompting"
}
```

What makes it good:

- **Archetype:** specific and funny, built on their two or three most distinctive traits. "The Hype-Man Art Director" or "The 2am Refactorer" work. "The Efficient Coder" or "The Innovator" don't: if it could describe anyone, start again.
- **Captions:** one or two sentences each, under 30 words. Each one should react to that slide's stat with a joke or an observation, not repeat the number. Every caption is optional; leave one out and the template uses a generic line. Slides: `numbers` = total prompts and words, `tools` = split between agents, `clock` = hour of day, `rhythm` = streak and busiest day, `style` = prompt length, `phrases` = catchphrases, `manners` = please, thanks and frustration, `projects` = top projects.
- **Quotes:** exactly 3, from `sample` or `moments`. Pick ones that are funny or revealing out of context and short (under 30 words). Keep the user's spelling and casing; it's part of the charm.
- **Traits:** exactly 4 sliders. `value` runs 0-100: 0 is fully `left`, 100 is fully `right`. Base them on the stats. Good axes: Polite/Blunt, Planner/Vibes, Telegram/Novelist, Chill/Hyped, Night owl/Early bird, Delegator/Micromanager, Patient/Impatient. Pick the 4 that say the most about this person.
- **Roast:** affectionate, like a friend who's read all their messages. Tease prompting habits only: never appearance, identity, intelligence or anything sensitive. Base it on real evidence.
- **Compliment:** sincere and specific.
- **Tone:** playful and warm. No corporate words ("leverage", "journey", "landscape"). Write like a person, not a chatbot.

### 4. Render

```bash
node scripts/render.mjs --data <data.json> --persona <persona.json>
```

This writes `~/Desktop/how-i-ai-wrapped.html` by default. Use `--out <path>` to change it. If the sandbox blocks the Desktop, write to the current directory. `--hide-projects` drops the projects slide. The page contains only aggregate stats and your persona, never the raw sample.

Then open it: `open <path>` on macOS, `xdg-open` on Linux.

### 5. Hand it over

Tell the user, briefly:

- Where the file is, and that they tap or use the arrow keys to move through it. The last slide has a "Save image" button for sharing.
- Their archetype name, to tease the reveal without spoiling the whole thing.
- The 3 quotes and the top project names that appear in the page. Ask if they want any swapped out, or the projects hidden, before sharing. If they do, edit `persona.json` and re-render; don't re-run the extractor.
