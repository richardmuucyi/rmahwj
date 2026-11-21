import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const posix = (p: string) => p.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/')
const NOW = Date.UTC(2026, 9, 31, 9)
const FILE = '/home/me/.claude/assumptions/-home-me-vault.jsonl'
const LOG = 'mcp__assumptions__log_assumption'
const BAND = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 12,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 12 },
  view: {},
}
const PANE_PROPS = {
  title: 'Assumptions',
  isFocused: true,
  bodyColumns: 80,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
}
const COMPOSE = { model: 'claude-opus-4-1', promptModel: 'claude-opus-4-1', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] } as never

type Rig = { files: Map<string, string>; id: string; sent: string[]; runs: string[][]; filled: string[] }

/** The engine beneath the plugin: a home folder in memory, a session id the test can change, a git repo one level up. */
function bottom(on: On): Rig {
  const r: Rig = { files: new Map(), id: 's1', sent: [], runs: [], filled: [] }
  on('env.get', (_$, e) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }))
  on('session.id', () => ({ value: r.id }))
  on('session.root', () => ({ value: '/home/me/vault/sub' }))
  on('process.run', (_$, e) => {
    r.runs.push([...e.argv])
    const top = e.argv.join(' ') === 'git rev-parse --show-toplevel'
    return { value: { exitCode: top ? 0 : 1, stdout: top ? '/home/me/vault\n' : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.write', (_$, e) => {
    r.files.set(posix(e.path), e.text)
    return { value: undefined }
  })
  on('fs.read', (_$, e) => {
    const text = r.files.get(posix(e.path))
    return text === undefined ? { deny: 'ENOENT' } : { value: text }
  })
  on('tool.register', () => ({ value: undefined as never }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('prompt.compose', () => ({ sections: [] }))
  on('prompt.submit', (_$, e) => {
    r.sent.push(e.text)
    return { text: e.text }
  })
  on('prompt.fill', (_$, e) => {
    r.filled.push(e.text)
    return { ...e, isFilled: true }
  })
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine-own" />
  })
  on('ui.close', () => ({ value: undefined }))
  on('tool.call', () => ({ result: 'ok' }))
  return r
}

type Section = { id: string; text: string }
const sections = async ($: { prompt: { compose: (a: never) => Promise<{ sections: readonly Section[] }> } }) =>
  (await $.prompt.compose(COMPOSE)).sections
const lines = (r: Rig) => (r.files.get(FILE) ?? '').split('\n').filter(l => l !== '')

test('verdicts: reviewed assumptions reach the model as settled, open ones do not', async ($, on) => {
  mock.clock(on, { now: NOW })
  bottom(on)
  const log = (assumption: string) => $.tool.call({ tool: LOG, assumption, why: 'not stated' } as never)
  await log('Use British spelling')
  await log('Output goes in the docs folder')
  await log('Keep the old tests')

  expect((await sections($)).some(s => s.id === 'assumptions:verdicts')).toBe(false)

  let band = await $.ui.mount({ plugin: 'assumptions', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  await band.press({ key: 'as-card-right' })
  await band.unmount()
  band = await $.ui.mount({ plugin: 'assumptions', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  await band.press({ key: 'as-card-fix' })
  await band.unmount()
  band = await $.ui.mount({ plugin: 'assumptions', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  await band.input({ key: 'as-card-fix-input', text: 'Put it in docs/generated' })
  await band.unmount()

  const v = (await sections($)).find(s => s.id === 'assumptions:verdicts')
  expect(v?.text).toContain('## Assumption verdicts this session')
  expect(v?.text).toContain('- A1 right: Use British spelling')
  expect(v?.text).toContain('- A2 wrong: Output goes in the docs folder. Correct: Put it in docs/generated')
  expect(v?.text).not.toContain('A3')
  expect(v?.text).not.toContain('Keep the old tests')
})

test('persistence: a correction is kept per repo and shown to later sessions only', async ($, on) => {
  mock.clock(on, { now: NOW })
  const r = bottom(on)
  const guidance = async () => (await sections($)).find(s => s.id === 'assumptions:guidance')?.text ?? ''

  await $.session.start({ cwd: '/home/me/vault/sub', surface: 'terminal', isInteractive: true })
  expect(r.runs).toContainEqual(['git', 'rev-parse', '--show-toplevel'])
  await $.prompt.submit({ text: 'Write the release notes', origin: { kind: 'composer' }, wait: false })
  await $.prompt.submit({ text: '/compact', origin: { kind: 'composer' }, wait: false })
  await $.tool.call({ tool: LOG, assumption: 'Use British spelling', why: 'the README does' } as never)
  const band = await $.ui.mount({ plugin: 'assumptions', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  await band.press({ key: 'as-card-fix' })
  await band.unmount()
  const fixing = await $.ui.mount({ plugin: 'assumptions', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  await fixing.input({ key: 'as-card-fix-input', text: 'Use American spelling' })
  await fixing.unmount()

  expect(lines(r)).toHaveLength(1)
  expect(JSON.parse(lines(r)[0]!)).toEqual({
    at: NOW,
    session: 's1',
    repo: '/home/me/vault',
    id: 1,
    text: 'Use British spelling',
    why: 'the README does',
    task: 'Write the release notes',
    correction: 'Use American spelling',
  })
  expect(await guidance()).not.toContain('Past corrections')

  // A module reload in the same session re-runs session.start: its own corrections stay out.
  await $.session.start({ cwd: '/home/me/vault/sub', surface: 'terminal', isInteractive: true })
  expect(await guidance()).not.toContain('Past corrections')

  r.id = 's2'
  await $.session.start({ cwd: '/home/me/vault/sub', surface: 'terminal', isInteractive: true })
  const g = await guidance()
  expect(g).toContain('## Past corrections in this repo')
  expect(g).toContain('- Assumed: Use British spelling. Correct: Use American spelling (2026-10-31, task: "Write the release notes")')
  expect(g).toContain('Apply one only when the current task is the same kind of work')
})

test('persistence: the model sees the last 10 from other sessions; the file keeps the newest 100', async ($, on) => {
  mock.clock(on, { now: NOW })
  const r = bottom(on)
  const seed = (i: number, session: string) => JSON.stringify({ at: NOW, session, repo: '/home/me/vault', id: i, text: `T${i}`, correction: `C${i}` })
  r.files.set(
    FILE,
    [...Array.from({ length: 120 }, (_, i) => seed(i + 1, 'old')), 'not json', seed(121, 's3'), seed(122, 's3')].join('\n'),
  )
  r.id = 's3'
  await $.session.start({ cwd: '/home/me/vault/sub', surface: 'terminal', isInteractive: true })
  const g = (await sections($)).find(s => s.id === 'assumptions:guidance')?.text ?? ''
  const shown = g.split('\n').filter(l => l.startsWith('- Assumed: '))
  expect(shown).toHaveLength(10)
  expect(shown[0]).toContain('T111.')
  expect(shown[9]).toContain('T120.')
  expect(g).not.toContain('T121')

  await $.tool.call({ tool: LOG, assumption: 'Ship on Friday' } as never)
  await $.prompt.submit({ text: 'Correction to assumption A1 ("Ship on Friday"): Ship on Monday', origin: { kind: 'composer' }, wait: false })
  const kept = lines(r)
  expect(kept).toHaveLength(100)
  expect(JSON.parse(kept[99]!).correction).toBe('Ship on Monday')
  expect(kept.includes(seed(122, 's3'))).toBe(true)
  expect(kept.includes(seed(25, 'old'))).toBe(true)
  expect(kept.includes(seed(24, 'old'))).toBe(false)
})

test('steps: the card and the panel show how much work was built on an assumption', async ($, on) => {
  mock.clock(on, { now: NOW })
  bottom(on)
  const bash = () => $.tool.call({ tool: 'Bash', command: 'ls' } as never)
  const card = async () => {
    const band = await $.ui.mount({ plugin: 'assumptions', surface: 'terminal', component: 'AbovePrompt', props: BAND })
    const text = (await band.find({ key: 'as-card' }))?.text.replace(/\s+/g, ' ') ?? ''
    return { band, text }
  }

  expect(JSON.stringify(await $.tool.call({ tool: LOG, assumption: 'Use British spelling' } as never))).toContain('A1')
  let c = await card()
  expect(c.text).not.toContain('built on')
  await c.band.unmount()

  await bash()
  await bash()
  await bash()
  expect(JSON.stringify(await $.tool.call({ tool: LOG, assumption: 'Output goes in docs' } as never))).toContain('A2')
  c = await card()
  expect(c.text).toContain('Use British spelling')
  expect(c.text).toContain('· built on 3 steps')
  await c.band.unmount()

  const pane = await $.ui.mount({ plugin: 'assumptions', surface: 'terminal', component: 'Pane', requestId: 'assumptions', props: PANE_PROPS })
  expect(await pane.find({ type: 'Text', text: /A1 +Use British spelling.*built on 3 steps/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /A2 +Output goes in docs.*built on/ })).toBeUndefined()
  await pane.unmount()

  await bash()
  c = await card()
  await c.band.press({ key: 'as-card-right' })
  await c.band.unmount()
  c = await card()
  expect(c.text).toContain('Output goes in docs')
  expect(c.text).toMatch(/· built on 1 step(?!s)/)
  await c.band.unmount()
})

test('typed correction: the pre-filled prompt, completed by hand, is recorded and kept', async ($, on) => {
  mock.clock(on, { now: NOW })
  const r = bottom(on)
  await $.session.start({ cwd: '/home/me/vault/sub', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: LOG, assumption: 'Output goes in the docs folder' } as never)
  await $.tool.call({ tool: LOG, assumption: 'Keep the old tests' } as never)
  const verdict = async () => (await sections($)).find(s => s.id === 'assumptions:verdicts')?.text ?? ''

  // What Fix pre-fills where no field is drawn, completed by the person.
  const typed = 'Correction to assumption A1 ("Output goes in the docs folder"): Put it in docs/generated'
  await $.prompt.submit({ text: typed, origin: { kind: 'bridge' }, wait: false })
  expect(r.sent).toEqual([typed])
  expect(await verdict()).toContain('- A1 wrong: Output goes in the docs folder. Correct: Put it in docs/generated')
  expect(await verdict()).not.toContain('A2')
  expect(lines(r).map(l => JSON.parse(l).correction)).toEqual(['Put it in docs/generated'])

  const band = await $.ui.mount({ plugin: 'assumptions', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  const card = (await band.find({ key: 'as-card' }))?.text ?? ''
  expect(card).toContain('Keep the old tests')
  expect(card).toContain('1/1')
  await band.unmount()

  // A correction for an id that does not exist, or an ordinary prompt, changes nothing.
  await $.prompt.submit({ text: 'Correction to assumption A9 ("x"): y', origin: { kind: 'bridge' }, wait: false })
  await $.prompt.submit({ text: 'Please carry on', origin: { kind: 'composer' }, wait: false })
  expect(lines(r)).toHaveLength(1)
  expect(r.sent).toHaveLength(3)
})

test('mobile: Fix pre-fills the prompt on the card and in the panel, and the typed fix is kept', async ($, on) => {
  mock.clock(on, { now: NOW })
  const r = bottom(on)
  await $.session.start({ cwd: '/home/me/vault/sub', surface: 'mobile', isInteractive: true })
  await $.tool.call({ tool: LOG, assumption: 'Ship on Friday' } as never)
  await $.tool.call({ tool: LOG, assumption: 'Use tabs' } as never)

  const card = await $.ui.mount({ plugin: 'assumptions', surface: 'mobile', component: 'AbovePrompt', props: BAND })
  await card.press({ key: 'as-card-fix' })
  await card.unmount()
  expect(r.filled).toEqual(['Correction to assumption A1 ("Ship on Friday"): '])
  const after = await $.ui.mount({ plugin: 'assumptions', surface: 'mobile', component: 'AbovePrompt', props: BAND })
  const text = (await after.find({ key: 'as-card' }))?.text.replace(/\s+/g, ' ') ?? ''
  expect(text).not.toContain('FIXING')
  expect(text).toContain('Use tabs')
  await after.unmount()

  const pane = await $.ui.mount({ plugin: 'assumptions', surface: 'mobile', component: 'Pane', requestId: 'assumptions', props: PANE_PROPS })
  await pane.press({ key: 'as-wrong-2' })
  expect(r.filled[1]).toBe('Correction to assumption A2 ("Use tabs"): ')
  expect(await pane.find({ key: 'as-fix-2' })).toBeUndefined()
  await pane.unmount()

  await $.prompt.submit({ text: `${r.filled[0]}Ship on Monday`, origin: { kind: 'bridge' }, wait: false })
  const v = (await sections($)).find(s => s.id === 'assumptions:verdicts')?.text ?? ''
  expect(v).toContain('- A1 wrong: Ship on Friday. Correct: Ship on Monday')
  expect(v).toContain('- A2 wrong (correction sent in chat): Use tabs')
  expect(JSON.parse(lines(r)[0]!).correction).toBe('Ship on Monday')
})

test('skip all: closes the open low-impact ones, keeps high impact, tells Claude nothing, and Reopen brings one back', async ($, on) => {
  mock.clock(on, { now: NOW })
  bottom(on)
  const log = (assumption: string, impact?: 'high') => $.tool.call({ tool: LOG, assumption, why: 'a reason', impact } as never)
  await log('Use British spelling')
  await log('Delete the old build folder', 'high')
  await log('Output goes in docs')
  await log('Keep the old tests')
  const card = async () => {
    const band = await $.ui.mount({ plugin: 'assumptions', surface: 'terminal', component: 'AbovePrompt', props: BAND })
    return { band, text: (await band.find({ key: 'as-card' }))?.text.replace(/\s+/g, ' ') ?? '' }
  }

  // The high-impact one leads, shown in full with its reason; Skip all counts only the low ones.
  let c = await card()
  expect(c.text).toContain('Delete the old build folder')
  expect(c.text).toContain('why: a reason')
  expect(c.text).toContain('Skip all 3')
  await c.band.press({ key: 'as-card-skip-all' })
  await c.band.unmount()

  c = await card()
  expect(c.text).toContain('⚠ ASSUMPTION 1/1')
  expect(await c.band.find({ key: 'as-card-skip-all' })).toBeUndefined()
  await c.band.unmount()
  expect((await sections($)).some(s => s.id === 'assumptions:verdicts')).toBe(false)

  // The panel lists the skipped ones; Reopen puts one back on the card.
  const pane = await $.ui.mount({ plugin: 'assumptions', surface: 'terminal', component: 'Pane', requestId: 'assumptions', props: PANE_PROPS })
  expect(await pane.find({ type: 'Text', text: /REVIEWED 3/ })).toBeDefined()
  expect(await pane.find({ key: 'as-skip-all' })).toBeUndefined()
  await pane.press({ key: 'as-toggle-reviewed' })
  expect(await pane.find({ type: 'Text', text: /A3 +Output goes in docs.*– skipped/ })).toBeDefined()
  await pane.press({ key: 'as-reopen-3' })
  await pane.unmount()
  c = await card()
  expect(c.text).toContain('1/2')
  await c.band.press({ key: 'as-card-right' })
  await c.band.unmount()
  c = await card()
  expect(c.text).toContain('Output goes in docs')
  await c.band.unmount()
  const v = (await sections($)).find(s => s.id === 'assumptions:verdicts')?.text ?? ''
  expect(v).toContain('- A2 right: Delete the old build folder')
  expect(v).not.toContain('A1')
  expect(v).not.toContain('A4')
})

test('skip all in the panel footer: shown at two or more, and closes only low-impact ones', async ($, on) => {
  mock.clock(on, { now: NOW })
  bottom(on)
  await $.tool.call({ tool: LOG, assumption: 'Use tabs' } as never)
  await $.tool.call({ tool: LOG, assumption: 'Drop the table', impact: 'high' } as never)
  let pane = await $.ui.mount({ plugin: 'assumptions', surface: 'terminal', component: 'Pane', requestId: 'assumptions', props: PANE_PROPS })
  expect(await pane.find({ key: 'as-skip-all' })).toBeUndefined()
  await pane.unmount()
  await $.tool.call({ tool: LOG, assumption: 'Name it notes.md' } as never)
  pane = await $.ui.mount({ plugin: 'assumptions', surface: 'terminal', component: 'Pane', requestId: 'assumptions', props: PANE_PROPS })
  expect(await pane.find({ type: 'Text', text: /Skip all 2/ })).toBeDefined()
  await pane.press({ key: 'as-skip-all' })
  expect(await pane.find({ type: 'Text', text: /TO REVIEW 1/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /A2 +Drop the table/ })).toBeDefined()
  await pane.unmount()
})

test('stats: one line per session with counts only, replaced on change, other sessions kept', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const r = bottom(on)
  const STATS = '/home/me/.claude/assumptions/stats.jsonl'
  r.files.set(STATS, `${JSON.stringify({ at: 1, session: 'old', repo: '/x', logged: 5, right: 5, wrong: 0, skipped: 0, open: 0, high: 0 })}\n`)
  await $.session.start({ cwd: '/home/me/vault/sub', surface: 'terminal', isInteractive: true })
  await clock.advance(2_000)
  // Nothing logged yet: no line for this session.
  expect((r.files.get(STATS) ?? '').split('\n').filter(l => l !== '')).toHaveLength(1)

  await $.tool.call({ tool: LOG, assumption: 'Secret plan text', impact: 'high' } as never)
  await $.tool.call({ tool: LOG, assumption: 'Use tabs' } as never)
  await $.tool.call({ tool: LOG, assumption: 'Use spaces' } as never)
  await clock.advance(2_000)
  const band = await $.ui.mount({ plugin: 'assumptions', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  await band.press({ key: 'as-card-right' })
  await band.unmount()
  const again = await $.ui.mount({ plugin: 'assumptions', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  await again.press({ key: 'as-card-skip' })
  await again.unmount()
  await clock.advance(2_000)

  const text = r.files.get(STATS) ?? ''
  expect(text).not.toContain('Secret plan')
  const rows = text.split('\n').filter(l => l !== '').map(l => JSON.parse(l))
  expect(rows).toHaveLength(2)
  expect(rows[0].session).toBe('old')
  expect(rows[1]).toMatchObject({ session: 's1', repo: '/home/me/vault', logged: 3, right: 1, wrong: 0, skipped: 1, open: 1, high: 1 })
})

test('typed correction: an edited or dropped quote is still recorded', async ($, on) => {
  mock.clock(on, { now: NOW })
  const r = bottom(on)
  await $.session.start({ cwd: '/home/me/vault/sub', surface: 'mobile', isInteractive: true })
  await $.tool.call({ tool: LOG, assumption: 'Ship on Friday' } as never)
  await $.tool.call({ tool: LOG, assumption: 'Use tabs' } as never)
  await $.prompt.submit({ text: 'Correction to assumption A1 (ship friday): Ship on Monday', origin: { kind: 'bridge' }, wait: false })
  await $.prompt.submit({ text: 'Correction to assumption A2: Use spaces', origin: { kind: 'bridge' }, wait: false })
  expect(lines(r).map(l => JSON.parse(l).correction)).toEqual(['Ship on Monday', 'Use spaces'])
})

test('guidance: log before acting, and leave out defaults nobody would question', async ($, on) => {
  mock.clock(on, { now: NOW })
  bottom(on)
  const g = (await sections($)).find(s => s.id === 'assumptions:guidance')?.text ?? ''
  expect(g).toContain('Log the assumption before the tool call that acts on it.')
  expect(g).toContain('Do not log a default the user would not question')
})

test('stats survive Clear history, and a new assumption after Skip all shows on the card', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const r = bottom(on)
  const STATS = '/home/me/.claude/assumptions/stats.jsonl'
  await $.session.start({ cwd: '/home/me/vault/sub', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: LOG, assumption: 'Use tabs' } as never)
  await $.tool.call({ tool: LOG, assumption: 'Use spaces' } as never)
  let band = await $.ui.mount({ plugin: 'assumptions', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  await band.press({ key: 'as-card-skip-all' })
  await band.unmount()

  await $.tool.call({ tool: LOG, assumption: 'Name it notes.md' } as never)
  band = await $.ui.mount({ plugin: 'assumptions', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect((await band.find({ key: 'as-card' }))?.text).toContain('Name it notes.md')
  await band.unmount()

  const pane = await $.ui.mount({ plugin: 'assumptions', surface: 'terminal', component: 'Pane', requestId: 'assumptions', props: PANE_PROPS })
  await pane.press({ key: 'as-clear' })
  await pane.unmount()
  await $.tool.call({ tool: LOG, assumption: 'Ship on Monday' } as never)
  await clock.advance(2_000)
  const row = JSON.parse((r.files.get(STATS) ?? '').trim().split('\n').at(-1)!)
  expect(row).toMatchObject({ session: 's1', logged: 4, skipped: 2, open: 2 })
})
