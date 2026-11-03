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
  bodyColumns: 100,
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
function bottom(on: On, files: Map<string, string>, opts: { id: { value: string }; statuses: (string | undefined)[] }) {
  on('env.get', (_$, e) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }))
  on('session.id', () => ({ value: opts.id.value }))
  on('session.root', () => ({ value: '/home/me/vault' }))
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
    expect(await strip($, surface)).toBe('current ◔ Working │ others ? iams-ups ◔1 ○3 ☰ All ›')
    // Every chip of the row sits on true black: "current" and "others" are white text, a status is its colour as the
    // text (so a status matches the labels), every count of the quiet sessions is a chip too, and nothing divides the groups.
    const band = await $.ui.mount({ plugin: 'session-board', surface, component: 'AbovePrompt', props: BAND })
    const drawn = await band.find({ key: 'sb-strip' })
    expect(chipsOf(drawn)).toEqual([
      ['#000000', ' current  ', '#8B949E'], ['#000000', ' ◔ Working ', 'cyan'], ['#000000', ' others ', '#8B949E'],
      ['#000000', ' ? iams-ups ', 'yellow'], ['#000000', ' ◔1 ', 'cyan'], ['#000000', ' ○3 ', 'gray'],
    ])
    // a dim "│" divides the two groups, one space either side of the gap
    expect(drawn!.text).toContain('Working  │  others')
    // dim labels, bold values: the label recedes and the value beside it is what stands out
    expect(weightsOf(drawn)).toEqual([
      [' current  ', false], [' ◔ Working ', true], [' others ', false], [' ? iams-ups ', true], [' ◔1 ', true], [' ○3 ', true],
    ])
    // no emoji: an emoji ignores the colour it is given, so the strip draws text glyphs
    expect(drawn!.text).not.toMatch(/[⏳⌛❓🤖⏸⏹]/u)
    // the link is the lighter blue
    expect(JSON.stringify(await band.find({ key: 'sb-strip-open' }))).toContain('#7AA2F7')
    // Every chip touches the next: only the two paddings sit between two of them (no gap), in both groups.
    expect(drawn!.text).toContain('current   ◔ Working')
    expect(drawn!.text).not.toContain('current    ')
    // the status glyph is in cell 11: the same cell as the Actions button of the context row below it (guard.picker test)
    expect(drawn!.text.indexOf('◔')).toBe(11)
    expect(drawn!.text).toContain('others  ? iams-ups  ◔1  ○3')
    expect(drawn!.text).not.toContain('iams-ups   ')
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
    expect(await strip($, surface)).toBe('current ◔ Working │ others ? iams-ups ✓ vault ○3 ☰ All ›')

    // A card caught mid-write keeps what it said last round.
    files.set(`${DIR}/peer.json`, '{"id":"peer","fol')
    await clock.advance(5_000)
    expect(await strip($, surface)).toBe('current ◔ Working │ others ? iams-ups ✓ vault ○3 ☰ All ›')
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
    expect(await strip($, surface)).toBe('current ◔ Working │ others ? iams-ups ✓ vault ✓ codesignr ○3 ☰ All ›')

    // Two sessions in one folder need you: one entry with a count.
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
    expect(await strip($, surface)).toBe('current ◔ Working │ others ? vault ×2 ? iams-ups ✓ vault ✓ codesignr ◌1 ○3 ☰ All ›')
    // the waiting count is a magenta chip, the idle count a gray one (the colours of their status pills)
    const waiting = await $.ui.mount({ plugin: 'session-board', surface, component: 'AbovePrompt', props: BAND })
    expect(chipsOf(await waiting.find({ key: 'sb-strip' })).slice(-2)).toEqual([['#000000', ' ◌1 ', 'magenta'], ['#000000', ' ○3 ', 'gray']])
    // many pills of the same colour still touch (each starts with its own glyph, so they read as separate names)
    expect((await waiting.find({ key: 'sb-strip' }))!.text).toContain('others  ? vault ×2  ? iams-ups  ✓ vault  ✓ codesignr  ◌1  ○3')
    await waiting.unmount()
    // A narrow pane: counts, not folder names.
    const narrow = await $.ui.mount({ plugin: 'session-board', surface, component: 'AbovePrompt', props: { ...BAND, bodyColumns: 36 } })
    const narrowStrip = await narrow.find({ key: 'sb-strip' })
    expect(narrowStrip?.text.replace(/\s+/g, ' ').trim()).toBe('current ◔ │ others ?3 ✓2 ◌1 ○3 ☰ All ›')
    // the narrow strip has the same two black label chips, no pipe, and its chips touch each other too
    expect(chipsOf(narrowStrip)).toEqual([
      ['#000000', ' current  ', '#8B949E'], ['#000000', ' ◔ ', 'cyan'], ['#000000', ' others ', '#8B949E'],
      ['#000000', ' ?3 ', 'yellow'], ['#000000', ' ✓2 ', 'green'], ['#000000', ' ◌1 ', 'magenta'], ['#000000', ' ○3 ', 'gray'],
    ])
    expect(narrowStrip?.text).toContain('◔  │  others  ?3')
    expect(narrowStrip?.text).toContain('current   ◔')
    expect(narrowStrip?.text).toContain('others  ?3  ✓2  ◌1  ○3')
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
    expect(await strip($, surface)).toBe('current ◌ Waiting ◈ 1 job ☰ All ›')
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
