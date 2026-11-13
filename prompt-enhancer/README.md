# prompt-enhancer

Two skills that sharpen a request before any work starts. The `==` grammar check that was here until 0.16 is now its own mod, [`grammar-check`](../grammar-check).

| You type | What happens |
|---|---|
| `/prompt-enhancer:enhance <request>` | Claude asks about the gaps that would change the result, says what a top professional would add, then writes one deeper prompt and asks "Run it now?" |
| `/prompt-enhancer:goal-draft <request>` | Claude drafts a `/goal` condition with a turn cap, or a `/loop` command, ready to copy |

The two skills are user-invoked: Claude never starts them on its own, only when you type the name. Neither one searches your private notes (daily notes, journal, personal areas) for facts about you, your family, health, money or relationships: each asks you instead.

## `/prompt-enhancer:enhance`

1. **Gaps.** Up to four questions, multiple choice where it can, about what would change the result: the goal, the scope, the limits, how you will know it is done. It skips what you already said.
2. **Deeper.** Four short lines: what a top professional would do that you did not ask for (`pro`), the raw material they would start from (`raw`), the methods and tools by name (`methods`), and what other than you or Claude would show the result is right (`proof`). It names only paths and commands it has checked; anything else is marked "(unchecked)".
3. **One prompt.** Your request word for word, with the raw material, methods and proof added as steps. The same deliverable and about the same amount of work: no new reports, tables or extra outputs. It carries one "Done when:" line, a short task list with a check per task when the work has several steps, and a line that asks for each check's real output.
4. **Run it now?** Run it, edit it first, or stop.

Two words can go before the request, in either order:

- `panel` adds five experts from different fields, two of them critics, one line each with their methods. The prompt then carries a done-when test for each reader of the result, and asks for the checks to be run by a fresh subagent that has not seen the work.
- `grill` replaces the four-question limit with a full interview, round after round. A `ledger` block tracks each fact the result needs as settled, open or assumed, and the prompt is drafted only when nothing is open or you say go.

```
/prompt-enhancer:enhance panel grill write the onboarding guide for the billing service
```

## `/prompt-enhancer:goal-draft`

It reads your request as a goal ("keep working until X holds", or a one-off "check that X") or a loop ("every hour", "each time something appears"), then asks about each missing part, at most three rounds.

- **Goal:** one condition under 600 characters for a judge that runs nothing and reads only the chat. The end state is something command output shows, and it ends after K goal checks with a `GOAL CAPPED:` reply, so it can never run forever. Every reply ends `Goal turn N/K`.
- **Loop:** one `/loop` line under 600 characters, self-paced unless the work is on a clock, safe to repeat, with a stop condition and "never push, delete or send" unless you asked for it. Work that waits for a log line is pointed to a Monitor, and work that must run with the laptop off is pointed to `/schedule`.

Claude cannot type `/goal` or `/loop` for you: copy the block it gives and send it.

## Moving from 0.16

The `==` grammar check and `/grammar` left this plugin in 0.17.0. Install [`grammar-check`](../grammar-check) to keep them: `/plugin install grammar-check@rmahwj`.

## Moving from 0.13 or earlier

The `++` modes were removed from the mod in 0.14.0 and live in the skills now.

| Before | Now |
|---|---|
| `++`, `++deep` (`/clarify`, `/deepen`) | `/prompt-enhancer:enhance` |
| `++panel` (`/panel`) | `/prompt-enhancer:enhance panel` |
| `++!` and the other grill modes | add `grill` |
| `++goal`, `++loop` (`/goalify`, `/loopify`) | `/prompt-enhancer:goal-draft` |

The old card that counted the critic subagents after the work is gone with the modes.

## Install

```
/plugin marketplace add richardmuucyi/rmahwj
/plugin install prompt-enhancer@rmahwj
/reload-plugins
```

## Tests

The two skills are prompts with no tests of their own. The grammar check's tests moved with it to `grammar-check`.
