# B0 and B1: what to ask, and what to do when nobody can answer

Moved word for word from `SKILL.md` on 2026-11-13, so the skill body stays short. `SKILL.md` keeps the rules that hold on every run.

### B0. When there is nobody to ask

You will sometimes run where no human can answer — a subagent, a scheduled job, a batch. Do
not stall, and do not pretend a default was a decision. Write the questions you would have
asked into your notes under a clear heading, state the assumption you are proceeding on for
each, and deliver anyway. A delivered artefact plus four honest open questions is useful; a
blocked task is not. When a human *is* present, ask — the whole point of B1 is that some
answers change the drawing rather than refine it.

### B1. Decide what actually needs asking

Ask only where a wrong guess wastes real work, and ask **once**, batched. These usually
qualify, because they change the artwork rather than refine it:

- **Where it will be used, and how small it will get.** A 16px favicon and a hero mark are
  different drawings, not one drawing scaled.
- **Colour commitment.** Mono and recolourable by the consumer (`currentColor`), or fixed
  brand colours? That changes the file's structure, not just its fills.
- **Style register**, when the brief is open — "an icon of a fox" could be geometric flat,
  single-weight line, or filled silhouette, and they share no geometry.

These usually do *not* qualify — decide, and state the assumption in one line: canvas size,
exact padding, id naming, whether to include `<title>`. If the user gave a reference image or
named a style, infer from it rather than re-asking.

Two failure modes to avoid, in both directions. **Asking what you could check** wastes the
user's turn — never ask whether something is legible at 16px, whether a colour has contrast, or
whether two variants are the same shape; those are measurements, and you have the scripts.
**Not asking what only they know** wastes the whole drawing — the business name, who it is for,
where it will physically appear. If you cannot name what a question would change about the
artwork, it is not worth asking.

**When a question is unanswerable and would change the geometry, build both answers.** Style
register is the usual one. Guessing wastes the drawing and asking is impossible in a headless
run, so finish two genuine directions and let the client pick. That is cheaper than a wrong
single direction and it makes the choice concrete instead of abstract.

**Some things you cannot settle for them, and should say so rather than imply otherwise.**
Trademark clearance needs their real name and jurisdiction. And whether a silhouette reads as
intended — one run built an arch-on-plinth mark and flagged that it wanted a few naive viewers
asked whether they saw a window or a headstone. No script answers that; naming it is the
honest move.
