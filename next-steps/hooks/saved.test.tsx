import { expect, test } from 'claude-code/testing'
import type { Engine, TestBody } from 'claude-code/testing'

const BAND = {
  plugin: 'next-steps',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 20,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

// Over the mod's 80-character minimum, so the mod asks for next steps.
const ANSWER =
  'An answer long enough (over the 80-character minimum) that the mod asks for next steps after it.'
const USAGE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const SUGGESTIONS = [
  { label: 'run the tests', prompt: 'run the tests you just wrote' },
  { label: 'settings page', prompt: 'do the same for the settings page' },
  { label: 'update readme', prompt: 'update the README options table' },
]
const SURFACES = ['terminal', 'desktop'] as const

type Step = { label: string; prompt: string }

type Fake = { storeHops?: number; forkNeverAnswers?: boolean }

// Stands in for the engine: an in-memory $.store (slow when storeHops is
// set), a project root, a fork that answers SUGGESTIONS (or never answers),
// and a record of what was filled and toasted.
function engine(
  on: Parameters<TestBody>[1],
  seed: Record<string, unknown> = {},
  firstRoot = '/proj',
  fake: Fake = {},
) {
  let root = firstRoot
  const store = new Map<string, unknown>(Object.entries(seed))
  const filled: string[] = []
  const toasts: string[] = []
  // A slow store as a run of microtask hops: the kit's clock is mocked, so a
  // timer would wait on the test, but a race between two reads still shows.
  const pause = async () => {
    for (let hop = 0; hop < (fake.storeHops ?? 0); hop++) await Promise.resolve()
  }
  on('store.get', async (_, e) => {
    const value = store.get(e.key)
    if (fake.storeHops !== undefined) await pause()
    return { value }
  })
  on('store.set', (_, e) => (store.set(e.key, JSON.parse(JSON.stringify(e.value))), { value: undefined }))
  on('session.root', () => ({ value: root }))
  on('command.list', () => ({ value: [] }))
  on('model.fork', () =>
    fake.forkNeverAnswers
      ? new Promise<never>(() => undefined)
      : { value: { isAnswered: true as const, text: JSON.stringify(SUGGESTIONS), usage: USAGE } },
  )
  on('prompt.suggest', () => ({ isShown: true }))
  on('prompt.fill', (_, e) => (filled.push(e.text), { isFilled: true, text: e.text, cursor: e.text.length }))
  on('ui.toast', (_, e) => (toasts.push(e.text), { value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: ANSWER }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const saved = (key = `saved:${root}`) => (store.get(key) ?? []) as Step[]
  const moveTo = (next: string) => {
    root = next
  }
  return { store, filled, toasts, saved, moveTo }
}

async function turn($: Engine, id: string) {
  await $.turn.complete({ reason: 'answer', answer: ANSWER, durationMs: 1, isAborted: false, turnId: id })
}

test('a click on ☆ saves a suggestion into the saved column, on every surface', async ($, on) => {
  const fake = engine(on)
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })

  for (const surface of SURFACES) {
    // Each surface starts with nothing saved; the turn re-reads the store.
    fake.store.clear()
    await turn($, `t-${surface}`)
    const ui = await $.ui.mount({ ...BAND, surface })

    // The column is titled "next", no colon; 1-3 fill; ☆ has no key
    // (every digit is taken), a click saves.
    expect((await ui.find({ type: 'Text', text: /^next/ }))?.text).toBe('next')
    expect((await ui.find({ key: 'next-0' }))?.props.hotkey).toBe('1')
    expect((await ui.find({ key: 'star-1' }))?.props.hotkey).toBeUndefined()
    expect(await ui.find({ key: 'col-saved-0' })).toBeUndefined()
    // No tabs any more.
    expect(await ui.find({ key: 'switch-tab' })).toBeUndefined()
    expect(await ui.find({ key: 'open-saved' })).toBeUndefined()

    await ui.press({ key: 'star-1' })
    expect(fake.saved().map(step => step.prompt)).toEqual(['do the same for the settings page'])
    expect(await ui.find({ key: 'star-1' })).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: '★' }))?.text).toBe('★')
    // The saved column appears beside the suggestions, its first step on 4.
    expect((await ui.find({ key: 'saved-0' }))?.props.hotkey).toBe('4')
    expect((await ui.find({ key: 'saved-0' }))?.text).toBe('settings page')

    // Filling row 1 fills the box and saves nothing more.
    await ui.press({ key: 'next-0' })
    expect(fake.filled.at(-1)).toBe('run the tests you just wrote')
    expect(fake.saved()).toHaveLength(1)
    await ui.unmount()
  }
})

