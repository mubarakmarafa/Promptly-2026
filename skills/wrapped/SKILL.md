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

### 0. Ask a few questions first

Start like a personality quiz: a quick, playful warm-up before the results. Ask everything in one go, never one question per turn. If your harness has a structured question tool (Claude Code's AskUserQuestion, for example), use it. Otherwise ask in one short message with the options listed.

1. **What should we call you?** Suggest their first name from `git config --global user.name` if it looks like a real name. Free text is fine.
2. **What do you do?** Offer Designer, Engineer, Product / PM, and Founder, plus free text. This shapes the archetype and the jokes.
3. **Pick your colours.** The design is always the same; this sets the palettes behind each slide. Maps to `look.mood`:
   - Warm: sunset pinks, oranges and golds (`warm`)
   - Cool: mint, sky, lilac and deep blue (`cool`)
   - Electric: hot, saturated colour with thermal bands (`electric`)
   - A bit of everything: a different palette on every slide (`mixed`, the default)
4. **Light or dark?** Light paper (default) or dark. Maps to `look.mode`: `light` or `dark`.

Only these preferences change. The layout, type and visuals stay the same for everyone.

The roast is medium by default. If the user asks for gentle or extra spicy when invoking you, use that.

The time range defaults to all time. If the user mentions one ("this year", "last 90 days"), pass `--days` to the extractor: days since 1 January for this year, or the number they gave.

Skip any question the user already answered when invoking you (for example `/wrapped call me Sam, designer, cool, dark, extra spicy`). If you can't ask, for example in a non-interactive run, use the defaults: their git first name, no role, mixed colours, light, medium roast. Don't stall waiting for an answer.

While you wait for answers, don't read any history.

### 1. Extract

```bash
node scripts/extract.mjs
```

This takes a few seconds and prints the path of the JSON it wrote. Options: `--days 365` limits the time range; `--out <path>` changes the location. Node 22.5+ is needed for Cursor support. On older Node, Cursor is skipped and the rest still works.

If it reports 0 prompts, tell the user which tools are supported (Claude Code, Codex, Cursor) and stop.

### 2. Read the data

Read the JSON file. Key fields:

- `totals`, `sources`, `time`, `style`, `phrases`, `projects`: aggregate stats. These are their **habits**.
- `sample`: about 120 redacted prompts spread across time, chosen because the person explains, reacts, has an opinion or describes what they want. This is your main material for their **personality**.
- `shortSample`: 30 short prompts and commands. Useful for quotes and the roast, not for personality.
- `moments`: the longest prompt, the latest-night prompt, the first prompt, the angriest and the politest.
- `userFirstName`: the user's first name if the machine knows it. Use it for `name` only if they didn't answer question 1.

Read the whole `sample` before writing anything.

### 3. Write the persona

There are two layers, and they come from different evidence:

- **Habits:** what they do a lot. Frequent phrases, commands, hours, streaks. This feeds the captions, the roast and the quotes. "You asked for a server restart 40 times" is a great roast line.
- **Personality:** who they are when they write. This feeds the archetype and the traits. It comes from *how* they say things, not *how often*.

#### 3a. Profile first, in your head

Before you name anything, answer these from the `sample`, each with two or three prompts as evidence. Don't output this; it's your working.

1. **What do they notice and care about?** Feel and polish, speed, users, correctness, the big idea, how things look, whether it's fun?
2. **How do they treat the agent?** Collaborator, boss, teacher, cheerleader, sparring partner? Do they explain why, or just say what?
3. **How do they handle problems and uncertainty?** Curious, calm, impatient, self-deprecating, dramatic? What happens to their tone when something breaks, and when it finally works?
4. **How do they sound?** Warmth, humour, hedging ("maybe", "I wonder"), confidence, punctuation, slang.

#### 3b. Then name it

The archetype comes from the profile. Rules:

- **Never build it from a repeated command or phrase.** If they say "restart the server" constantly, that belongs in the roast, not in their name. Test: would the archetype still be true if they had never typed their single most common command or phrase?
- **A friend should recognise them.** It should describe a disposition someone who knows them would nod at, like "The Hype-Man Art Director" (generous praise plus an exacting eye) or "The Patient Professor" (explains the why, never loses their cool).
- **Specific, not generic.** "The Efficient Coder" or "The Innovator" could be anyone: start again.
- **No made-up numbers.** Only quote figures that are in the stats. "Half your messages start with…" is a guess unless the data says so; describe the habit without inventing a count.
- **Stable.** Run it twice on the same person and you should land on the same idea. Lean on the traits that show up across the whole time range, not in one week.

Write `persona.json` in the same directory as the data file:

```json
{
  "name": "What they asked to be called, or null",
  "role": "Their job in a few lowercase words, e.g. product designer, or null",
  "look": { "mood": "mixed | warm | cool | electric", "mode": "light | dark" },
  "archetype": {
    "name": "The ___ ___ (2-4 words)",
    "tagline": "A short line in their voice that captures their disposition",
    "description": "2-3 sentences about who they are as a prompter, with specific evidence of how they write. Not a list of stats."
  },
  "captions": {
    "intro": "...", "numbers": "...", "tools": "...", "clock": "...", "rhythm": "...",
    "style": "...", "phrases": "...", "manners": "...", "projects": "..."
  },
  "quotes": [
    { "title": "2-3 word label", "text": "verbatim prompt, trimmed if needed", "meta": "Tool · Month, time", "caption": "your one-line reaction" }
  ],
  "traits": [
    { "left": "Collaborator", "right": "Commander", "value": 0, "note": "one line of evidence" }
  ],
  "roast": "2-3 sentences",
  "compliment": "1-2 sentences",
  "prediction": "One line about their next year of prompting"
}
```

What makes it good:

- **Use their answers.** Write for their role. A designer's archetype and roast can riff on pixels and feedback rounds; an engineer's on yak-shaving and "works on my machine"; a PM's on specs and stakeholder updates. Only lean on the role where the data backs it up. Match the roast level: gentle is a warm tease, medium is a friend's honest roast, extra spicy pulls no punches but stays affectionate and within the rules below.
- **Traits:** exactly these 4 personality sliders, in this order, so results are comparable between people. `value` runs 0-100: 0 is fully `left`, 100 is fully `right`. Score them from the profile, not from counts, and make sure the archetype agrees with them.
  1. Collaborator / Commander: do they talk with the agent or give it orders?
  2. Feel / Function: do they care more about how it feels or whether it works?
  3. Explorer / Executor: do they wander into new ideas or drive the plan to done?
  4. Steady / Fired up: is their tone even, or does it swing with every win and bug?
- **Captions:** one or two sentences each, under 30 words. Each one should react to that slide's stat with a joke or an observation, not repeat the number. This is where habits shine. Every caption is optional; leave one out and the template uses a generic line. Slides: `numbers` = total prompts and words, `tools` = split between agents, `clock` = hour of day, `rhythm` = streak and busiest day, `style` = prompt length, `phrases` = catchphrases, `manners` = please, thanks and frustration, `projects` = top projects.
- **Quotes:** exactly 3, from `sample`, `shortSample` or `moments`. Pick ones that are funny or revealing out of context and short (under 30 words). Keep the user's spelling and casing; it's part of the charm. Aim for at least one that shows their personality, not just a habit.
- **Roast:** affectionate, like a friend who's read all their messages. Habits are fair game here. Tease prompting habits only: never appearance, identity, intelligence or anything sensitive. Base it on real evidence.
- **Compliment:** sincere and specific, about who they are as a collaborator.
- **Tone:** playful and warm. No corporate words ("leverage", "journey", "landscape"). Write like a person, not a chatbot.

### 4. Render

```bash
node scripts/render.mjs --data <data.json> --persona <persona.json>
```

The colours come from `look` in `persona.json`. `--mood` and `--mode` override it, which is handy if the user wants to try another palette.

This writes `~/Desktop/how-i-ai-wrapped.html` by default. Use `--out <path>` to change it. If the sandbox blocks the Desktop, write to the current directory. `--hide-projects` drops the projects slide. The page contains only aggregate stats and your persona, never the raw sample.

Then open it: `open <path>` on macOS, `xdg-open` on Linux.

### 5. Hand it over

Tell the user, briefly:

- Where the file is, and that they tap or use the arrow keys to move through it. The last slide has a "Save image" button for sharing.
- Their archetype name, to tease the reveal without spoiling the whole thing.
- The 3 quotes and the top project names that appear in the page. Ask if they want any swapped out, the projects hidden, or different colours before sharing. If they do, edit `persona.json` (or pass `--mood` / `--mode`) and re-render; don't re-run the extractor.
