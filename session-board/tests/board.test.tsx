import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

/** On Windows the engine turns /home/me/x into C:\home\me\x. The tests keep POSIX paths, so a test reads the same on both. */
const posix = (p: string) => p.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/')

const PANE_PROPS = {
  title: 'Sessions',
  isFocused: false,
  bodyColumns: 60,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
}
const DIR = '/home/me/.claude/session-board'
const card = (over: Record<string, unknown>) =>
  JSON.stringify({ changedAt: 1_000_000, seenAt: 1_000_000, ...over })

const BAND = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 130,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
}

/** The coloured blocks of a drawn element, left to right: [background, text, text colour]. */
function chipsOf(node: unknown, out: [string, string, string][] = []): [string, string, string][] {
  const n = node as { props?: { backgroundColor?: string; color?: string }; children?: unknown[] } | string | undefined
  if (n === undefined || typeof n === 'string') return out
  if (n.props?.backgroundColor) out.push([n.props.backgroundColor, (n.children ?? []).filter(c => typeof c === 'string').join(''), n.props.color ?? ''])
  else for (const c of n.children ?? []) chipsOf(c, out)
  return out
}

/** The weight of each coloured block, left to right: [text, bold]. Labels are plain, the values beside them bold. */
function weightsOf(node: unknown, out: [string, boolean][] = []): [string, boolean][] {
  const n = node as { props?: { backgroundColor?: string; bold?: boolean }; children?: unknown[] } | string | undefined
  if (n === undefined || typeof n === 'string') return out
  if (n.props?.backgroundColor) out.push([(n.children ?? []).filter(c => typeof c === 'string').join(''), n.props.bold === true])
  else for (const c of n.children ?? []) weightsOf(c, out)
  return out
}

/** What the strip above the prompt says, whitespace folded; '' when it is not drawn. */
async function strip($: Engine, surface: 'terminal' | 'desktop'): Promise<string> {
  const band = await $.ui.mount({ plugin: 'session-board', surface, component: 'AbovePrompt', props: BAND })
  const found = await band.find({ key: 'sb-strip' })
  // The engine's own content stays beneath it.
  expect(await band.find({ key: 'engine-own' })).toBeDefined()
  await band.unmount()
  return found ? found.text.replace(/\s+/g, ' ').trim() : ''
}

/** The engine beneath the plugin: a shared folder in memory, a session id the test can change. */
function bottom(on: On, files: Map<string, string>, opts: { id: { value: string }; statuses: (string | undefined)[]; root?: string }) {
  on('env.get', (_$, e) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }))
  on('session.id', () => ({ value: opts.id.value }))
  on('session.root', () => ({ value: opts.root ?? '/home/me/vault' }))
  on('fs.write', (_$, e) => {
    files.set(posix(e.path), e.text)
    return { value: undefined }
  })
  on('fs.read', (_$, e) => {
    const text = files.get(posix(e.path))
    return text === undefined ? { deny: 'ENOENT' } : { value: text }
  })
  on('fs.list', (_$, e) => ({
    value: [...files.keys()]
      .filter(k => k.startsWith(`${posix(e.path)}/`))
      .map(k => ({ name: k.slice(posix(e.path).length + 1), kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })),
  }))
  on('ui.status', (_$, e) => {
    opts.statuses.push(e.text)
    return { value: undefined }
  })
  on('agent.list', () => ({ value: [] }))
  // The engine's own drawing above the prompt: a placeholder the strip must keep.
  on('ui.render', ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box key="engine-own">
        <Text>engine</Text>
      </Box>
    )
  })
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('tool.check', () => ({ decision: 'ask' as const }))
  on('classic.Stop', () => ({}))
  on('classic.SubagentStop', () => ({}))
}

const own = (files: Map<string, string>, id = 'me') => JSON.parse(files.get(`${DIR}/${id}.json`) ?? '{}') as Record<string, unknown>