test('saved steps outlive the session, show with no suggestions, and fill on 4-9', async ($, on) => {
  const fake = engine(on, {
    'saved:/proj': [
      { label: 'commit the fix', prompt: 'commit the next-steps fix' },
      { label: 'clear test', prompt: 'add a test for /clear' },
    ],
  })
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ key: 'next-0' })).toBeUndefined()
    expect(await ui.find({ key: 'hide' })).toBeUndefined()
    expect((await ui.find({ key: 'saved-1' }))?.props.hotkey).toBe('5')

    await ui.press({ key: 'saved-1' })
    expect(fake.filled.at(-1)).toBe('add a test for /clear')
    // Filling keeps the step saved and the column drawn.
    expect(fake.saved()).toHaveLength(2)
    expect((await ui.find({ key: 'saved-1' }))?.text).toBe('clear test')
    await ui.unmount()
  }
})

test('a click on ✕ deletes that saved step and fills nothing', async ($, on) => {
  const fake = engine(on, {
    'saved:/proj': [
      { label: 'a', prompt: 'step a' },
      { label: 'b', prompt: 'step b' },
    ],
  })
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  expect((await ui.find({ key: 'del-0' }))?.props.hotkey).toBeUndefined()
  await ui.press({ key: 'del-0' })
  expect(fake.saved().map(step => step.prompt)).toEqual(['step b'])
  expect(fake.filled).toEqual([])
  // Step b moves up to key 4.
  expect((await ui.find({ key: 'saved-0' }))?.text).toBe('b')
  expect((await ui.find({ key: 'saved-0' }))?.props.hotkey).toBe('4')

  // The last one gone: the band draws nothing of its own.
  await ui.press({ key: 'del-0' })
  expect(fake.saved()).toEqual([])
  expect(await ui.find({ key: 'col-saved-0' })).toBeUndefined()
  expect(await ui.find({ key: 'saved-0' })).toBeUndefined()
  await ui.unmount()
})

test('a fourth saved step opens a second column on 7-9', async ($, on) => {
  const steps = (n: number) =>
    Array.from({ length: n }, (_, index) => ({ label: `s${index}`, prompt: `saved step ${index}` }))
  const fake = engine(on, { 'saved:/proj': steps(3) })
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })

  let ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ key: 'saved-2' }))?.props.hotkey).toBe('6')
  expect(await ui.find({ key: 'col-saved-1' })).toBeUndefined()
  await ui.unmount()

  fake.store.set('saved:/proj', steps(6))
  await turn($, 't1')
  ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ key: 'col-saved-1' })).toBeDefined()
  expect((await ui.find({ key: 'saved-3' }))?.props.hotkey).toBe('7')
  expect((await ui.find({ key: 'saved-5' }))?.props.hotkey).toBe('9')
  // Suggestions keep 1-3 and 0 beside them.
  expect((await ui.find({ key: 'next-2' }))?.props.hotkey).toBe('3')
  expect((await ui.find({ key: 'hide' }))?.props.hotkey).toBe('0')
  await ui.unmount()
})

test('a full list refuses a seventh save', async ($, on) => {
  const six = Array.from({ length: 6 }, (_, index) => ({ label: `s${index}`, prompt: `saved step ${index}` }))
  const fake = engine(on, { 'saved:/proj': six })
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
  await turn($, 't1')
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  await ui.press({ key: 'star-0' })
  expect(fake.toasts).toEqual(['saved is full (6): delete one first'])
  expect(fake.saved()).toHaveLength(6)
  await ui.unmount()
})

test('saved steps are kept per project', async ($, on) => {
  const fake = engine(on, {}, '/proj-a')
  await $.session.start({ cwd: '/proj-a', surface: 'terminal', isInteractive: true })
  await turn($, 't1')
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'star-2' })
  expect(fake.saved('saved:/proj-a').map(step => step.prompt)).toEqual(['update the README options table'])
  await ui.unmount()

  // The session moves to another project (/cd): the next turn re-reads, and
  // that project's list is empty and saves land under its own key.
  fake.moveTo('/proj-b')
  await turn($, 't2')
  const other = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await other.find({ key: 'saved-0' })).toBeUndefined()
  await other.press({ key: 'star-0' })
  expect(fake.saved('saved:/proj-b').map(step => step.prompt)).toEqual(['run the tests you just wrote'])
  expect(fake.saved('saved:/proj-a').map(step => step.prompt)).toEqual(['update the README options table'])
  await other.unmount()
})

// prompt.change is an event the engine raises, not a call on $, so the kit's
// Engine type leaves it out; the kit raises it all the same.
type RaisesChange = { change: (e: { text: string; cursor: number; origin: { kind: string } }) => Promise<unknown> }

test('a draft in the box shows how to reach the band', async ($, on) => {
  engine(on)
  const prompt = $.prompt as unknown as RaisesChange
  on('prompt.change', (_, e) => ({ text: e.text, cursor: e.cursor }))
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
  await turn($, 't1')

  await prompt.change({ text: 'half a thought', cursor: 14, origin: { kind: 'history' } })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /draft in box/ }))?.text).toBe(
    'draft in box: click a row, or ctrl+x tab first',
  )
  await ui.unmount()

  await prompt.change({ text: '', cursor: 0, origin: { kind: 'clear' } })
  const empty = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await empty.find({ type: 'Text', text: /draft in box/ })).toBeUndefined()
  await empty.unmount()
})

