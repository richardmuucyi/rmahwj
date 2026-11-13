import { expect, test } from 'claude-code/testing'

import { review, rows } from '../hooks/grammar'
import type { Fix } from '../hooks/grammar'

const fx = (before: string, after: string, category = 'other', why = 'a reason', level: 'fix' | 'tip' = 'fix'): Fix => ({
  before,
  after,
  category,
  why,
  level,
})

// ── highlights come from the word diff ────────────────────────────────────────────

test('one corrected word: a hunk, a final text and segments to draw', () => {
  const r = review('please check it', { corrected: 'Please check it', fixes: [fx('please', 'Please', 'capital', 'Sentence start.')] })
  expect(r.text).toBe('Please check it')
  expect(r.applied).toBe(1)
  expect(r.held).toBe(0)
  expect(r.hunks.length).toBe(1)
  expect(r.hunks[0]).toEqual({ del: ['please'], ins: ['Please'], applied: true, category: 'capital', why: 'Sentence start.' })
  expect(r.segments).toEqual([
    { kind: 'del', text: 'please' },
    { kind: 'ins', text: 'Please' },
    { kind: 'same', text: 'check it' },
  ])
})

test('two adjacent word fixes of the same length are two fixes, each with its own reason', () => {
  const r = review("i dont know", {
    corrected: "I don't know",
    fixes: [fx('i want', 'I want', 'capital', 'The pronoun I.'), fx('dont', "don't", 'punctuation', 'Needs an apostrophe.')],
  })
  expect(r.text).toBe("I don't know")
  expect(r.applied).toBe(2)
  expect(r.hunks.map(h => [h.del.join(' '), h.ins.join(' '), h.category])).toEqual([
    ['i', 'I', 'capital'],
    ['dont', "don't", 'punctuation'],
  ])
})

test('a change the model lists but did not make is not drawn as a fix: it becomes a tip', () => {
  const original = 'i mean can we make claude default? i dont want reverse engineer vision'
  const corrected = "I mean can we make Claude default? I don't want reverse engineer vision"
  const r = review(original, {
    corrected,
    fixes: [fx('for reverse engineer', 'for reverse engineering', 'word-choice', 'Needs a gerund.')],
  })
  expect(r.text).toBe(corrected)
  expect(r.text.includes('engineering')).toBe(false)
  expect(r.hunks.some(h => h.ins.join(' ').includes('engineering'))).toBe(false)
  expect(r.tips.map(t => t.after)).toEqual(['for reverse engineering'])
})

test('tips: a no-op tip is dropped, a real tip stays, and a tip the model applied anyway is a fix, not a tip', () => {
  const r = review('ask yue2 now', {
    corrected: 'ask YuE2 now',
    fixes: [fx('yue2', 'YuE2', 'capital', 'A name.', 'tip'), fx('rate them', 'rate them', 'other', 'Ambiguous.', 'tip'), fx('ask', 'Ask', 'capital', 'Start.', 'tip')],
  })
  expect(r.applied).toBe(1)
  expect(r.tips.map(t => t.after)).toEqual(['Ask'])
})

test('no change at all: nothing to apply, one plain segment, the text untouched', () => {
  const r = review('This is fine.', { corrected: 'This is fine.', fixes: [] })
  expect(r.applied).toBe(0)
  expect(r.held).toBe(0)
  expect(r.text).toBe('This is fine.')
  expect(r.segments).toEqual([{ kind: 'same', text: 'This is fine.' }])
})

test('a whitespace-only difference is not a fix, and the original spacing is kept', () => {
  const r = review('a  b', { corrected: 'a b', fixes: [] })
  expect(r.applied).toBe(0)
  expect(r.text).toBe('a  b')
})

test('paragraph breaks survive a fix in either paragraph', () => {
  const a = review("i dont know.\n\nSecond paragraph stays.", { corrected: "I don't know.\n\nSecond paragraph stays.", fixes: [] })
  expect(a.text).toBe("I don't know.\n\nSecond paragraph stays.")
  const b = review('Fine.\n\nthis is bad', { corrected: 'Fine.\n\nThis is bad', fixes: [] })
  expect(b.text).toBe('Fine.\n\nThis is bad')
})

// ── the guard: never apply a deletion of two or more words on the model's say-so ───

