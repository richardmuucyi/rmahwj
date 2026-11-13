import { expect, test } from 'claude-code/testing'
import type { Mounted, TestBody } from 'claude-code/testing'

import { SYSTEM } from '../hooks/grammar'

type Args = Parameters<TestBody>
type Surface = 'terminal' | 'desktop'
type Band = Mounted<Surface, 'AbovePrompt'>

// the tests run under a runner that has timers; the hooks' environment (and its lib) has none
declare const setTimeout: (fn: () => void, ms: number) => unknown

const BAND = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 20 }, view: {} }
const USAGE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const fold = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()

const answer = (check: object) => ({ isAnswered: true as const, text: JSON.stringify(check), usage: USAGE })
const prose = (text: string) => ({ isAnswered: true as const, text, usage: USAGE })
const apiError = { isAnswered: false as const, reason: 'api-error' as const, status: 529, error: 'overloaded' as const, usage: USAGE }
type Reply = ReturnType<typeof answer> | typeof apiError

const fx = (before: string, after: string, category: string, why: string, level: 'fix' | 'tip' = 'fix') => ({ before, after, category, why, level })

const PLEASE = answer({ corrected: 'Please check it', fixes: [fx('please', 'Please', 'capital', 'Sentence start.')] })

/** The engine's side of a test: what reaches Claude, what the model call saw, the prompt box, the card. */
function rig($: Args[0], on: Args[1], replies: (Reply | Promise<Reply>)[], box0 = '', surface: Surface = 'terminal') {
  const seen: string[] = []
  const calls: { model: string; prompt: string; system?: string; effort?: string; maxTokens?: number; timeoutMs?: number }[] = []
  const state = { box: box0 }
  on('prompt.submit', (_$, e) => {
    seen.push(e.text)
    return { text: e.text }
  })
  on('prompt.fill', (_$, e) => {
    state.box = e.text
    return { ...e, isFilled: true }
  })
  on('prompt.read', () => ({ value: { text: state.box, cursor: state.box.length } }))
  // a call on `$` reaches the hooks as { value } or { deny }; a reply may be a promise the test releases later
  on('model.complete', async (_$, e) => {
    calls.push(e)
    return { value: (await replies[calls.length - 1]) ?? apiError }
  })
  on('ui.render', ($$, e) => {
    const { Box } = $$.ui.resolve(e)
    return <Box key="engine-own" />
  })

  let mounted: Band | undefined
  const band = async () => (mounted ??= await $.ui.mount({ plugin: 'grammar-check', surface, component: 'AbovePrompt', props: BAND }))
  const card = async () => fold((await (await band()).find({ key: 'pe-grammar' }))?.text)
  const wait = () => new Promise<void>(r => setTimeout(r, 1))
  const until = async (cond: () => boolean | Promise<boolean>, what: string) => {
    for (let i = 0; i < 300; i++) {
      if (await cond()) return
      await wait()
    }
    throw new Error(`timed out waiting for ${what}`)
  }
  const settle = async () => {
    for (let i = 0; i < 25; i++) await wait()
  }
  return {
    seen,
    calls,
    state,
    card,
    until,
    settle,
    submit: (text: string) => $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false }),
    press: async (key: string) => (await band()).press({ key }),
    shows: (needle: string) => async () => (await card()).includes(needle),
  }
}

/** A slash command as the person would run it from the box. */
const runCommand = ($: Args[0], command: string, args: string) =>
  $.command.run({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })

const NEVER_CLAIMS_CLEAN = /\b(clean|all correct|perfect|no errors|error-free)\b/i

