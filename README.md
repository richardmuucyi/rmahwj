# rmahwj

Six small [Claude Code](https://claude.com/claude-code) mods, five by Richard Mah and one by Thariq Shihipar, plus six plugins of skills and one theme pack. A mod changes how Claude Code looks or behaves: a strip above the prompt, a panel, a slash command, a hook on your prompts. A skill is a set of steps and scripts Claude follows when your request fits it.

| Mod | What it does |
|---|---|
| [`assumptions`](assumptions) | Claude logs each assumption it makes. You review them in a panel, mark them right or wrong, and send a correction mid-task. |
| [`grammar-check`](grammar-check) | Type `== <text>` or `/grammar <text>` and one small Haiku call checks only your grammar. The corrected text goes into an empty prompt box, with what changed shown beside it. Your text is never sent to Claude. |
| [`image-open`](image-open) | Paste an image with Alt+V and an `[open]` button appears above the prompt. It opens the full-size picture in your default viewer. Windows only. |
| [`next-steps`](next-steps) | After each turn, up to three likely next prompts appear above the prompt. Press 1, 2 or 3 to put one in the prompt box as a draft, or 0 to dismiss. It makes one extra model call after each turn. By Thariq Shihipar, copied unchanged from [claude-plugins-community](https://github.com/anthropics/claude-plugins-community/tree/main/next-steps) under the MIT licence ([notice](next-steps/THIRD-PARTY-NOTICES.md)). |
| [`session-board`](session-board) | A strip above the prompt that shows other sessions that need you, plus a `/sessions` view and a context-size guard. |
| [`usage-gauge`](usage-gauge) | Two rows under the prompt: model, cost, tokens, context and your 5-hour and weekly limits. |

| Skills | What they do |
|---|---|
| [`diagram-skills`](diagram-skills) | Three skills: `d2-diagram` draws D2 diagrams and checks the render, `mermaid-visual-review` reviews and polishes mermaid diagrams, `svg-smith` makes and repairs SVG logos, icons and badges. They need tools such as d2, Node.js or Python packages; see its README. |
| [`html-artefact`](html-artefact) | One skill you call by name: `/html-artefact:html-artefact <job>` builds a single-file HTML page for a thinking job, such as a comparison, a plan, a code review, an editor or a status report, from 24 recipes, then audits it. |
| [`prompt-enhancer`](prompt-enhancer) | Two skills you call by name: `/prompt-enhancer:enhance <request>` asks about the gaps that change the result and writes one deeper prompt (add `panel` for five experts, `grill` for a full interview), and `/prompt-enhancer:goal-draft <request>` drafts a `/goal` or `/loop`. |
| [`say-it-naturally`](say-it-naturally) | One skill that starts on its own when you paste what you are about to say out loud and ask how to say it naturally. It keeps your own words, fixes what sounds wrong and says why, adds the questions the room may ask, then invites you to try again. |
| [`skill-authoring`](skill-authoring) | Three skills for skills: `ebook-to-skill` turns an EPUB into a skill or audits a skill's structure, `skill-uplift` researches current best practice and proposes verified improvements to one of your skills, `self-improving-skills` lets a skill learn from its runs behind six gates. |
| [`tutor`](tutor) | One skill you call by name: `/tutor:tutor` quizzes you on material you have studied, one question at a time, or has you explain it back Feynman-style, and only calls you done after a fresh verification round. |

| Themes | What they do |
|---|---|
| [`all-themes`](all-themes) | 54 Claude Code UI themes for `/theme`, from 13 public palettes (Catppuccin, Dracula, Nord, Tokyo Night and more), each with an ANSI variant. Plus matching Windows Terminal colour schemes. JSON colour files plus `gen_themes.py`, the script that builds them; nothing runs when you install it. |

## Install

Add the marketplace, then install the mods you want:

```
/plugin marketplace add richardmuucyi/rmahwj
/plugin install assumptions@rmahwj
/reload-plugins
```

Replace `assumptions` with any name in the table. Add the marketplace as `owner/repo`, not as a raw URL.

To get new versions later:

```
/plugin marketplace update rmahwj
```

Auto-update is off by default for marketplaces you did not create. Each mod has a `version` in its `plugin.json`, and an update reaches you only when that number goes up.

## Read this first

A mod runs code inside your Claude Code session, with your permissions. Read a mod's `hooks/` folder before you install it. The code is plain TypeScript, with no build step and no network calls of its own.

The skills in `diagram-skills`, `html-artefact` and `skill-authoring` run Python, Node.js and shell scripts, also with your permissions. Read a skill's `SKILL.md` and `scripts/` before you install it.

Developed and tested on Windows 11 with Claude Code 2.1.299. Not tried on macOS or Linux yet.

## Tests

Each mod has a `tests/` folder (the `all-themes` pack has none: it has no hooks). Run one with:

```
claude plugin test <mod-folder>
```

The tests import `claude-code/testing`, so they only run inside Claude Code. The skills' tests are plain Python; the READMEs of [`diagram-skills`](diagram-skills), [`html-artefact`](html-artefact), [`skill-authoring`](skill-authoring) and [`tutor`](tutor) list them.

## Licence

[MIT](LICENSE).
