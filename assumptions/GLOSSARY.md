# Assumptions

A mod where Claude logs each guess it makes while working, so the person can confirm or correct it before more work is built on it.

## Language

**Assumption**:
One guess Claude made that the person has not confirmed, logged as one sentence with an optional reason and impact.
_Avoid_: Guess, decision, note

**Open assumption**:
An assumption the person has not yet given a verdict on and has not dismissed.
_Avoid_: Pending, unreviewed

**Verdict**:
The person's judgement on one assumption: right or wrong. Claude treats a verdict as settled.
_Avoid_: Review, answer, mark

**Correction**:
What the person says a wrong assumption should have been. It goes to Claude at once and is kept for later sessions in the same repo.
_Avoid_: Fix (that is the button's label), feedback

**Dismissed**:
An assumption closed with no verdict. It is neither approved nor corrected, and Claude is told nothing about it. A dismissed assumption can be reopened.
_Avoid_: Ignored, accepted, deferred

**Skip**:
The act of dismissing one assumption; **Skip all** dismisses every open low-impact one and leaves the high-impact ones open. It never means "ask me later".
_Avoid_: Later, defer, snooze

**High impact**:
An assumption whose being wrong would be costly to undo. It is reviewed before the others and shown in full; a low-impact one is shown compact.
_Avoid_: Critical, important
