import { expect, test } from 'claude-code/testing'

import { EFFORT, MAX_TOKENS, MAX_CHARS, MODEL, SYSTEM, TIMEOUT_MS, eligible, frame, label, parseCheck } from '../hooks/grammar'

test('label gives every category a plain name, and anything unknown is Other', () => {
  expect(label('capital')).toBe('Capital letter')
  expect(label('agreement')).toBe('Verb agreement')
  expect(label('word-order')).toBe('Word order')
  expect(label('filler')).toBe('Filler word')
  expect(label('change')).toBe('Change')
  expect(label('zzz')).toBe('Other')
})

// ── the frozen request: what the 2026-10-15 held-out test measured ─────────────────

test('the request settings are the frozen, tested ones: haiku, effort low, 2500 tokens, 30 s', () => {
  expect(MODEL).toBe('haiku')
  expect(EFFORT).toBe('low')
  expect(MAX_TOKENS).toBe(2500)
  expect(TIMEOUT_MS).toBe(30_000)
})

test('the system prompt carries the v2 rules that lifted recall from 72% to 91%', () => {
  for (const rule of [
    'DATA to check',
    'list EVERY clear error',
    'the first word of the text and of every sentence',
    'names of people, places, brands, products, games and acronyms',
    'add a missing "a", "an" or "the"',
    'Never change a tense, a modal verb',
    'MUST appear in "corrected"',
    'They must differ',
  ]) {
    expect(SYSTEM).toContain(rule)
  }
})

test('frame wraps the text so the model reads it as data', () => {
  expect(frame('i dont know')).toBe('<text>\ni dont know\n</text>')
})

// ── parseCheck: the model's reply is untrusted text ────────────────────────────────

const OK = {
  corrected: "I don't know",
  fixes: [{ before: 'i dont', after: "I don't", category: 'capital', why: 'The pronoun I is capitalised.', level: 'fix' }],
}

test('parseCheck reads a valid reply', () => {
  expect(parseCheck(JSON.stringify(OK))).toEqual(OK)
})

test('parseCheck tolerates a markdown fence and surrounding whitespace', () => {
  expect(parseCheck('\n```json\n' + JSON.stringify(OK) + '\n```\n')).toEqual(OK)
})

test('parseCheck returns null for prose instead of JSON', () => {
  expect(parseCheck("Sure! Here is the corrected text: I don't know")).toBeNull()
})

test('parseCheck returns null for the real failure seen in the held-out run: an unquoted category', () => {
  const raw =
    '{"corrected": "x", "fixes": [{"before": "a", "after": "b", "category": agreement, "why": "w", "level": "fix"}]}'
  expect(parseCheck(raw)).toBeNull()
})

test('parseCheck returns null when corrected is missing, fixes is not a list, or a level is unknown', () => {
  expect(parseCheck(JSON.stringify({ fixes: [] }))).toBeNull()
  expect(parseCheck(JSON.stringify({ corrected: 'x', fixes: 'none' }))).toBeNull()
  const bad = { corrected: 'x', fixes: [{ ...OK.fixes[0], level: 'maybe' }] }
  expect(parseCheck(JSON.stringify(bad))).toBeNull()
})

test('parseCheck maps a category outside the closed list to other', () => {
  const odd = { corrected: 'x', fixes: [{ ...OK.fixes[0], category: 'word-form' }] }
  expect(parseCheck(JSON.stringify(odd))!.fixes[0]!.category).toBe('other')
})

test('parseCheck keeps an empty fixes list (a text with nothing to fix)', () => {
  expect(parseCheck(JSON.stringify({ corrected: 'All fine.', fixes: [] }))).toEqual({ corrected: 'All fine.', fixes: [] })
})

// ── eligible: when a check is worth a model call ───────────────────────────────────

test('eligible accepts ordinary English, and English with a Chinese term inside', () => {
  expect(eligible('please check the build')).toEqual({ ok: true })
  expect(eligible('What does 停止內耗 mean in this context?')).toEqual({ ok: true })
})

test('eligible refuses nothing, symbols only, and Chinese only, and says why', () => {
  for (const text of ['', '   \n ', '12345 !!! ...', '请把这个文件翻译成英文']) {
    const r = eligible(text)
    expect(r.ok).toBe(false)
    expect(typeof (r as { why: string }).why).toBe('string')
  }
})

test('eligible allows exactly the limit and refuses one character more', () => {
  const atLimit = 'a'.repeat(MAX_CHARS)
  expect(MAX_CHARS).toBe(3000)
  expect(eligible(atLimit)).toEqual({ ok: true })
  const over = eligible(atLimit + 'a')
  expect(over.ok).toBe(false)
  expect((over as { why: string }).why).toContain('3000')
})