async function endTurn($: Engine, turnId: string, background: { id: string; type: string; description: string }[]) {
  await $.classic.Stop({
    stop_hook_active: false,
    background_tasks: background.map(b => ({ ...b, status: 'running' })),
    session_crons: [],
  })
  await $.turn.complete({ answer: 'Done.', durationMs: 1000, isAborted: false, turnId, reason: 'answer' })
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`board splits this folder from other folders, from facts only (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const files = new Map<string, string>()
    const statuses: (string | undefined)[] = []
    // A card written by an older version, with a task report as "Asked".
    files.set(`${DIR}/oldver.json`, card({
      id: 'oldver', folder: '/home/me/other', project: 'other',
      asked: '<task-notification> <task-id>ks</task-id> <status>completed</status>',
      status: 'stopped',
    }))
    // Another session in this folder, mid-task.
    files.set(`${DIR}/peer.json`, card({
      id: 'peer', folder: '/home/me/vault', project: 'vault', asked: 'Tidy the inbox',
      status: 'working', activity: 'Editing Waiting.md',
    }))
    // A session in another folder, waiting for a permission.
    files.set(`${DIR}/far.json`, card({
      id: 'far', folder: '/home/me/iams-ups', project: 'iams-ups', asked: 'Fix the deploy script',
      status: 'needs-you', activity: 'Approve: Run the deploy',
    }))
    // Two empty sessions: open, nothing asked. They must not be counted.
    files.set(`${DIR}/empty1.json`, card({ id: 'empty1', folder: '/home/me/vault', project: 'vault', asked: '', status: 'open' }))
    files.set(`${DIR}/empty2.json`, card({ id: 'empty2', folder: '/home/me/iams-ups', project: 'iams-ups', asked: '', status: 'open' }))
    bottom(on, files, { id: { value: 'me' }, statuses })
    let permission: Record<string, unknown> | undefined
    let decidedBeneath = false
    let expectActivity: string | undefined
    let mode: string | undefined
    on('classic.PermissionRequest', () => (decidedBeneath ? { decision: { behavior: 'allow' as const } } : {}))
    // The tool runs beneath the plugin: where a dialog opens, it opens inside the call.
    on('tool.call', async () => {
      if (permission) {
        await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: permission, permission_mode: mode })
        const noDialog = decidedBeneath || mode === 'auto'
        expect(String(own(files).status)).toBe(noDialog ? 'working' : 'needs-you')
        if (expectActivity) expect(String(own(files).activity)).toBe(expectActivity)
      }
      return { result: 'ok' }
    })

    await $.session.start({ cwd: '/home/me/vault', surface, isInteractive: true })
    await $.prompt.submit({ text: 'Build the board', origin: { kind: 'composer' }, wait: false })
    // A background task's report arrives as a prompt too: it is not "Asked".
    await $.prompt.submit({
      text: '<task-notification><task-id>bj8</task-id></task-notification>',
      origin: { kind: 'task-notification' },
      wait: false,
    })
    expect(files.get(`${DIR}/me.json`)).toContain('"asked":"Build the board"')
    // The desktop app may deliver the same report under its own origin.
    await $.prompt.submit({
      text: '<task-notification> <task-id>kw7</task-id> <status>completed</status></task-notification>',
      origin: { kind: 'sdk' },
      wait: false,
    })
    expect(files.get(`${DIR}/me.json`)).toContain('"asked":"Build the board"')
    await $.turn.start({ text: 'Build the board', turnId: 't1' })
    await $.tool.call({ tool: 'Edit', file_path: '/home/me/vault/hooks/register.tsx', old_string: 'a', new_string: 'b' })
    // A tool the rules leave open but that is approved without asking: no dialog, no "needs you".
    await $.tool.check({ tool: 'Bash', input: { command: 'ls', description: 'List files' } })
    expect(files.get(`${DIR}/me.json`)).not.toContain('needs-you')

    // A real permission dialog, inside its call: needs you while it is open, not after.
    permission = { command: 'rm -r build', description: 'Delete the build folder' }
    await $.tool.call({ tool: 'Bash', command: 'rm -r build', description: 'Delete the build folder' })
    expect(String(own(files).status)).toBe('working')
    // A request whose input says nothing useful never reads as a bare "Running".
    permission = {}
    expectActivity = 'Approve: Running a command'
    await $.tool.call({ tool: 'Bash', command: '' })
    expectActivity = undefined
    // A request another hook beneath settles shows no dialog: never "needs you".
    decidedBeneath = true
    permission = { command: 'npm test' }
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    decidedBeneath = false
    // Auto mode: the classifier decides, no dialog is shown: never "needs you".
    mode = 'auto'
    permission = { command: 'npm run build' }
    await $.tool.call({ tool: 'Bash', command: 'npm run build' })
    mode = undefined
    permission = undefined
    await $.tool.call({ tool: 'Edit', file_path: '/home/me/vault/hooks/register.tsx', old_string: 'a', new_string: 'b' })

    await clock.advance(5_000)

    // Status line: alerts about other sessions only. A working peer and the
    // empty sessions are not alerts; this session never appears.
    expect(await strip($, surface)).toBe('vault ◔ Working │ others ? iams-ups ☰ All ›')
    // Every chip of the row sits on true black: the folder label and "others" are dim text, a status is its colour as the
    // text (so a status matches the labels). The quiet sessions are not drawn (since the 2026-11-21 strip).
    const band = await $.ui.mount({ plugin: 'session-board', surface, component: 'AbovePrompt', props: BAND })
    const drawn = await band.find({ key: 'sb-strip' })
    expect(chipsOf(drawn)).toEqual([
      ['#000000', ' vault    ', '#8B949E'], ['#000000', ' ◔ Working ', 'cyan'], ['#000000', ' others ', '#8B949E'],
      ['#000000', ' ? iams-ups ', 'yellow'],
    ])
    // a dim "│" divides the two groups, one space either side of the gap
    expect(drawn!.text).toContain('Working  │  others')
    // dim labels, bold values: the label recedes and the value beside it is what stands out
    expect(weightsOf(drawn)).toEqual([
      [' vault    ', false], [' ◔ Working ', true], [' others ', false], [' ? iams-ups ', true],
    ])
    // no emoji: an emoji ignores the colour it is given, so the strip draws text glyphs
    expect(drawn!.text).not.toMatch(/[⏳⌛❓🤖⏸⏹]/u)
    // the link is the lighter blue
    expect(JSON.stringify(await band.find({ key: 'sb-strip-open' }))).toContain('#7AA2F7')
    // Every chip touches the next: only the two paddings sit between two of them (no gap), in both groups.
    expect(drawn!.text).toContain('vault     ◔ Working')
    expect(drawn!.text).not.toContain('vault      ')
    // the status glyph is in cell 11: the same cell as the Actions button of the context row below it (guard.picker test)
    expect(drawn!.text.indexOf('◔')).toBe(11)
    expect(drawn!.text).toContain('others  ? iams-ups    ☰ All ›')
    await band.unmount()
    // Nothing is left in the status line: the strip replaces it.
    expect(statuses.filter(s => s !== undefined)).toEqual([])
    // Own card says what it is doing, from the tool call itself.
    expect(files.get(`${DIR}/me.json`)).toContain('Editing register.tsx')

    const pane = await $.ui.mount({
      plugin: 'session-board', surface, component: 'Pane', requestId: 'session-board', props: PANE_PROPS,
    })
    const texts = (await pane.findAll({ type: 'Text' })).map(x => x.text)
    const at = (re: RegExp) => texts.findIndex(x => re.test(x))
    // Summary pills first, then THIS FOLDER with its cards, then OTHER FOLDERS by folder.
    expect(at(/^ \?1 $/)).toBeGreaterThanOrEqual(0)
    expect(at(/^ THIS FOLDER $/)).toBeGreaterThan(at(/^ \?1 $/))
    expect(at(/vault · 3/)).toBeGreaterThan(0)
    expect(at(/“Tidy the inbox”/)).toBeGreaterThan(at(/^ THIS FOLDER $/))
    expect(at(/→ Editing Waiting\.md/)).toBeGreaterThan(0)
    expect(at(/· you/)).toBeGreaterThan(0)
    expect(at(/^ OTHER FOLDERS $/)).toBeGreaterThan(at(/Tidy the inbox/))
    expect(at(/^iams-ups$/)).toBeGreaterThan(at(/^ OTHER FOLDERS $/))
    expect(at(/\? Needs you/)).toBeGreaterThan(at(/^iams-ups$/))
    expect(at(/→ Approve: Run the deploy/)).toBeGreaterThan(0)
    // Ended sessions fold away (the stopped old-version card is live, not ended).
    expect(at(/Ended/)).toBe(-1)
    expect(at(/task-notification/)).toBe(-1)

    // The peer in this folder replies.
    files.set(`${DIR}/peer.json`, card({
      id: 'peer', folder: '/home/me/vault', project: 'vault', asked: 'Tidy the inbox',
      status: 'replied', changedAt: 1_008_000, seenAt: 1_008_000,
    }))
    await clock.advance(5_000)
    expect(await strip($, surface)).toBe('vault ◔ Working │ others ? iams-ups ✓ vault · Tidy the inbox ☰ All ›')

    // A card caught mid-write keeps what it said last round.
    files.set(`${DIR}/peer.json`, '{"id":"peer","fol')
    await clock.advance(5_000)
    expect(await strip($, surface)).toBe('vault ◔ Working │ others ? iams-ups ✓ vault · Tidy the inbox ☰ All ›')
    files.set(`${DIR}/peer.json`, card({
      id: 'peer', folder: '/home/me/vault', project: 'vault', asked: 'Tidy the inbox',
      status: 'replied', changedAt: 1_008_000, seenAt: 1_015_000,
    }))

    // Several replied sessions collapse into one count.
    files.set(`${DIR}/third.json`, card({
      id: 'third', folder: '/home/me/codesignr', project: 'codesignr', asked: 'Add login',
      status: 'replied', changedAt: 1_012_000, seenAt: 1_012_000,
    }))
    await clock.advance(5_000)
    expect(await strip($, surface)).toBe('vault ◔ Working │ others ? iams-ups ✓ vault · Tidy the inbox ✓ codesignr ☰ All ›')

    // Two sessions in this session's folder need you: a pill each, named by its request.
    for (const id of ['w1', 'w2']) {
      files.set(`${DIR}/${id}.json`, card({
        id, folder: '/home/me/vault', project: 'vault', asked: 'Run tests',
        status: 'needs-you', activity: 'Approve: Run tests', changedAt: 999_000, seenAt: 1_015_000,
      }))
    }
    // A session waiting on background work is no alert.
    files.set(`${DIR}/gpu.json`, card({
      id: 'gpu', folder: '/home/me/comfy', project: 'comfy', asked: 'Render the batch',
      status: 'background', tasks: ['shell: Render on the GPU'], activity: 'shell: Render on the GPU', seenAt: 1_020_000,
    }))
    await clock.advance(5_000)
    // The names take 135 cells: at 140 columns they fit; at 130 the line falls back to counts rather than wrap.
    expect(await stripAt($, surface, 140)).toBe('vault ◔ Working │ others ? vault · Run tests ? vault · Run tests ? iams-ups ✓ vault · Tidy the inbox ✓ codesignr ☰ All ›')
    expect(await strip($, surface)).toBe('vault ◔ Working │ ?3 ✓2 ☰ ›')
    // the replied pills end the group, green; the waiting and idle sessions are not drawn
    const waiting = await $.ui.mount({ plugin: 'session-board', surface, component: 'AbovePrompt', props: { ...BAND, bodyColumns: 140 } })
    expect(chipsOf(await waiting.find({ key: 'sb-strip' })).slice(-2)).toEqual([['#000000', ' ✓ vault · Tidy the inbox ', 'green'], ['#000000', ' ✓ codesignr ', 'green']])
    // many pills of the same colour still touch (each starts with its own glyph, so they read as separate names)
    expect((await waiting.find({ key: 'sb-strip' }))!.text).toContain('others  ? vault · Run tests  ? vault · Run tests  ? iams-ups  ✓ vault · Tidy the inbox  ✓ codesignr')
    await waiting.unmount()
    // A narrow pane (under 80 columns): this session alone, the other sessions behind the link.
    const narrow = await $.ui.mount({ plugin: 'session-board', surface, component: 'AbovePrompt', props: { ...BAND, bodyColumns: 36 } })
    const narrowStrip = await narrow.find({ key: 'sb-strip' })
    expect(narrowStrip?.text.replace(/\s+/g, ' ').trim()).toBe('vault ◔ Working ☰ ›')
    expect(chipsOf(narrowStrip)).toEqual([['#000000', ' vault    ', '#8B949E'], ['#000000', ' ◔ Working ', 'cyan']])
    expect(narrowStrip?.text).not.toContain('others')
    expect(narrowStrip?.text).toContain('vault     ◔ Working')
    await narrow.unmount()
  })

  test(`a turn that leaves background work running waits on it, not on you (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const files = new Map<string, string>()
    const statuses: (string | undefined)[] = []
    bottom(on, files, { id: { value: 'me' }, statuses })
    on('classic.PermissionRequest', () => ({}))
    on('tool.call', (_$, e) => (e.tool === 'Bash' ? { result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1' } } : { result: 'ok' }))

    await $.session.start({ cwd: '/home/me/vault', surface, isInteractive: true })
    expect(own(files).status).toBe('open')
    await $.prompt.submit({ text: 'Render the batch', origin: { kind: 'composer' }, wait: false })
    await $.turn.start({ text: 'Render the batch', turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: 'python render.py', description: 'Render on the GPU' })
    // A subagent's run ending is not this session's turn ending.
    await $.turn.complete({ answer: 'sub', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer', agentId: 'a1' })
    expect(own(files).status).toBe('working')
    await endTurn($, 't1', [{ id: 'b1', type: 'shell', description: 'Render on the GPU' }])
    expect(own(files).status).toBe('background')
    // Nothing elsewhere needs you or replied, but the job alone opens the strip (since 0.29.0; before, no strip).
    expect(await strip($, surface)).toBe('vault ◌ Waiting ◈ 1 job ☰ All ›')
    expect(own(files).tasks).toEqual(['shell: Render on the GPU'])

    // The job reports back: a turn of its own, then nothing is left in flight.
    await $.prompt.submit({ text: '<task-notification><task-id>b1</task-id><status>completed</status></task-notification>', origin: { kind: 'task-notification' }, wait: false })
    expect(own(files).asked).toBe('Render the batch')
    await $.turn.start({ text: '', turnId: 't2' })
    expect(own(files).status).toBe('working')
    await endTurn($, 't2', [])
    expect(own(files).status).toBe('replied')

    // Stop may come after turn.complete: the card follows it.
    await $.turn.start({ text: 'Again', turnId: 't3' })
    await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 't3', reason: 'answer' })
    await $.classic.Stop({ stop_hook_active: false, background_tasks: [{ id: 'm1', type: 'monitor', status: 'running', description: 'Watch the queue' }] })
    expect(own(files).status).toBe('background')

    // An interrupt is still "stopped", whatever runs behind it.
    await $.turn.start({ text: 'Again', turnId: 't4' })
    await $.turn.complete({ answer: '', durationMs: 10, isAborted: true, turnId: 't4', reason: 'aborted' })
    expect(own(files).status).toBe('stopped')
    await clock.advance(5_000)
  })

  test(`/clear retires the old card and starts a fresh one (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const files = new Map<string, string>()
    const statuses: (string | undefined)[] = []
    const id = { value: 'old' }
    bottom(on, files, { id, statuses })
    on('tool.call', () => ({ result: 'ok' }))

    await $.session.start({ cwd: '/home/me/vault', surface, isInteractive: true })
    await $.prompt.submit({ text: 'First task', origin: { kind: 'composer' }, wait: false })
    await $.turn.start({ text: 'First task', turnId: 't1' })
    // A reload of the module mid-turn (session.start fires again): the card keeps its state.
    await $.session.start({ cwd: '/home/me/vault', surface, isInteractive: true })
    expect(own(files, 'old').status).toBe('working')
    expect(own(files, 'old').asked).toBe('First task')
    await endTurn($, 't1', [])
    await $.session.end({ reason: 'clear', sessionId: 'old', resume: { id: 'old' } as never })
    expect(own(files, 'old').status).toBe('closed')
    id.value = 'new'
    await clock.advance(5_000)
    expect(own(files, 'new').status).toBe('open')
    expect(own(files, 'new').asked).toBe('')
    expect(own(files, 'old').status).toBe('closed')
  })
}

// ── the strip by width, this session's folder first (2026-11-21) ───────────────

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the card keeps this conversation's first request, set once; a slash command and a task report never set it; /clear empties it (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const files = new Map<string, string>()
    const statuses: (string | undefined)[] = []
    const id = { value: 'old' }
    bottom(on, files, { id, statuses })
    on('tool.call', () => ({ result: 'ok' }))
    await $.session.start({ cwd: '/home/me/vault', surface, isInteractive: true })
    await $.prompt.submit({ text: '/model', origin: { kind: 'composer' }, wait: false })
    await $.prompt.submit({ text: '<task-notification><task-id>b1</task-id></task-notification>', origin: { kind: 'task-notification' }, wait: false })
    expect(own(files, 'old').first ?? '').toBe('')
    await $.prompt.submit({ text: 'Build the board', origin: { kind: 'composer' }, wait: false })
    await $.prompt.submit({ text: 'Then the strip', origin: { kind: 'composer' }, wait: false })
    expect(own(files, 'old').first).toBe('Build the board')
    expect(own(files, 'old').asked).toBe('Then the strip')
    await $.session.end({ reason: 'clear', sessionId: 'old', resume: { id: 'old' } as never })
    id.value = 'new'
    await clock.advance(5_000)
    expect(own(files, 'new').first ?? '').toBe('')
    await $.prompt.submit({ text: 'A new conversation', origin: { kind: 'composer' }, wait: false })
    expect(own(files, 'new').first).toBe('A new conversation')
  })
}

/** The strip at a given width, whitespace folded; '' when it is not drawn. */
async function stripAt($: Engine, surface: 'terminal' | 'desktop', bodyColumns: number): Promise<string> {
  const band = await $.ui.mount({ plugin: 'session-board', surface, component: 'AbovePrompt', props: { ...BAND, bodyColumns } })
  const found = await band.find({ key: 'sb-strip' })
  await band.unmount()
  return found ? found.text.replace(/\s+/g, ' ').trim() : ''
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`an other session in this session's folder gets a pill of its own, with its first request, else its latest (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const files = new Map<string, string>()
    const statuses: (string | undefined)[] = []
    // Two sessions in this folder: one that wrote its first request, one from an older version that wrote none.
    files.set(`${DIR}/peer1.json`, card({ id: 'peer1', folder: '/home/me/vault', project: 'vault', asked: 'And the tests', first: 'Fix the gcp merge', status: 'replied', seenAt: 1_004_000 }))
    files.set(`${DIR}/peer2.json`, card({ id: 'peer2', folder: '/home/me/vault', project: 'vault', asked: 'Tidy the inbox', status: 'replied', seenAt: 1_004_000 }))
    // Two sessions in another folder: still one pill, counted.
    files.set(`${DIR}/far1.json`, card({ id: 'far1', folder: '/home/me/iams-ups', project: 'iams-ups', asked: 'Deploy', first: 'Deploy', status: 'needs-you', seenAt: 1_004_000 }))
    files.set(`${DIR}/far2.json`, card({ id: 'far2', folder: '/home/me/iams-ups', project: 'iams-ups', asked: 'Logs', first: 'Logs', status: 'needs-you', seenAt: 1_004_000 }))
    bottom(on, files, { id: { value: 'me' }, statuses })
    await $.session.start({ cwd: '/home/me/vault', surface, isInteractive: true })
    await clock.advance(5_000)
    const s = await stripAt($, surface, 130)
    expect(s).toContain('? iams-ups ×2')
    expect(s).toContain('✓ vault · Fix the gcp merge')
    expect(s).toContain('✓ vault · Tidy the inbox')
  })
}

for (const surface of ['terminal', 'desktop'] as const) {
  /** This session working in /home/me/vault; others: one needs you, one replied, two quiet (one working, one idle). */
  async function tiers($: Engine, on: On, quietOnly = false) {
    const clock = mock.clock(on, { now: 1_000_000 })
    const files = new Map<string, string>()
    const statuses: (string | undefined)[] = []
    if (!quietOnly) {
      files.set(`${DIR}/far.json`, card({ id: 'far', folder: '/home/me/iams-ups', project: 'iams-ups', asked: 'Deploy', status: 'needs-you', seenAt: 1_004_000 }))
      files.set(`${DIR}/cs.json`, card({ id: 'cs', folder: '/home/me/codesignr', project: 'codesignr', asked: 'Plan 3', status: 'replied', seenAt: 1_004_000 }))
    }
    files.set(`${DIR}/busy.json`, card({ id: 'busy', folder: '/home/me/x', project: 'x', asked: 'Render', status: 'working', seenAt: 1_004_000 }))
    files.set(`${DIR}/idle.json`, card({ id: 'idle', folder: '/home/me/y', project: 'y', asked: 'Notes', status: 'open', seenAt: 1_004_000 }))
    bottom(on, files, { id: { value: 'me' }, statuses })
    on('tool.call', () => ({ result: 'ok' }))
    await $.session.start({ cwd: '/home/me/vault', surface, isInteractive: true })
    await $.prompt.submit({ text: 'Build the board', origin: { kind: 'composer' }, wait: false })
    await $.turn.start({ text: 'Build the board', turnId: 't1' })
    await clock.advance(5_000)
    return { clock }
  }

  test(`line 1 by width: names from 120 columns, counts from 80, this session alone below; quiet sessions are not drawn (${surface})`, async ($, on) => {
    await tiers($, on)
    const wide = 'vault ◔ Working │ others ? iams-ups ✓ codesignr ☰ All ›'
    const mid = 'vault ◔ Working │ ?1 ✓1 ☰ ›'
    const small = 'vault ◔ Working ☰ ›'
    for (const [cols, want] of [[200, wide], [130, wide], [120, wide], [119, mid], [100, mid], [80, mid], [79, small], [60, small], [36, small]] as const) {
      expect(await stripAt($, surface, cols), `${cols} columns`).toBe(want)
    }
  })

  test(`with only quiet sessions out there, line 1 is this session and the link (${surface})`, async ($, on) => {
    await tiers($, on, true)
    expect(await stripAt($, surface, 130)).toBe('vault ◔ Working ☰ All ›')
    expect(await stripAt($, surface, 100)).toBe('vault ◔ Working ☰ ›')
  })

  test(`what to check is on a line of its own, at every width (${surface})`, async ($, on) => {
    await tiers($, on)
    await $.classic.Stop({ stop_hook_active: false, background_tasks: [], session_crons: [] })
    await $.turn.complete({ answer: 'Done.\n\nTurn: Built the strip · check: the strip at 100 columns', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
    for (const cols of [130, 100, 70]) {
      const band = await $.ui.mount({ plugin: 'session-board', surface, component: 'AbovePrompt', props: { ...BAND, bodyColumns: cols } })
      const line1 = (await band.find({ key: 'sb-strip' }))?.text ?? ''
      const line2 = (await band.find({ key: 'sb-recap-row' }))?.text.replace(/\s+/g, ' ').trim() ?? ''
      await band.unmount()
      expect(line1, `${cols} columns`).not.toContain('CHECK')
      expect(line1, `${cols} columns`).toContain('vault')
      expect(line2, `${cols} columns`).toBe('⚑ CHECK the strip at 100 columns')
    }
  })
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`a long folder name is cut to 24 characters, so it cannot crowd line 1 (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const files = new Map<string, string>()
    const root = '/home/me/a-very-long-project-folder-name-for-the-strip'
    files.set(`${DIR}/far.json`, card({ id: 'far', folder: '/home/me/iams-ups', project: 'iams-ups', asked: 'Deploy', status: 'needs-you', seenAt: 1_004_000 }))
    bottom(on, files, { id: { value: 'me' }, statuses: [], root })
    await $.session.start({ cwd: root, surface, isInteractive: true })
    await clock.advance(5_000)
    const band = await $.ui.mount({ plugin: 'session-board', surface, component: 'AbovePrompt', props: { ...BAND, bodyColumns: 130 } })
    const label = chipsOf(await band.find({ key: 'sb-strip' }))[0]![1].trim()
    await band.unmount()
    expect(label.length).toBeLessThanOrEqual(24)
    expect(label.startsWith('a-very-long-project')).toBe(true)
    expect(label.endsWith('…')).toBe(true)
  })
}

// ── line 1 fits the width it is drawn at (final review, 2026-11-21) ──────────────

for (const surface of ['terminal', 'desktop'] as const) {
  /** The strip's line 1 as drawn at a width: [text folded, cells the raw text takes]. */
  async function line1At($: Engine, bodyColumns: number): Promise<[string, number]> {
    const band = await $.ui.mount({ plugin: 'session-board', surface, component: 'AbovePrompt', props: { ...BAND, bodyColumns } })
    const raw = (await band.find({ key: 'sb-strip' }))?.text ?? ''
    await band.unmount()
    return [raw.replace(/\s+/g, ' ').trim(), [...raw.trimEnd()].length]
  }

  test(`the names do not fit: line 1 falls back to counts rather than wrap (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const files = new Map<string, string>()
    const root = '/home/me/personal-notes'
    for (const [id, first] of [['a', 'Fix the gcp merge conflict today'], ['b', 'Rebuild the compare page from scratch']]) {
      files.set(`${DIR}/${id}.json`, card({ id, folder: root, project: 'personal-notes', asked: first, first, status: 'needs-you', seenAt: 1_004_000 }))
    }
    bottom(on, files, { id: { value: 'me' }, statuses: [], root })
    on('tool.call', () => ({ result: 'ok' }))
    await $.session.start({ cwd: root, surface, isInteractive: true })
    await $.prompt.submit({ text: 'Build the board', origin: { kind: 'composer' }, wait: false })
    await $.turn.start({ text: 'Build the board', turnId: 't1' })
    await clock.advance(5_000)
    // 16 + 11 + 3 + 8 + 45 + 45 + 3 + 7 = 138 cells with the names.
    const [wide, wideCells] = await line1At($, 140)
    expect(wide).toContain('others ? personal-notes · Fix the gcp merge')
    expect(wideCells).toBeLessThanOrEqual(140)
    const [narrower, narrowerCells] = await line1At($, 130)
    expect(narrower).toBe('personal-notes ◔ Working │ ?2 ☰ ›')
    expect(narrowerCells).toBeLessThanOrEqual(130)
  })

  test(`a narrow pane: the status shrinks to its glyph, then the label to 8, so line 1 stays one line (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const files = new Map<string, string>()
    const root = '/home/me/personal-notes'
    files.set(`${DIR}/q.json`, card({ id: 'q', folder: '/home/me/x', project: 'x', asked: 'Render', status: 'working', seenAt: 1_004_000 }))
    bottom(on, files, { id: { value: 'me' }, statuses: [], root })
    await $.session.start({ cwd: root, surface, isInteractive: true })
    await clock.advance(5_000)
    for (const [cols, want] of [
      [70, 'personal-notes ○ Open · nothing asked yet ☰ ›'],
      [40, 'personal-notes ○ ☰ ›'],
      [20, 'persona… ○ ☰ ›'],
    ] as const) {
      const [text, cells] = await line1At($, cols)
      expect(text, `${cols} columns`).toBe(want)
      expect(cells, `${cols} columns`).toBeLessThanOrEqual(cols)
    }
  })

  test(`the counts from 80 to 119 columns are chips in their status colours, touching (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const files = new Map<string, string>()
    files.set(`${DIR}/far.json`, card({ id: 'far', folder: '/home/me/iams-ups', project: 'iams-ups', asked: 'Deploy', status: 'needs-you', seenAt: 1_004_000 }))
    files.set(`${DIR}/cs.json`, card({ id: 'cs', folder: '/home/me/codesignr', project: 'codesignr', asked: 'Plan 3', status: 'replied', seenAt: 1_004_000 }))
    bottom(on, files, { id: { value: 'me' }, statuses: [] })
    await $.session.start({ cwd: '/home/me/vault', surface, isInteractive: true })
    await clock.advance(5_000)
    const band = await $.ui.mount({ plugin: 'session-board', surface, component: 'AbovePrompt', props: { ...BAND, bodyColumns: 100 } })
    const drawn = await band.find({ key: 'sb-strip' })
    await band.unmount()
    expect(chipsOf(drawn).slice(-2)).toEqual([['#000000', ' ?1 ', 'yellow'], ['#000000', ' ✓1 ', 'green']])
    expect(weightsOf(drawn).slice(-2)).toEqual([[' ?1 ', true], [' ✓1 ', true]])
    expect(drawn!.text).toContain('?1  ✓1')
  })
}

// ── what each session is on: a topic Claude keeps, and the now row (2026-11-21) ─────────

for (const surface of ['terminal', 'desktop'] as const) {
  /** This session in /home/me/vault, one other session that needs you (so the strip is drawn). */
  async function topicSetup($: Engine, on: On, others: Record<string, unknown>[] = []) {
    const clock = mock.clock(on, { now: 1_000_000 })
    const files = new Map<string, string>()
    const id = { value: 'me' }
    files.set(`${DIR}/far.json`, card({ id: 'far', folder: '/home/me/iams-ups', project: 'iams-ups', asked: 'Deploy', status: 'needs-you', seenAt: 1_004_000 }))
    for (const o of others) files.set(`${DIR}/${String(o.id)}.json`, card({ seenAt: 1_004_000, ...o }))
    bottom(on, files, { id, statuses: [] })
    on('tool.call', () => ({ result: 'ok' }))
    on('prompt.compose', () => ({ sections: [] }))
    await $.session.start({ cwd: '/home/me/vault', surface, isInteractive: true })
    await clock.advance(5_000)
    const turn = async (turnId: string, answer: string) => {
      await $.prompt.submit({ text: `Ask ${turnId}`, origin: { kind: 'composer' }, wait: false })
      await $.turn.start({ text: `Ask ${turnId}`, turnId })
      await $.tool.call({ tool: 'Edit', file_path: '/home/me/vault/hooks/register.tsx', old_string: 'a', new_string: 'b' })
      await $.classic.Stop({ stop_hook_active: false, background_tasks: [], session_crons: [] })
      await $.turn.complete({ answer, durationMs: 1000, isAborted: false, turnId, reason: 'answer' })
      await clock.advance(5_000)
    }
    return { clock, files, id, turn }
  }

  test(`the turn guidance asks for the session's topic when it is new or changes (${surface})`, async ($, on) => {
    await topicSetup($, on)
    const composed = await $.prompt.compose({ model: 'claude-opus-4-1', promptModel: 'claude-opus-4-1', surfaces: [surface], tools: [], outputStyle: null, traits: [] } as never)
    const guidance = composed.sections.map(x => x.text).join('\n')
    expect(guidance).toContain('· topic: <')
  })

  test(`the card keeps the topic from Claude's Turn line until a new one; /clear empties it; check still parses (${surface})`, async ($, on) => {
    const { files, id, clock, turn } = await topicSetup($, on)
    await turn('t1', 'Done.\n\nTurn: Built the strip · topic: session-board strip redesign · check: the strip at 100 columns')
    expect(own(files).topic).toBe('session-board strip redesign')
    const band = await $.ui.mount({ plugin: 'session-board', surface, component: 'AbovePrompt', props: { ...BAND, bodyColumns: 130 } })
    expect((await band.find({ key: 'sb-recap-row' }))?.text.replace(/\s+/g, ' ').trim()).toBe('⚑ CHECK the strip at 100 columns')
    await band.unmount()
    await turn('t2', 'Done.\n\nTurn: Fixed a test')
    expect(own(files).topic).toBe('session-board strip redesign')
    await $.session.end({ reason: 'clear', sessionId: 'me', resume: { id: 'me' } as never })
    id.value = 'fresh'
    await clock.advance(5_000)
    expect(own(files, 'fresh').topic ?? '').toBe('')
  })

  test(`line 1 shows this session's topic beside its folder, and steps it down before anything else of its own (${surface})`, async ($, on) => {
    const { turn } = await topicSetup($, on)
    await turn('t1', 'Done.\n\nTurn: Built the strip · topic: session-board strip redesign')
    expect(await stripAt($, surface, 130)).toBe('vault › session-board strip redesign ✓ Done │ others ? iams-ups ☰ All ›')
    expect(await stripAt($, surface, 70)).toBe('vault › session-board strip redesign ✓ Done ☰ ›')
    expect(await stripAt($, surface, 45)).toBe('vault › session-board… ✓ Done ☰ ›')
    expect(await stripAt($, surface, 30)).toBe('vault ✓ Done ☰ ›')
  })

  test(`other sessions' pills show their topics: another folder's, and this folder's ahead of its first request (${surface})`, async ($, on) => {
    await topicSetup($, on, [
      { id: 'ops', folder: '/home/me/ops', project: 'ops', asked: 'Rotate', topic: 'deploy script', status: 'needs-you' },
      { id: 'peer', folder: '/home/me/vault', project: 'vault', asked: 'Later', first: 'Fix the gcp merge', topic: 'gcp merge repair', status: 'replied' },
    ])
    const s = await stripAt($, surface, 160)
    expect(s).toContain('? ops · deploy script')
    expect(s).toContain('✓ vault · gcp merge repair')
    expect(s).not.toContain('Fix the gcp merge')
  })

  test(`while Claude works, a row says what it is doing now; the row goes when the turn ends (${surface})`, async ($, on) => {
    const { clock } = await topicSetup($, on)
    await $.prompt.submit({ text: 'Build it', origin: { kind: 'composer' }, wait: false })
    await $.turn.start({ text: 'Build it', turnId: 't1' })
    const now = async () => {
      const band = await $.ui.mount({ plugin: 'session-board', surface, component: 'AbovePrompt', props: { ...BAND, bodyColumns: 130, isWorking: true } })
      const row = (await band.find({ key: 'sb-live' }))?.text.replace(/\s+/g, ' ').trim()
      await band.unmount()
      return row
    }
    expect(await now()).toBe('↳ Thinking')
    await $.tool.call({ tool: 'Edit', file_path: '/home/me/vault/hooks/register.tsx', old_string: 'a', new_string: 'b' })
    await clock.advance(0)
    expect(await now()).toBe('↳ Editing register.tsx')
    await $.classic.Stop({ stop_hook_active: false, background_tasks: [], session_crons: [] })
    await $.turn.complete({ answer: 'Done.', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
    await clock.advance(5_000)
    expect(await now()).toBeUndefined()
  })

  // 0.33.0 final review: /resume keeps the conversation's topic; names keep their place at 120.
  test(`a /resume in the same window brings back the conversation's topic and first request (${surface})`, async ($, on) => {
    const { files, id, clock, turn } = await topicSetup($, on)
    await turn('t1', 'Done.\n\nTurn: Built the strip · topic: session-board strip redesign')
    await $.session.end({ reason: 'clear', sessionId: 'me', resume: { id: 'me' } as never })
    id.value = 'fresh'
    await clock.advance(5_000)
    expect(own(files, 'fresh').id).toBe('fresh')
    expect(own(files, 'fresh').topic ?? '').toBe('')
    // back to the first conversation
    await $.session.end({ reason: 'resume', sessionId: 'fresh', resume: { id: 'me' } as never })
    id.value = 'me'
    await clock.advance(5_000)
    expect(own(files, 'me').topic).toBe('session-board strip redesign')
    expect(own(files, 'me').first).toBe('Ask t1')
    // the topic stays the same, so Claude leaves it out: the card keeps it
    await turn('t3', 'Done.\n\nTurn: Fixed a test')
    expect(own(files, 'me').topic).toBe('session-board strip redesign')
  })

  test(`at 120 columns this session's topic shortens so the other sessions keep their names (${surface})`, async ($, on) => {
    const { turn } = await topicSetup($, on, [
      { id: 'ops', folder: '/home/me/ops', project: 'ops', asked: 'Rotate', topic: 'deploy script', status: 'needs-you' },
      { id: 'peer', folder: '/home/me/vault', project: 'vault', asked: 'Later', first: 'Fix the gcp merge', topic: 'gcp merge repair', status: 'replied' },
    ])
    await turn('t1', 'Done.\n\nTurn: Built the strip · topic: session-board strip redesign')
    const s = await stripAt($, surface, 120)
    expect(s).toContain('vault › session-board… ✓ Done')
    expect(s).toContain('? ops · deploy script')
    expect(s).toContain('✓ vault · gcp merge repair')
  })
}