for (const surface of ['terminal', 'desktop'] as const) {
  test(`== is consumed, never sent to Claude, and asks haiku once with the frozen request (${surface})`, async ($, on) => {
    const r = rig($, on, [PLEASE], '', surface)
    const out = await r.submit('== please check it')
    expect(out.drop ?? '').toContain('Checking')
    expect(out.drop ?? '').toContain('Claude')
    await r.until(() => r.calls.length === 1, 'the model call')
    expect(r.seen).toEqual([])
    const c = r.calls[0]!
    expect(c.model).toBe('haiku')
    expect(c.effort).toBe('low')
    expect(c.maxTokens).toBe(2500)
    expect(c.timeoutMs).toBe(30_000)
    expect(c.system).toBe(SYSTEM)
    expect(c.prompt).toBe('<text>\nplease check it\n</text>')
  })

  test(`a fix shows the words, the reason and the count; the corrected text lands in the empty box (${surface})`, async ($, on) => {
    const r = rig($, on, [PLEASE], '', surface)
    await r.submit('== please check it')
    await r.until(r.shows('1 fix found'), 'the card')
    const text = await r.card()
    expect(text).toContain('GRAMMAR')
    expect(text).toContain('Capital letter')
    expect(text).toContain('please')
    expect(text).toContain('Please')
    expect(text).toContain('Sentence start.')
    expect(text).toContain('not sent to Claude')
    expect(NEVER_CLAIMS_CLEAN.test(text)).toBe(false)
    expect(r.state.box).toBe('Please check it')
  })

  test(`the box is left alone when you typed something else meanwhile; the button puts the text in (${surface})`, async ($, on) => {
    const r = rig($, on, [PLEASE], 'half typed note', surface)
    await r.submit('== please check it')
    await r.until(r.shows('1 fix found'), 'the card')
    expect(r.state.box).toBe('half typed note')
    await r.press('pe-g-box')
    expect(r.state.box).toBe('Please check it')
  })

  test(`a box that still holds the == line is replaced (${surface})`, async ($, on) => {
    const r = rig($, on, [PLEASE], '== please check it', surface)
    await r.submit('== please check it')
    await r.until(r.shows('1 fix found'), 'the card')
    expect(r.state.box).toBe('Please check it')
  })

  test(`GUARD: a deletion of "or update" is shown as not applied and the box keeps the writer's words (${surface})`, async ($, on) => {
    const original = 'show every learning points that you think is worth to add or update to my prompthing enhancer'
    const corrected = 'show every learning point that you think is worth adding to my prompting enhancer'
    const reply = answer({
      corrected,
      fixes: [fx('learning points', 'learning point', 'agreement', 'Agrees with every.'), fx('worth to add or update', 'worth adding', 'word-choice', 'Simpler.'), fx('prompthing', 'prompting', 'spelling', 'Typo.')],
    })
    const r = rig($, on, [reply], '', surface)
    await r.submit('== ' + original)
    await r.until(r.shows('2 fixes found'), 'the card')
    const text = await r.card()
    expect(text).toContain('⚠')
    expect(text).toContain('not applied')
    expect(text).toContain('add or update')
    expect(r.state.box).toBe('show every learning point that you think is worth to add or update to my prompting enhancer')
  })

  test(`one retry when the reply is not the agreed JSON (${surface})`, async ($, on) => {
    const r = rig($, on, [prose('Sure! Here is the corrected text.'), PLEASE], '', surface)
    await r.submit('== please check it')
    await r.until(r.shows('1 fix found'), 'the card after the retry')
    expect(r.calls.length).toBe(2)
    expect(r.calls[1]!.prompt).toBe(r.calls[0]!.prompt)
  })

  test(`two bad replies end in a plain message, with exactly two calls and nothing in the box (${surface})`, async ($, on) => {
    const r = rig($, on, [prose('no'), prose('still no'), PLEASE], '', surface)
    await r.submit('== please check it')
    await r.until(r.shows('Could not read'), 'the failure card')
    await r.settle()
    expect(r.calls.length).toBe(2)
    expect(r.state.box).toBe('')
  })

  test(`an API error is shown with its kind and is not retried (${surface})`, async ($, on) => {
    const r = rig($, on, [apiError, PLEASE], '', surface)
    await r.submit('== please check it')
    await r.until(r.shows('Could not check'), 'the error card')
    const text = await r.card()
    expect(text).toContain('overloaded')
    await r.settle()
    expect(r.calls.length).toBe(1)
    expect(r.state.box).toBe('')
  })

  test(`nothing found says "No fixes found", never that the text is fine, and leaves the box alone (${surface})`, async ($, on) => {
    const r = rig($, on, [answer({ corrected: 'This is fine.', fixes: [] })], '', surface)
    await r.submit('== This is fine.')
    await r.until(r.shows('No fixes found'), 'the card')
    const text = await r.card()
    expect(NEVER_CLAIMS_CLEAN.test(text)).toBe(false)
    expect(r.state.box).toBe('')
  })

  test(`/grammar runs the same check as == (${surface})`, async ($, on) => {
    const r = rig($, on, [PLEASE], '', surface)
    const out = await runCommand($, 'grammar', 'please check it')
    expect(JSON.stringify(out)).toContain('Checking')
    await r.until(r.shows('1 fix found'), 'the card')
    expect(r.calls.length).toBe(1)
    expect(r.seen).toEqual([])
    expect(r.state.box).toBe('Please check it')
  })

  test(`Dismiss closes the finished card (${surface})`, async ($, on) => {
    const r = rig($, on, [PLEASE], '', surface)
    await r.submit('== please check it')
    await r.until(r.shows('1 fix found'), 'the card')
    await r.press('pe-g-dismiss')
    expect(await r.card()).toBe('')
  })

  test(`a result that arrives after a newer check started is ignored (${surface})`, async ($, on) => {
    let releaseFirst!: (v: Reply) => void
    const first = new Promise<Reply>(res => (releaseFirst = res))
    const second = answer({ corrected: 'Second one', fixes: [fx('second', 'Second', 'capital', 'Sentence start.')] })
    const r = rig($, on, [first, second], '', surface)
    await r.submit('== first one')
    await r.until(() => r.calls.length === 1, 'the first call')
    await r.submit('== second one')
    await r.until(r.shows('1 fix found'), 'the second card')
    releaseFirst(answer({ corrected: 'FIRST ONE', fixes: [fx('first', 'FIRST', 'capital', 'Shouting.')] }))
    await r.settle()
    const text = await r.card()
    expect(text).toContain('Second')
    expect(text.includes('FIRST')).toBe(false)
    expect(r.state.box).toBe('Second one')
  })

  test(`a card shows "checking" while the model works, and Dismiss then ignores the late result (${surface})`, async ($, on) => {
    let release!: (v: Reply) => void
    const pending = new Promise<Reply>(res => (release = res))
    const r = rig($, on, [pending], '', surface)
    await r.submit('== please check it')
    await r.until(r.shows('checking'), 'the checking card')
    await r.press('pe-g-dismiss')
    expect(await r.card()).toBe('')
    release(PLEASE)
    await r.settle()
    expect(await r.card()).toBe('')
    expect(r.state.box).toBe('')
  })
}

