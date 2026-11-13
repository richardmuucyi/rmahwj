# grammar-check

Type `== <text>` or `/grammar <text>` and the mod checks only your grammar before you send. The corrected text goes into an empty prompt box, with what changed shown beside it. Your text is never sent to Claude.

How it works: one small Haiku call (about 1.4K tokens) returns the corrected text and a list of changes. Fixes are applied to the text. Optional improvements are shown as tips and are not applied. Code, file paths, commands, names, IDs, URLs and non-English words stay exactly as you wrote them.

Switch it off in `/config` (the option "Grammar check (== and /grammar)"). When it is off, `==` is sent to Claude as you typed it and the mod makes no model call at all.

This check was part of `prompt-enhancer` until its 0.17.0. If you used `==` there, install this mod to keep it.

## Install

```
/plugin marketplace add richardmuucyi/rmahwj
/plugin install grammar-check@rmahwj
/reload-plugins
```

## Tests

```
claude plugin test grammar-check
```