test('GUARD: the held-out failure: "worth to add or update" -> "worth adding" is kept as written', () => {
  const original = 'show every learning points that you think is worth to add or update to my prompthing enhancer'
  const corrected = 'show every learning point that you think is worth adding to my prompting enhancer'
  const r = review(original, {
    corrected,
    fixes: [fx('learning points', 'learning point', 'agreement'), fx('worth to add or update', 'worth adding', 'word-choice'), fx('prompthing', 'prompting', 'spelling')],
  })
  expect(r.held).toBe(1)
  expect(r.applied).toBe(2)
  expect(r.text).toBe('show every learning point that you think is worth to add or update to my prompting enhancer')
  const held = r.hunks.filter(h => !h.applied)
  expect(held.length).toBe(1)
  expect(held[0]!.del.join(' ')).toContain('add or update')
  expect(r.segments.some(s => s.kind === 'held' && s.text.includes('add or update'))).toBe(true)
  // the held change is shown in its own row, so it is not repeated as a tip
  expect(r.tips.length).toBe(0)
})

test('GUARD: two content words deleted are held, even when the rest of the sentence is fine', () => {
  const r = review('I think you know it works', { corrected: 'I think it works', fixes: [] })
  expect(r.held).toBe(1)
  expect(r.applied).toBe(0)
  expect(r.text).toBe('I think you know it works')
})

test('GUARD allows an exact repeat: "each time when I, when I do" loses the stutter', () => {
  const r = review('each time when I, when I do GCP', { corrected: 'each time when I do GCP', fixes: [] })
  expect(r.held).toBe(0)
  expect(r.applied).toBe(1)
  expect(r.text).toBe('each time when I do GCP')
})

test('GUARD allows a filler plus the repeat it left: "I am yeah I am using"', () => {
  const r = review('which I am yeah I am using it', { corrected: 'which I am using it', fixes: [] })
  expect(r.held).toBe(0)
  expect(r.text).toBe('which I am using it')
})

test('GUARD allows deleting fillers only, however many', () => {
  const r = review('well uh, yeah I think', { corrected: 'well I think', fixes: [] })
  expect(r.held).toBe(0)
  expect(r.text).toBe('well I think')
})

test('GUARD does not touch a one-word deletion, a doubled word, or a swap that is not shorter', () => {
  expect(review('so much of time', { corrected: 'so much time', fixes: [] }).text).toBe('so much time')
  expect(review('I think the the impact', { corrected: 'I think the impact', fixes: [] }).text).toBe('I think the impact')
  const swap = review('you come out of 10 ideas', { corrected: 'you come up with 10 ideas', fixes: [] })
  expect(swap.held).toBe(0)
  expect(swap.text).toBe('you come up with 10 ideas')
})

test('GUARD: a held change next to an applied one leaves a sentence that still reads as the writer wrote it', () => {
  // the held region and a one-word fix sit one word apart: they must not be split into a half-applied mess
  const r = review('it is worth to add or update to my list', { corrected: 'it is worth adding to my list', fixes: [] })
  expect(r.held).toBe(1)
  expect(r.text).toBe('it is worth to add or update to my list')
})

// ── rows: what the card lists ─────────────────────────────────────────────────────

test('rows group identical fixes: six "i" -> "I" are one row with a count', () => {
  const r = review('i think i prefer it', {
    corrected: 'I think I prefer it',
    fixes: [fx('i think', 'I think', 'capital', 'The pronoun I.'), fx('i prefer', 'I prefer', 'capital', 'The pronoun I.')],
  })
  expect(r.applied).toBe(2)
  expect(rows(r)).toEqual([{ del: 'i', ins: 'I', category: 'capital', why: 'The pronoun I.', count: 2, applied: true }])
})

test('rows list a held change with the words the model wanted, marked as not applied', () => {
  const r = review('I think you know it works', { corrected: 'I think it works', fixes: [] })
  expect(rows(r)).toEqual([{ del: 'you know', ins: '', category: 'change', why: '', count: 1, applied: false }])
})

test('a hunk with no matching reason is still shown, with a plain category', () => {
  const r = review('go home', { corrected: 'Go home', fixes: [] })
  expect(rows(r)).toEqual([{ del: 'go', ins: 'Go', category: 'change', why: '', count: 1, applied: true }])
})

test('tips: a deletion the model listed but did not make is a tip; one it made is not', () => {
  // Not made: "very" is still in the text, so the suggestion to drop it is shown.
  const kept = review('this is very good', { corrected: 'This is very good', fixes: [fx('very', '', 'filler', 'Filler.', 'tip')] })
  expect(kept.text).toBe('This is very good')
  expect(kept.tips.map(t => t.before)).toEqual(['very'])

  // Made: the word is gone, so there is nothing left to suggest.
  const gone = review('this is very good', { corrected: 'This is good', fixes: [fx('very', '', 'filler', 'Filler.')] })
  expect(gone.text.includes('very')).toBe(false)
  expect(gone.tips.length).toBe(0)
})
