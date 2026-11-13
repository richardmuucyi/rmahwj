---
name: enhance
description: "Turn my request into one deeper prompt: ask about the gaps that change the result, say what a top professional would add, add a panel of five experts on request, then write one prompt, have a fresh agent read it back, and ask \"run it now?\". A small request is passed through; another skill's job is routed to it. User-invoked only: /enhance <request>; /enhance panel <request> adds five experts, /enhance grill <request> a full interview, and both words may be used. Moved from the prompt-enhancer mod's ++, ++deep, ++panel and grill modes (2026-10-31). NOT for a /goal or /loop (/goal-draft)."
disable-model-invocation: true
argument-hint: "[panel] [grill] <request>"
---

# Enhance

My request: $ARGUMENTS

I want a deeper version of my request above, not a bigger one. Do not start the work until I say yes at the end. Do not search my private notes (daily notes, journal, personal areas) for facts about me, my family, health, money or relationships: ask me instead.

**Panel and grill.** My request may start with the words `panel`, `grill` or both, in either order. Drop them from the request. `panel` runs step 3. `grill` runs grill mode: step 1 uses the interview below in place of its question limit, and step 4's word limit gives way to the trace rule.

## 0. Size and route *(added 2026-11-13)*

Before step 1, judge my request and say the result in one line. Do this once; it is not a step to deliberate on. You may take one quick look first (open the file the request names, or list a folder) to see that what it names is there.

- **Small.** The work is one step I can check at a glance (one answer, one short text, one small edit, a rename, a lookup), and nothing in it is unclear in a way that would change the result. Reply "Small: run it as it is.", add at most one line that names a check worth making, and ask with AskUserQuestion: run it as typed (Recommended), enhance it anyway (then go on with step 1), or stop here. Skip steps 1 to 5 and write no deep block, prompt or goldfish block. A request that started with `panel` or `grill` is never small: I asked for the full pass.
- **Another skill's job.** Route only when another skill does *this skill's* job better: it is made to plan, specify or draft the kind of request I typed, so enhancing here would only repeat it. Name the skill and say why in one line, then ask me with AskUserQuestion: use that skill (Recommended), enhance it here, or stop. Name only a skill you can see in this session's skill list, or one of the three below; for a skill I must type myself, give me the command to type and do not try to load it. Never route on a guess about a skill you have not seen.
  - A skill that *does the work* (draws a diagram, builds a report, renders an image) is not a route, even when it covers the whole request. Go on with step 1, and name that skill in the prompt as the tool for its step ("use the d2-diagram skill for the render"). When two could fit a step, name the one whose description names the files or the output in my request.
  - A `/goal` or a `/loop`: `/goal-draft`.
  - Work that will take more than one session, or that must be resumed from a file (a spec, a plan with tasks to tick off): say so in one line, run step 1 first so the gaps are closed, then ask the route question with these options: type `/mattpocock-skills:to-spec` and after it `/mattpocock-skills:to-tickets` (Recommended), use `superpowers:writing-plans`, enhance it here, or stop. The first two are typed by me and never show in your skill list, so their absence there means nothing; they turn this conversation into a durable spec and tickets, which this skill does not write. Step 1's answers are their input, so list the settled answers in the reply.
- **Otherwise** go on with step 1.

## 1. Gaps

Check my request for anything unclear, missing or ambiguous that would change the result: the goal, the scope, the constraints, and how we will know it is done. Also ask when my request leaves out facts only I know that would change the result: who it is for, where, and the limits of time, money or taste. If something matters, ask me (AskUserQuestion, up to 4 questions per round, multiple choice where possible). If my answers leave a gap open or raise a new one, ask another round. Keep asking until every gap that changes the result is clear, with no limit on rounds; stop early only when I say go or enough, then pick the safest choice for each open gap and name it in your reply. Ask nothing whose answer would not change the result. Skip what I already said. Ask them now: never move them into the rewrite as a step for later. Otherwise do not ask.

