# say-it-naturally

One skill for practising what you are about to say out loud: a meeting or stand-up update, a demo, an idea you must explain to a colleague. It makes your explanation sound natural in spoken English but keeps it in your own words. It adds no hooks or panels.

```
how do I say this naturally for tomorrow's stand-up: the deploy got delay because the cert expire, i renew already
does this sound ok said out loud? "the draft help the term adoption in every pair but not improve the fluency"
```

Claude starts it on its own when your request fits. You can also call it by name: `/say-it-naturally:say-it-naturally <your text>`.

## What you get back

| Part | What it is |
|---|---|
| Polished, in your words | your explanation with only what sounds wrong, unclear or unnatural changed; your terms and your order stay |
| Short version | one or two sentences for when time is tight |
| Wording fixes | your phrase → the fix, with the reason, so you can reuse it |
| Someone may ask | one or two questions the room may ask, with a line you could add |
| Check | only when a claim looks wrong or a key point is missing; never folded into your text |

It ends by inviting you to say it again. A retry reply starts with what improved since the last one.

- **It keeps your voice.** No new claims, examples or numbers, no corporate words, and no switch to another variety of English.
- **It is for speech.** Emails, posts, chat replies, translation and scripts written from a topic are left to other tools.

## Install

```
/plugin marketplace add richardmuucyi/rmahwj
/plugin install say-it-naturally@rmahwj
/reload-plugins
```

## What it needs and writes

- **Needs:** nothing beyond Claude Code. It has no scripts.
- **Writes:** nothing. It replies in the conversation and uploads nothing. When your explanation is about a file you point to, it may read that file to check a claim.

## Read this first

A skill runs with your permissions. Read `SKILL.md` before you install the plugin.

Developed on Windows 11 with Claude Code 2.1.327. Tested as an installed plugin on Windows; not yet tested on macOS or Linux.

## Tests

No automated tests ship with it. Before release it was run on three cases with and without the skill, and its description was checked by blind router judges against 20 requests (10 that should start it, 10 near-misses such as an email, a chat reply or a translation): 20 of 20.
