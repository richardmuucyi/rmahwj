---
name: say-it-naturally
description: >-
  Polish what the user is about to say out loud (a meeting or stand-up update, a demo or presentation
  point, an idea they must explain to a colleague, manager or new joiner) so it sounds natural in spoken
  English but stays in their own words, then help them practise. Replies with a polished version, a short
  version, their phrases with the fix and why, the questions the room may ask, and content doubts flagged
  separately. Use whenever the user pastes their own wording and asks how to say it better or more
  naturally, whether it sounds OK said out loud, to polish, smooth or rephrase their explanation without
  changing it much, how to put a point across, or says they want to practise explaining something. NOT
  for: chat replies or messages; emails, posts, READMEs or other written text; writing a new script from a
  topic; reading text aloud; translating; how to handle a difficult conversation.
---

# say-it-naturally

The user practises explaining things in English before they say them in a meeting. They write the explanation the way they would say it; this skill makes it sound natural *without making it someone else's*. They should recognise every sentence as their own, and learn a few phrases they can reuse.

## Steps

1. **Get their words.** The user pastes or types what they plan to say. If the message has no text to polish (for example it ends at "polish it for a meeting:"), say it did not come through and ask them to paste it. You may offer a version built from the conversation for comparison, labelled clearly as yours, not theirs.

2. **Find the point and the listener.** In one sentence to yourself: what are they trying to get across, and to whom? Default listener: colleagues in a work meeting. Ask only when the answer would change the wording (a manager who wants the decision, against an engineer who wants the mechanism); otherwise do not ask.

3. **Polish in their words.** Keep their words, their order and their technical terms wherever they already work. Change only what is wrong, unclear or unnatural when spoken:
   - grammar slips ("the terms that appears" → "the terms that appear");
   - a missing word that carries the point ("retrieve the terms" → "retrieve **only** the terms");
   - one long run-on sentence → two or three short ones, one idea each, because a listener cannot re-read;
   - a link word only where their sentences have none and the listener would lose the thread ("so", "but", "because"). Keep their own link words and hedges ("it's really", "that could mean"); do not swap in stock phrases ("The trade-off is…", "In practice…"), because every reply would then sound the same instead of like them.

   Keep the meaning and the length roughly the same. Do not add new claims, examples or numbers; do not swap in corporate words (leverage, synergy, delve, robust). Keep the user's own variety and register of English: do not make it American, more formal or more casual than they wrote it.

4. **Write the short version.** One or two sentences they can say when time is tight, still in their words.

5. **List the wording fixes.** Three to six bullets, only for changes worth learning: *"their phrase" → "the fix"*, then a few words on why (grammar, sounds more natural, makes the point clearer). Skip trivial changes. These are what they take away, so pick phrases they can reuse.

6. **Flag likely questions and gaps.** One or two points someone in the room may ask, each with a line they could add. Separately, if a claim looks wrong or a key point is missing, say so plainly, outside the polished version; never fix their meaning silently. When the content comes from a file or repo you can reach, check it there first and say what you checked; otherwise mark the flag "(unchecked)".

7. **Invite a retry.** End with one line inviting them to say it back in their own words. When they send a new attempt, start the reply with what improved since the last one, then run steps 3 to 6 again, shorter.

## Reply format

```
**Polished, in your words:**
> …

**Short version:**
> …

**Wording fixes:**
- "…" → "…" — why
- …

**Someone may ask:** … — you could add: "…"
**Check:** … (only when a claim looks wrong or a key point is missing)

Want to try it once more in your own words? Type it and I'll polish it.
```

## Done when

- every sentence of the polished version can be traced to something they said (no new claims, examples or numbers);
- their technical terms are unchanged unless a fix bullet explains why;
- the short version is at most two sentences;
- each wording fix quotes their phrase and gives the reason;
- any doubt about content is in "Check", not folded into the polished text;
- the reply ends with the retry line.

## Example

Their words: *"I will say we just retrieve the necessary terms that are relevant to the input. It's really searching the exact terms that appears in the sentence input. That could mean we will lose the semantic search."*

- Polished: "I'd say we only retrieve the terms that are relevant to the input. It's really a search for the exact terms that appear in the sentence. That could mean we lose semantic search."
- Fixes: "we just retrieve the necessary terms" → "we **only** retrieve the terms" ("only" carries the point; "necessary" and "relevant" say the same thing twice); "searching the exact terms that appears in the sentence input" → "a search **for** the exact terms that **appear** in the sentence" (grammar, and "sentence input" is one idea said twice); "That could mean we will lose" → "That could mean we lose" (plain present tense; the hedge "could mean" stays).
- Someone may ask: what about typos and other spellings? — "A hybrid could use exact match first and fall back to semantic search."
