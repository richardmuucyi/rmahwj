import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

/** On Windows the engine turns /home/me/x into C:\home\me\x. The tests keep POSIX paths, so a test reads the same on both. */
const posix = (p: string) => p.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/')

const DIR = '/home/me/.claude/session-board'
const NOTES = '/home/me/vault/notes.md'
const BAND = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
}
const PANE_PROPS = {
  title: 'Sessions',
  isFocused: false,
  bodyColumns: 60,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 80 },
  view: {},
}

/** A git repository in memory: the status lines git prints, and every command run. */
type Repo = { isRepo: boolean; status: string[]; runs: string[][] }

/** The engine beneath the plugin: a shared folder in memory, git, and Edit/Write results in the shape the engine gives. */
function bottom(on: On, files: Map<string, string>, repo: Repo) {
  on('env.get', (_$, e) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }))
  on('session.id', () => ({ value: 'me' }))
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
  on('ui.status', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } as never }))
  on('agent.list', () => ({ value: [] }))
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
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('classic.Stop', () => ({}))
  on('tool.call', (_$, e) => ({
    result: {
      filePath: e.file_path,
      structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }],
      originalFile: 'a',
    },
  }))
  on('process.run', (_$, e) => {
    const argv = [...e.argv]
    repo.runs.push(argv)
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (!repo.isRepo) return out('', 128)
    const args = argv.filter(a => a !== '-c' && a !== 'core.quotepath=off').slice(1)
    if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return out('/home/me/vault\n')
    if (args[0] === 'rev-parse') return out('abc123\n')
    if (args[0] === 'status') return out(repo.status.map(s => `${s}\0`).join(''))
    return out('')
  })
}

/** Another session's card in the shared folder. */
function peer(files: Map<string, string>, over: Record<string, unknown>) {
  const id = String(over.id)
  files.set(`${DIR}/${id}.json`, JSON.stringify({
    v: 5, folder: '/home/me/vault', project: 'vault', asked: 'Tidy the notes', status: 'working',
    changedAt: 1_000_000, seenAt: 1_000_000, ...over,
  }))
}