test('0 hides the suggestions and keeps the saved column', async ($, on) => {
  engine(on, { 'saved:/proj': [{ label: 'kept', prompt: 'a kept step' }] })
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
  await turn($, 't1')
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  await ui.press({ key: 'hide' })
  expect(await ui.find({ key: 'next-0' })).toBeUndefined()
  expect((await ui.find({ key: 'saved-0' }))?.props.hotkey).toBe('4')
  await ui.unmount()
})

test('quick presses keep every change, with a slow store', async ($, on) => {
  const fake = engine(on, { 'saved:/proj': [] }, '/proj', { storeHops: 30 })
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
  await turn($, 't1')
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  await Promise.all([ui.press({ key: 'star-0' }), ui.press({ key: 'star-1' })])
  expect(fake.saved().map(step => step.prompt)).toEqual([
    'run the tests you just wrote',
    'do the same for the settings page',
  ])

  fake.store.set('saved:/proj', [
    { label: 'x', prompt: 'x' },
    { label: 'y', prompt: 'y' },
    { label: 'z', prompt: 'z' },
  ])
  await turn($, 't2')
  // The turn's re-read of the slow store runs detached: wait until the band
  // draws the new list, so both clicks land on x and y.
  for (let hop = 0; hop < 2000 && (await ui.find({ key: 'saved-2' }))?.text !== 'z'; hop++) await Promise.resolve()
  expect((await ui.find({ key: 'saved-2' }))?.text).toBe('z')
  await Promise.all([ui.press({ key: 'del-0' }), ui.press({ key: 'del-1' })])
  expect(fake.saved().map(step => step.prompt)).toEqual(['z'])
  await ui.unmount()
})

test('saved steps stay in reach while suggestions load', async ($, on) => {
  const fake = engine(on, { 'saved:/proj': [{ label: 'kept', prompt: 'a kept step' }] }, '/proj', {
    forkNeverAnswers: true,
  })
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
  await turn($, 't1')
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  expect((await ui.find({ type: 'Text', text: /^next/ }))?.text).toBe('next…')
  expect((await ui.find({ key: 'saved-0' }))?.props.hotkey).toBe('4')
  await ui.press({ key: 'saved-0' })
  expect(fake.filled).toEqual(['a kept step'])
  await ui.unmount()
})

test('a list another session filled refuses the save with a message', async ($, on) => {
  const fake = engine(on)
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
  await turn($, 't1')
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  // Another session fills the list after this one last read it.
  const six = Array.from({ length: 6 }, (_, index) => ({ label: `o${index}`, prompt: `other ${index}` }))
  fake.store.set('saved:/proj', six)
  await ui.press({ key: 'star-0' })
  expect(fake.toasts).toEqual(['saved is full (6): delete one first'])
  expect(fake.saved().map(step => step.prompt)).toEqual(six.map(step => step.prompt))
  await ui.unmount()
})

test('labels are cut to fit three columns in the band', async ($, on) => {
  const long = 'a saved step with a label far too long for one of three columns'
  const four = Array.from({ length: 4 }, (_, index) => ({ label: `${long} ${index}`, prompt: `long ${index}` }))
  engine(on, { 'saved:/proj': four })
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
  await turn($, 't1')
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  // 80 cells, three columns, two gaps of 3: 24 each, 19 for the label.
  const label = (await ui.find({ key: 'saved-3' }))?.text ?? ''
  expect(label.endsWith('…')).toBe(true)
  expect([...label].length).toBe(19)
  await ui.unmount()
})

test('/cd shows the new project saved steps at once', async ($, on) => {
  const fake = engine(
    on,
    {
      'saved:/proj-a': [{ label: 'from a', prompt: 'project a step' }],
      'saved:/proj-b': [
        { label: 'from b', prompt: 'project b step' },
        { label: 'also b', prompt: 'another b step' },
      ],
    },
    '/proj-a',
  )
  on('classic.CwdChanged', () => ({}))
  await $.session.start({ cwd: '/proj-a', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ key: 'saved-0' }))?.text).toBe('from a')

  // No turn runs: the directory change alone brings project b's list.
  fake.moveTo('/proj-b')
  await $.classic.CwdChanged({ old_cwd: '/proj-a', new_cwd: '/proj-b' })
  expect((await ui.find({ key: 'saved-0' }))?.text).toBe('from b')
  expect((await ui.find({ key: 'saved-1' }))?.text).toBe('also b')

  await ui.press({ key: 'saved-0' })
  expect(fake.filled).toEqual(['project b step'])
  expect(fake.saved('saved:/proj-b')).toHaveLength(2)
  await ui.unmount()
})
