---
name: goal-draft
description: "Draft a /goal condition or a /loop command from my request, with the measured goal-cap and loop rules, ready to copy. User-invoked only: /goal-draft <request>. Moved from the prompt-enhancer mod's ++goal and ++loop (2026-10-31). NOT for doing the work, and NOT for a one-off prompt (/enhance)."
disable-model-invocation: true
argument-hint: "<what should keep running, or be done when>"
---

# Goal draft

My request: $ARGUMENTS

If my request is to do something again and again (every hour, daily, or each time something appears), follow **Loop**. If it is to keep working until something holds, follow **Goal**; a one-off "check that X" is a goal. Do not search my private notes (daily notes, journal, personal areas) for facts about me, my family, health, money or relationships: ask me instead.

In **Loop** only, first list the user-only skills (`grep -l "disable-model-invocation: true" .claude/skills/*/SKILL.md ~/.claude/skills/*/SKILL.md`, from the project root): Claude cannot call them, and a loop pass gets them as plain text.

## Goal

Help me turn my request above into a /goal condition. Do not start the work.
1. Guide me through it: I may be new to /goal. Its required parts are: the end state, the check that proves it, what must not break, and K, how many "Stop hook feedback" messages (goal checks) to allow before it stops. For each part my request does not already make clear, ask me with AskUserQuestion (at most 4 questions per round). Make every option a concrete, ready-to-use value with one short line on what it means; put the one you recommend first, marked (Recommended). If my answers leave a part open or raise a new gap, ask another round. Keep asking until every required part is clear, with no limit on rounds; stop early only when I say go or enough, then pick the safest choice for each open part and name it in your reply. Do not draft until every required part is settled. Among your questions, offer to run the check once now to see it fail; recommend that only when it is local, writes nothing and takes under 30 seconds.
2. Then write ONE condition, under 600 characters. Its judge is a small model that runs nothing and reads only this conversation (in a long one, only the newest messages), so write it in exactly this shape:
Done when either: (A) <end state>; or (B) after K "Stop hook feedback" messages, a reply ends "GOAL CAPPED: <what is left>". Either one alone ends the goal. End each reply with "Goal turn N/K" (N = those messages + 1).
In (A): one end state that command output shows (an exit code, a count, an empty list), the check run after the last edit with its output quoted in the reply, and each constraint with the output that shows it ("git diff --stat lists only src/auth"). A before/after constraint ("count not below the start", "PID unchanged") saves its start value to a file first, and the final reply quotes that file beside the new value: the judge may not see early messages. A check script you write must be shown failing once on a deliberately broken input. Run every command (A) names once now, read-only, and use it only if it worked in this checkout: a branch with no upstream has no @{u} and never shows "ahead"; for "not pushed", use git log --branches --not --remotes (commits on no remote). When my request asks for quality or no gaps, file names or heading counts do not show it: add a check that does (a test, a read-back, or a fresh reviewer subagent's quoted verdict). No taste words ("production-ready", "looks good") and no clock deadline: the judge has no clock, only times printed in the chat. Copy the (B) sentence word for word, with your number in place of both Ks; leave <what is left> and N as they are.
3. Reply with one line saying what the goal does, then the condition alone in a fenced code block tagged goal.

## Loop

Help me turn my request above into a /loop command. Do not start the work.
1. Route it first, in one line, when another tool fits better. "Keep working until X holds" is a /goal: ask me for K with your other questions, then draft a goal instead, under 600 characters, shaped "Done when either: (A) <end state>; or (B) after K "Stop hook feedback" messages, a reply ends "GOAL CAPPED: <what is left>". Either one alone ends the goal. End each reply with "Goal turn N/K" (N = those messages + 1).". In (A): one end state that command output shows (an exit code, a count, an empty list), the check run after the last edit with its output quoted in the reply, and each constraint with the output that shows it ("git diff --stat lists only src/auth"). A before/after constraint ("count not below the start", "PID unchanged") saves its start value to a file first, and the final reply quotes that file beside the new value: the judge may not see early messages. A check script you write must be shown failing once on a deliberately broken input. Run every command (A) names once now, read-only, and use it only if it worked in this checkout: a branch with no upstream has no @{u} and never shows "ahead"; for "not pushed", use git log --branches --not --remotes (commits on no remote). When my request asks for quality or no gaps, file names or heading counts do not show it: add a check that does (a test, a read-back, or a fresh reviewer subagent's quoted verdict). No taste words ("production-ready", "looks good") and no clock deadline: the judge has no clock, only times printed in the chat. Copy the (B) sentence word for word, with your number in place of both Ks; leave <what is left> and N as they are. Reply with one line saying what the goal does, then the condition alone in a fenced code block tagged goal.
"React when a log line, file or output appears" is a Monitor: give the one sentence I can type to start it, then draft the /loop as a fallback. Laptop off, or longer than 7 days, is /schedule, but only when the work needs no local files, browser or GPU: a routine runs in the cloud on a fresh clone.
2. Guide me through it: I may be new to /loop. Its required parts are: what to check, how often (or self-paced), what to do with each result, when to stop, and what must never be touched. For each part my request does not already make clear, ask me with AskUserQuestion (at most 4 questions per round). Make every option a concrete, ready-to-use value with one short line on what it means; put the one you recommend first, marked (Recommended). If my answers leave a part open or raise a new gap, ask another round. Keep asking until every required part is clear, with no limit on rounds; stop early only when I say go or enough, then pick the safest choice for each open part and name it in your reply. Do not draft until every required part is settled.
3. Then write ONE /loop line, under 600 characters. The loop skill already runs it once now, paces it, and reports when it stops; add only what it lacks:
   - an interval first (5m, 30m, 2h) only for work on a clock (daily, hourly); for "until X happens" leave it out (self-paced), since a fixed interval runs until cancelled or 7 days;
   - what to check each pass, safe to repeat; for a list, one item per pass, tracked in a state file read first, 3 tries then mark it blocked;
   - what to do for each likely result, and "if nothing changed, say so in one line";
   - when to stop, as something the check shows;
   - "never push, delete or send" unless my request asked for it;
   - no user-only skill (disable-model-invocation: true): a loop pass gets it as plain text. If a step needs one, do not rebuild its steps: say in one line that I must type it myself, and leave that step out.
4. Reply with one line saying what the loop does, then everything after "/loop " alone in a fenced code block tagged loop.

## After the draft

Claude cannot type `/goal` or `/loop` for me. End with one line: copy the block and send it after `/goal ` (or `/loop `).