/** This session edits each file in one turn that ends. */
async function edit($: Engine, paths: string[]) {
  await $.turn.start({ text: 'Edit', turnId: 't1' })
  for (const p of paths) await $.tool.call({ tool: 'Edit', file_path: p, old_string: 'a', new_string: 'b' })
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [], session_crons: [] })
  await $.turn.complete({ answer: 'Done.', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
}

/** What the strip above the prompt says at a width, whitespace folded; '' when it is not drawn. */
async function strip($: Engine, surface: 'terminal' | 'desktop', bodyColumns = BAND.bodyColumns): Promise<string> {
  const band = await $.ui.mount({ plugin: 'session-board', surface, component: 'AbovePrompt', props: { ...BAND, bodyColumns } })
  const found = await band.find({ key: 'sb-strip' })
  await band.unmount()
  return found ? found.text.replace(/\s+/g, ' ').trim() : ''
}

const gitStatusRuns = (repo: Repo) => repo.runs.filter(r => r.includes('status')).length

for (const surface of ['terminal', 'desktop'] as const) {
  test(`two sessions edited the same file: the strip warns, wide and narrow (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const files = new Map<string, string>()
    const repo: Repo = { isRepo: true, status: [' M notes.md'], runs: [] }
    peer(files, { id: 'peer', edits: [NOTES] })
    bottom(on, files, repo)
    await $.session.start({ cwd: '/home/me/vault', surface, isInteractive: true })
    await edit($, [NOTES])
    await clock.advance(5_000)
    expect(await strip($, surface)).toBe('current ✓ Done │ others ◔1 ⚠ notes.md · vault ☰ All ›')
    expect(await strip($, surface, 50)).toBe('current ✓ │ others ◔1 ⚠1 ☰ All ›')
  })

  test(`the card lists the files Claude edited, newest last, the 200 newest (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const files = new Map<string, string>()
    bottom(on, files, { isRepo: false, status: [], runs: [] })
    await $.session.start({ cwd: '/home/me/vault', surface, isInteractive: true })
    await edit($, Array.from({ length: 201 }, (_, i) => `/home/me/vault/f${i}.md`))
    await edit($, ['/home/me/vault/f5.md'])
    await clock.advance(5_000)
    const card = JSON.parse(files.get(`${DIR}/me.json`) ?? '{}') as { v?: number; edits?: string[] }
    expect(card.v).toBe(5)
    expect(card.edits?.length).toBe(200)
    expect(card.edits?.[0]).toBe('/home/me/vault/f1.md')
    expect(card.edits?.at(-1)).toBe('/home/me/vault/f5.md')
    expect(card.edits?.filter(k => k === '/home/me/vault/f5.md').length).toBe(1)
  })

  test(`no chip when the other session edited other files, and the poll runs no git for it (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const files = new Map<string, string>()
    const repo: Repo = { isRepo: true, status: [' M notes.md'], runs: [] }
    peer(files, { id: 'peer', edits: ['/home/me/vault/todo.md'] })
    bottom(on, files, repo)
    await $.session.start({ cwd: '/home/me/vault', surface, isInteractive: true })
    await edit($, [NOTES])
    await clock.advance(5_000)
    const runs = gitStatusRuns(repo)
    await clock.advance(60_000)
    expect(await strip($, surface)).toBe('current ✓ Done │ others ◔1 ☰ All ›')
    expect(gitStatusRuns(repo)).toBe(runs)
  })

  for (const [what, over] of [
    ['gone (no heartbeat for 3 minutes)', { seenAt: 1_000_000 - 3 * 60_000 }],
    ['closed', { status: 'closed' }],
  ] as const) {
    test(`no chip when the other session is ${what} (${surface})`, async ($, on) => {
      const clock = mock.clock(on, { now: 1_000_000 })
      const files = new Map<string, string>()
      peer(files, { id: 'peer', edits: [NOTES], ...over })
      // A live session that edited nothing shared, so the strip is drawn and could show the chip.
      peer(files, { id: 'live', folder: '/home/me/blog', project: 'blog', edits: [] })
      bottom(on, files, { isRepo: true, status: [' M notes.md'], runs: [] })
      await $.session.start({ cwd: '/home/me/vault', surface, isInteractive: true })
      await edit($, [NOTES])
      await clock.advance(5_000)
      expect(await strip($, surface)).toBe('current ✓ Done │ others ◔1 ☰ All ›')
    })
  }

  test(`the chip clears once git shows the file committed, and then the poll stops running git (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const files = new Map<string, string>()
    const repo: Repo = { isRepo: true, status: [' M notes.md'], runs: [] }
    peer(files, { id: 'peer', edits: [NOTES] })
    bottom(on, files, repo)
    await $.session.start({ cwd: '/home/me/vault', surface, isInteractive: true })
    await edit($, [NOTES])
    await clock.advance(5_000)
    expect(await strip($, surface)).toContain('⚠ notes.md · vault')
    // The other session commits: nothing in this session runs git, so the poll must.
    repo.status = []
    peer(files, { id: 'peer', edits: [NOTES], seenAt: 1_030_000 })
    await clock.advance(30_000)
    expect(await strip($, surface)).toBe('current ✓ Done │ others ◔1 ☰ All ›')
    const runs = gitStatusRuns(repo)
    peer(files, { id: 'peer', edits: [NOTES], seenAt: 1_090_000 })
    await clock.advance(60_000)
    expect(gitStatusRuns(repo)).toBe(runs)
  })

  test(`this session's own commit clears the chip when its turn ends, inside the poll's 30 s wait (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const files = new Map<string, string>()
    const repo: Repo = { isRepo: true, status: [' M notes.md'], runs: [] }
    peer(files, { id: 'peer', edits: [NOTES] })
    bottom(on, files, repo)
    await $.session.start({ cwd: '/home/me/vault', surface, isInteractive: true })
    await edit($, [NOTES])
    await clock.advance(5_000)
    expect(await strip($, surface)).toContain('⚠ notes.md · vault')
    await $.turn.start({ text: 'Commit it', turnId: 't2' })
    repo.status = []
    await $.classic.Stop({ stop_hook_active: false, background_tasks: [], session_crons: [] })
    await $.turn.complete({ answer: 'Committed.', durationMs: 10, isAborted: false, turnId: 't2', reason: 'answer' })
    await clock.advance(5_000)
    expect(await strip($, surface)).toBe('current ✓ Done │ others ◔1 ☰ All ›')
  })

  test(`a file outside the repository is not gated by git (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const files = new Map<string, string>()
    const far = '/home/me/elsewhere/plan.md'
    peer(files, { id: 'peer', edits: [far] })
    bottom(on, files, { isRepo: true, status: [], runs: [] })
    await $.session.start({ cwd: '/home/me/vault', surface, isInteractive: true })
    await edit($, [far])
    await clock.advance(5_000)
    expect(await strip($, surface)).toBe('current ✓ Done │ others ◔1 ⚠ plan.md · vault ☰ All ›')
  })

  test(`no repository: the shared file stays flagged (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const files = new Map<string, string>()
    peer(files, { id: 'peer', edits: [NOTES] })
    bottom(on, files, { isRepo: false, status: [], runs: [] })
    await $.session.start({ cwd: '/home/me/vault', surface, isInteractive: true })
    await edit($, [NOTES])
    await clock.advance(5_000)
    expect(await strip($, surface)).toBe('current ✓ Done │ others ◔1 ⚠ notes.md · vault ☰ All ›')
  })

  test(`two files and two sessions: a count and both names; narrow, the count only (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const files = new Map<string, string>()
    const todo = '/home/me/vault/todo.md'
    peer(files, { id: 'peer', edits: [NOTES], changedAt: 900_000 })
    peer(files, { id: 'far', folder: '/home/me/iams-ups', project: 'iams-ups', edits: [todo, NOTES], changedAt: 950_000 })
    bottom(on, files, { isRepo: true, status: [' M notes.md', ' M todo.md'], runs: [] })
    await $.session.start({ cwd: '/home/me/vault', surface, isInteractive: true })
    await edit($, [NOTES, todo])
    await clock.advance(5_000)
    expect(await strip($, surface)).toBe('current ✓ Done │ others ◔2 ⚠ 2 files · vault, iams-ups ☰ All ›')
    expect(await strip($, surface, 50)).toBe('current ✓ │ others ◔2 ⚠2 ☰ All ›')
  })

  test(`sessions are grouped by folder like the pills, two groups then a count (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const files = new Map<string, string>()
    peer(files, { id: 'p1', edits: [NOTES], changedAt: 900_000 })
    peer(files, { id: 'p2', edits: [NOTES], changedAt: 910_000 })
    peer(files, { id: 'p3', folder: '/home/me/iams-ups', project: 'iams-ups', edits: [NOTES], changedAt: 920_000 })
    peer(files, { id: 'p4', folder: '/home/me/blog', project: 'blog', edits: [NOTES], changedAt: 930_000 })
    bottom(on, files, { isRepo: true, status: [' M notes.md'], runs: [] })
    await $.session.start({ cwd: '/home/me/vault', surface, isInteractive: true })
    await edit($, [NOTES])
    await clock.advance(5_000)
    expect(await strip($, surface)).toBe('current ✓ Done │ others ◔4 ⚠ notes.md · vault ×2, iams-ups, +1 ☰ All ›')
  })

  test(`pressing the chip opens the Files tab, where the shared file says who else edited it (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const files = new Map<string, string>()
    peer(files, { id: 'peer', edits: [NOTES] })
    bottom(on, files, { isRepo: true, status: [' M notes.md', ' M other.md'], runs: [] })
    await $.session.start({ cwd: '/home/me/vault', surface, isInteractive: true })
    await edit($, [NOTES, '/home/me/vault/other.md'])
    await clock.advance(5_000)
    const band = await $.ui.mount({ plugin: 'session-board', surface, component: 'AbovePrompt', props: BAND })
    await band.press({ key: 'sb-overlap' })
    await band.unmount()
    const pane = await $.ui.mount({ plugin: 'session-board', surface, component: 'Pane', requestId: 'session-board', props: PANE_PROPS })
    const t = (await pane.findAll({ type: 'Text' })).map(x => x.text.replace(/\s+/g, ' ').trim())
    expect(t).toContain('~ notes.md also: vault +1 −1 ■■■■■ ▸')
    expect(t).toContain('~ other.md +1 −1 ■■■■■ ▸')
    await pane.unmount()
  })

  test(`a reload of the module keeps the chip: the card's edits come back (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const files = new Map<string, string>()
    peer(files, { id: 'peer', edits: [NOTES] })
    bottom(on, files, { isRepo: true, status: [' M notes.md'], runs: [] })
    await $.session.start({ cwd: '/home/me/vault', surface, isInteractive: true })
    await edit($, [NOTES])
    await clock.advance(5_000)
    await $.session.start({ cwd: '/home/me/vault', surface, isInteractive: true })
    await clock.advance(5_000)
    expect(await strip($, surface)).toBe('current ✓ Done │ others ◔1 ⚠ notes.md · vault ☰ All ›')
    const card = JSON.parse(files.get(`${DIR}/me.json`) ?? '{}') as { edits?: string[] }
    expect(card.edits).toEqual([NOTES])
  })
}