Grill mode: interview me until you hold every fact this result depends on, with no limit on rounds or length. First read the files about this request and run the read-only commands that could answer a question, and never ask what they answer. Keep a ledger: start each reply that asks, and end the reply that drafts, with a fenced code block tagged ledger, one line per fact the result needs: "settled: <fact>: <value> (from me / from <file>)", "open: <fact>: <what its answer changes>" or "assumed: <fact>: <the value you will use>". Ask with AskUserQuestion, up to 4 questions per call (the tool's own limit), round after round: put the option you recommend first, marked (Recommended), and say in each question what its answer changes. Ask nothing whose answer would not change the result. When an answer opens a new gap, add it to the ledger as open and ask it. Draft only when no line is open, or when I say go or enough: then mark each open line assumed, with the value you will use. The ledger covers every choice the work needs: the deliverable's form and where it is saved, which tools I will use, time and budget.

## 2. Deeper

Answer four questions, specific to this request, one line each, under 200 characters:
1. what a top professional in this field would do here that I am not asking for;
2. the rawest material they would start from instead of what has already been digested for me, and where it is (a file, a URL, a command, a dataset). You may read files or run read-only commands to find it; if it is out of reach, say so;
3. the specific methods and tools they would use, by name;
4. what, other than you or me, would show the result is right: a test, a measurement, a known answer to compare with, or a person who is neither of us. Never "you review it" or a taste word ("looks good", "polished").

Read a file before you say what it holds. Name only a path, command or commit you have checked exists; mark anything you could not check "(unchecked)".

## 3. Panel, only with `panel`

Run this step only when my request started with `panel`. Otherwise skip it without a word.

Pick the five experts from different fields who would make this outstanding, including two whose job is to find what's wrong with it. For each one, tell me what they would actually do and which methods they would use.
- If a choice must be settled before the work (which tools I will use, a fixed time, a budget), ask me with AskUserQuestion before you write the panel.
- Name each by field, not as an invented person: no personas, voices or quotes.
- List the five as a short list, one line per expert, under 200 characters before the nearest-step clause: the field, "(critic)" after it for the two critics, a colon, what they would do, then "methods:" and the methods by name. Pick methods that test what each reader needs, each named specifically ("think-aloud test", not "best practices"). Where one needs something the work will lack (a person, a lab, paid data), say so on its line, name the nearest step it can do, and say what that step cannot measure ("nearest step: a fresh subagent follows it; cannot measure: where a person gets lost"). The format only:
  ```
  Technical writer: turns each task into numbered steps a new hire can follow; methods: task analysis, plain-language review
  Usability tester (critic): watches two people follow it cold and notes where they stall; methods: think-aloud test, task success rate; nearest step: a fresh subagent follows it; cannot measure: where a person gets lost
  ```

## 4. One prompt

Then rewrite my prompt to ask for exactly that. It starts with my request, word for word, and keeps the deliverable I asked for. Same deliverable and about the same amount of work: add the raw material, the methods and the proof as steps, add no new deliverables, and keep my own words where they work. Every step serves my one deliverable (finds its material, makes it, or checks it); a second result is a new deliverable even as a last step: a further report, an audit of something else, a new script. Add no new kind of output either: a table, score sheet, breakdown or analysis my request does not name is a new deliverable. The proof checks the result; its numbers are not added to what I get unless I asked for them. Anything you marked "(unchecked)" goes into the rewrite as a check-first step with a fallback ("first confirm X exists; if it does not, do Y instead"), never as a plain step that assumes it. Under 150 words, or 200 when you asked me questions first: the extra is only for my answers. In grill mode: No length limit: write as much as the result needs, and no more. One deliverable, and every line of the draft traces to my request or to a settled or assumed ledger line; add nothing they do not hold.

In every mode the prompt also carries these three, outside the word limit *(added 2026-11-13: say what done is, give each task a check, ask for the output)*:
- One done-when line: "Done when: <a result that output can show: an exit code, a count, a quote, a known answer>". Use my own words for it where I gave them; never a taste word ("looks good", "polished"). With a panel, the reader done-when lines below stand in for it.
- A task list, only when the work has more than one step that can fail by itself (a change across several files, a migration, a pipeline). At most 5 tasks, one line each, in the order they run: "Task N: <what>; check: <a command, a count or a known answer that shows this task alone is right>". A check uses what already exists (a test that is there, a command, a count); it adds a test file only when my request asks for tests. Work that is one step (one answer, one short text, one small edit) gets no task list: do not invent tasks to fill one.
- One line that asks for the proof: "Show each check's real output (the command and what it printed), not a summary of it." The output goes in the reply; it is not added to the deliverable.

With a panel, the prompt also carries these, past the word limit. The panel changes how the work is done, not what it is.
- Every expert's methods as steps, the critics' too: their methods, not their voices.
- Every reader of the result: each person, agent, team or later maintainer my request implies, not only the one that can be tested here. For each, write one done-when line that quotes, in double quotes, the words of my request that say what that reader needs, then a test that checks those very words, and who runs it ("run by …"). A person's test is run by a person (me, or someone I name), and a stated limit never replaces that; when none can run it, still list it and say who must. At most 6 done-when lines: when two readers need the same thing (me asking and me reading), merge them into one line that quotes both. Every line tests the one deliverable my request asks for; a reader whose test needs a second deliverable is out of scope. Each done-when line starts "Done when, <reader> ("<my words about that reader>"):", or "Done when, <reader> (implied):" for a reader my request implies but never mentions. In those lines "the owner" is me and "Claude" is a fresh subagent, never whoever does the work. The format only:
  ```
  Done when, new hire ("<my words about new hires>"): they can say what the product is for and finish the first task from the guide alone; test: they follow it cold and explain it back, run by the owner
  Done when, agent: a fresh agent finishes the same task from the guide alone; test: cold-start run, run by Claude; cannot measure: whether a person understands it
  ```
- The work rules: run each method that makes the result with your tools where you can, and show its real result (its output, a count, a quote); if a method cannot run, say so in one line rather than describe a result. Never check your own work: when the result is made, give the critics' methods and the done-when tests run by Claude to a fresh subagent that has not seen the work, with my request word for word and the finished result only, not your plan or notes. It runs each check and shows its real result; fix what it finds, and report its results, not your own view. Where a method ran as its nearest step, report the result as that step's and repeat what it cannot measure beside it; never present it as the original method's result. If a search finds nothing, widen it before you say a file does not exist. Give my request, word for word, to every subagent you use. Where the panel left a choice open, take the safest option and name it. Do not search my private notes (daily notes, journal, personal areas) for facts about me, my family, health, money or relationships: ask me instead. The subagent judges the final result against my request, not your plan or a first draft. Running the project's own test suite is part of making the result; the done-when tests are the subagent's. Before you finish, report each done-when test as pass or fail with the subagent's result, and list each one that could not run and who must run it.

The prompt's last line is this, word for word:
Make only the one deliverable named. No extra files, tests or reports unless my request asks.

## 4b. Goldfish check *(added 2026-11-13)*

Before you show me the prompt, have a reader with no memory of this conversation read it. You wrote the prompt, so you cannot see what it leaves out.

Give the prompt, and nothing else, to a fresh subagent (Agent tool, `subagent_type: "Explore"`): not this conversation, not the ledger, not the deep answers, not your notes. It may open the files the prompt names. Ask it for three short things, and tell it to do none of the work:
1. in two sentences, what it would make, and how it would know it is done;
2. every guess it had to make to answer 1, one line each;
3. any line of the prompt it could not act on.

Then use what it returns:
- If its say-back is not what I asked for, fix the prompt.
- For each guess whose answer would change the result: if a file answers it, read the file and put the answer in the prompt; if only I know it, ask me now with AskUserQuestion, before the reply of step 5, and put my answer in the prompt. Drop a guess that would not change the result.
- For each line it could not act on: fix the prompt so it can, or keep the line in the goldfish block when it cannot be fixed here.
- What these fixes add to the prompt is outside step 4's word limit.
- Run the check once. Do not send the fixed prompt back for a second round.
- If you have no subagent tool, or the call fails, write "goldfish: could not run" and why. Never write a say-back or a guess list yourself.

## 5. Reply, then run it now?

Reply with the four answers in a fenced code block tagged deep, one line each:
pro: …
raw: …
methods: …
proof: …
then the panel list if step 3 ran, then the prompt alone in a fenced code block tagged prompt (four backticks when it holds a code block of its own), then the goldfish result in a fenced code block tagged goldfish, three lines:
say-back: <its answer to 1, word for word, even when longer than two sentences>
guesses: <how many it made>; fixed in the prompt: <n>; asked me: <n>; dropped: <n>
could not act on: <its lines that are still open, or "nothing">; fixed: <n>

Then ask "Run it now?" with AskUserQuestion: run it now (Recommended), edit it first, or stop here. On "run it now", do the work the prompt asks for, as written. On "edit it first", take my changes and ask again.