// ── what == must leave alone ──────────────────────────────────────────────────────

test('== alone, or with only spaces, is dropped with a hint and calls no model', async ($, on) => {
  const r = rig($, on, [PLEASE])
  for (const text of ['==', '==   ']) {
    const out = await r.submit(text)
    expect(out.drop ?? '').toContain('Type your text')
  }
  expect(r.calls.length).toBe(0)
  expect(r.seen).toEqual([])
})

test('Chinese-only text is dropped with the reason and calls no model', async ($, on) => {
  const r = rig($, on, [PLEASE])
  const out = await r.submit('== 请把这个文件翻译成英文')
  expect(out.drop ?? '').toContain('no English')
  expect(r.calls.length).toBe(0)
})

test('text over the limit is dropped with the reason and calls no model', async ($, on) => {
  const r = rig($, on, [PLEASE])
  const out = await r.submit('== ' + 'word '.repeat(700))
  expect(out.drop ?? '').toContain('3000')
  expect(r.calls.length).toBe(0)
})

test('=== and ==x are not triggers: they reach Claude as typed', async ($, on) => {
  const r = rig($, on, [PLEASE])
  await r.submit('=== heading ===')
  await r.submit('==x')
  expect(r.seen).toEqual(['=== heading ===', '==x'])
  expect(r.calls.length).toBe(0)
})

test('0.14.0: the ++ modes left for /enhance and /goal-draft, so a ++ prompt reaches Claude as typed', async ($, on) => {
  const r = rig($, on, [PLEASE])
  for (const typed of ['++ fix the login bug', '++d fix the login bug', '++p! write the guide', '++goal make the tests pass']) await r.submit(typed)
  expect(r.seen).toEqual(['++ fix the login bug', '++d fix the login bug', '++p! write the guide', '++goal make the tests pass'])
  expect(r.calls.length).toBe(0)
})

test('a == from another plugin or a notification is not ours to answer', async ($, on) => {
  const r = rig($, on, [PLEASE])
  await $.prompt.submit({ text: '== hi there', origin: { kind: 'plugin', name: 'someone-else' }, wait: false })
  expect(r.seen).toEqual(['== hi there'])
  expect(r.calls.length).toBe(0)
})

test('OFF in /config: == reaches Claude as typed, no model is called, and /grammar says it is off', { options: { grammar: 'off' } }, async ($, on) => {
  const r = rig($, on, [PLEASE])
  await r.submit('== please check it')
  expect(r.seen).toEqual(['== please check it'])
  const out = await runCommand($, 'grammar', 'please check it')
  expect(JSON.stringify(out)).toContain('off')
  expect(r.calls.length).toBe(0)
})
