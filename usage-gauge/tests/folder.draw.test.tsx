import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { fakeRepo, stubGit } from './repo'
import type { Repo } from './repo'

// The session's folder at the start of the git chip: "vault:main ↓0 ±0 ↑0" at the root, "vault›mods:main" in the
// theme's warning colour once the session has moved under it, the folder's own name in the error colour outside it, and
// the folder as its own row-1 item where there is no git chip. The folder is read at session start, on the 15-second
// refresh, at the end of a main turn and before each main-loop tool call; a subagent's call is never read, its folder is
// its own. The cutting and the shared room are in folder.test.ts, the widths in width.test.tsx.

const HINT = { isDraft: false, isWorking: false, hint: '? for shortcuts' }
const START = Date.parse('2026-10-13T10:00:00')
const MIN = 60_000

/** Row 1 before the git chip, as git.test.tsx draws it. */
const HEAD = 'claude-opus-4-1-20250805 ● high ⏱ 1h 12m ⏳ 60m 90% $3.84 ⚡ 62 t/s'

/** Where the engine says the session is. `fails`: the next cwd() is refused. */
type Where = { root: string; cwd: string; fails?: boolean }

async function start($: Engine, on: On, where: Where, repo: Repo | undefined) {
  const clock = mock.clock(on, { now: START + 72 * MIN })
  /** How many times a surface drew the rows: the gauge's render reaches the engine's own beneath it once per draw. */
  let draws = 0
  on('session.usage', () => ({
    value: {
      startedAt: START,
      context: { tokens: 84_000, window: 200_000, percent: 42 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 71, resetsAt: '2026-10-13T14:40:00' },
        { kind: 'seven_day', percentUsed: 18, resetsAt: '2026-10-19T09:00:00' },
      ],
      cost: { usd: 3.84 },
    } as never,
  }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.model', () => ({ value: 'claude-opus-4-1-20250805' }))
  on('session.root', () => ({ value: where.root }))
  on('session.cwd', () => (where.fails ? { deny: 'refused' } : { value: where.cwd }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('tool.call', () => ({ result: 'ok' }))
  on('ui.render', ($, e) => {
    draws++
    const { Box } = $.ui.resolve(e)
    return <Box key="engine-own" />
  })
  const usage = { input_tokens: 1_000, output_tokens: 124, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 9_000 }
  on('turn.step', async function* (_$, e) {
    yield { kind: 'text', index: 0, text: 'Hi' } as never
    await clock.advance(2_000)
    return { turnId: e.turnId, index: e.index, answer: 'Hi', toolUses: [], stopReason: 'end_turn', usage } as never
  })
  if (repo) stubGit(on, repo)

  await $.session.start({ cwd: where.cwd, surface: 'terminal', isInteractive: true })
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-4-1-20250805', effort: 'high', messageCount: 1 })) {
    // drain
  }
  await $.turn.complete({ answer: 'Hi', durationMs: 2000, isAborted: false, turnId: 't1', reason: 'answer', usage: { model: 'claude-opus-4-1-20250805', ...usage } } as never)
  await clock.advance(0)

  const mount = (columns = 200) => $.ui.mount({ plugin: 'usage-gauge', surface: 'terminal', component: 'PromptHint', props: HINT, viewport: { columns, rows: 30 } })
  return {
    /** Time passes: the 15 s ticks fire and what they started settles. */
    pass: (ms: number) => clock.advance(ms),
    /** The rows, mounted and left drawn: each write that lands redraws them. */
    mount,
    draws: () => draws,
    /** Row 1, whitespace folded, in a pane this wide. */
    async row1(columns = 200): Promise<string> {
      const band = await mount(columns)
      const text = (await band.find({ key: 'ug-row1' }))?.text.replace(/\s+/g, ' ').trim() ?? ''
      await band.unmount()
      return text
    },
    /** Row 1 as drawn, spaces kept. */
    async raw1(columns = 200): Promise<string> {
      const band = await mount(columns)
      const text = (await band.find({ key: 'ug-row1' }))?.text ?? ''
      await band.unmount()
      return text
    },
    /** The theme colour ('' for none) of the one Text in row 1 that holds exactly this string; undefined: no such Text. */
    async colour(content: string): Promise<string | undefined> {
      const band = await mount()
      let found: string | undefined
      const walk = (node: unknown): void => {
        const n = node as { props?: { color?: string }; children?: unknown[] } | string | undefined
        if (n === undefined || typeof n === 'string') return
        const text = (n.children ?? []).filter(c => typeof c === 'string').join('')
        if (text === content) found = n.props?.color ?? ''
        else for (const c of n.children ?? []) walk(c)
      }
      walk(await band.find({ key: 'ug-row1' }))
      await band.unmount()
      return found
    },
  }
}

test('at the root: the root\'s name starts the git chip, in no colour', async ($, on) => {
  const gauge = await start($, on, { root: '/home/me/vault', cwd: '/home/me/vault' }, fakeRepo())
  expect(await gauge.row1()).toBe(`${HEAD} vault:main ↓0 ±0 ↑0`)
  expect(await gauge.colour('vault')).toBe('')
})

test('moved under the root: the 15-second refresh shows the folder it moved into, in the warning colour', async ($, on) => {
  const where: Where = { root: '/home/me/vault', cwd: '/home/me/vault' }
  const gauge = await start($, on, where, fakeRepo())
  where.cwd = '/home/me/vault/.claude/mods'
  await gauge.pass(15_000)
  expect(await gauge.row1()).toBe(`${HEAD} vault›mods:main ↓0 ±0 ↑0`)
  expect(await gauge.colour('vault›mods')).toBe('warning')
})

test('a main-loop tool call reads the folder before it runs, with no wait for the refresh', async ($, on) => {
  const where: Where = { root: '/home/me/vault', cwd: '/home/me/vault' }
  const gauge = await start($, on, where, fakeRepo())
  where.cwd = '/home/me/vault/sub'
  await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
  await gauge.pass(0)
  expect(await gauge.row1()).toBe(`${HEAD} vault›sub:main ↓0 ±0 ↑0`)
})

test('a subagent\'s tool call is not read: its folder is its own', async ($, on) => {
  const where: Where = { root: '/home/me/vault', cwd: '/home/me/vault' }
  const gauge = await start($, on, where, fakeRepo())
  where.cwd = '/elsewhere/worktree'
  await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'a1' } as never)
  await gauge.pass(0)
  expect(await gauge.row1()).toBe(`${HEAD} vault:main ↓0 ±0 ↑0`)
})

test('outside the root: the folder\'s own name, in the error colour', async ($, on) => {
  const gauge = await start($, on, { root: '/home/me/vault', cwd: '/srv/other' }, fakeRepo())
  expect(await gauge.row1()).toBe(`${HEAD} other:main ↓0 ±0 ↑0`)
  expect(await gauge.colour('other')).toBe('error')
})

test('a refused cwd() keeps the last folder, and the row still draws', async ($, on) => {
  const where: Where = { root: '/home/me/vault', cwd: '/home/me/vault/sub' }
  const gauge = await start($, on, where, fakeRepo())
  where.fails = true
  await gauge.pass(15_000)
  await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
  await gauge.pass(0)
  expect(await gauge.row1()).toBe(`${HEAD} vault›sub:main ↓0 ±0 ↑0`)
})

test('not in a repository: the folder is its own item, three spaces after the one before', async ($, on) => {
  const repo = fakeRepo()
  repo.isRepo = false
  const gauge = await start($, on, { root: '/home/me/vault', cwd: '/home/me/vault' }, repo)
  expect(await gauge.row1()).toBe(`${HEAD} vault`)
  expect(await gauge.raw1()).toMatch(/t\/s {3}vault$/)
})

test('with the git chip off in /config, the folder is its own item', { options: { showGit: false } }, async ($, on) => {
  const gauge = await start($, on, { root: '/home/me/vault', cwd: '/home/me/vault/sub' }, fakeRepo())
  expect(await gauge.row1()).toBe(`${HEAD} vault›sub`)
  expect(await gauge.colour('vault›sub')).toBe('warning')
})

test('with the folder off in /config, row 1 is the one the gauge drew before it', { options: { showFolder: false } }, async ($, on) => {
  const gauge = await start($, on, { root: '/home/me/vault', cwd: '/home/me/vault/sub' }, fakeRepo())
  expect(await gauge.row1()).toBe(`${HEAD} main ↓0 ±0 ↑0`)
})

// ── found in the final review ──────────────────────────────────────────────

/** The owner's vault as the engine gives it on Windows: native separators (the 2026-11-21 spike). */
const VAULT = String.raw`C:\Src\personal-notes`
const MODS = String.raw`C:\Src\personal-notes\.claude\mods`

test('the spec\'s own row: personal-notes›mods whole in a wide pane, the folder\'s cap is what the branch leaves of 33', async ($, on) => {
  const gauge = await start($, on, { root: VAULT, cwd: MODS }, fakeRepo())
  expect(await gauge.row1(200)).toBe(`${HEAD} personal-notes›mods:main ↓0 ±0 ↑0`)
  expect(await gauge.row1(142)).toBe(`${HEAD} personal-notes›mods:main ↓0 ±0 ↑0`)
})

test('in a pane with 11 cells of room, at the root the branch keeps its room and the folder is cut', async ($, on) => {
  // 90 columns, narrow: the drawn row is 61 cells, the slots 8, so 90 - 4 - 2 - (61 + 3 + 1 + 8) = 11 cells.
  const gauge = await start($, on, { root: VAULT, cwd: VAULT }, fakeRepo())
  expect(await gauge.row1(90)).toBe(`${NARROW_HEAD} perso…:main ↓0 ±0 ↑0`)
})

test('in a pane with 11 cells of room, after a drift the folder keeps its room and the branch gives way', async ($, on) => {
  const gauge = await start($, on, { root: VAULT, cwd: MODS }, fakeRepo())
  expect(await gauge.row1(90)).toBe(`${NARROW_HEAD} perso…›mods ↓0 ±0 ↑0`)
})

test('tool calls in a folder that has not changed do not redraw the rows', async ($, on) => {
  const gauge = await start($, on, { root: '/home/me/vault', cwd: '/home/me/vault/sub' }, fakeRepo())
  const band = await gauge.mount()
  await gauge.pass(0)
  const before = gauge.draws()
  for (let i = 0; i < 5; i++) await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
  await gauge.pass(0)
  expect(gauge.draws() - before).toBe(0)
  await band.unmount()
})

test('a branch of wide characters is measured in cells: at the root it keeps its 15 cells and the folder gives way', async ($, on) => {
  const gauge = await start($, on, { root: '/home/me/vault', cwd: '/home/me/vault' }, fakeRepo({ branch: '功能/文件夹显示' }))
  // 95 columns, narrow: 16 cells of room; the branch takes its 15, and 0 are left for the folder.
  expect(await gauge.row1(95)).toBe(`${NARROW_HEAD} 功能/文件夹显示 ↓0 ±0 ↑0`)
})

// ── 0.13.1: the room is measured on the row that is drawn, not on the longest row there could be ──

/** Row 1 before the git chip in a narrow pane (below 115 columns): the short model name. */
const NARROW_HEAD = 'opus-4-1 ● high ⏱ 1h 12m ⏳ 60m 90% $3.84 ⚡ 62 t/s'

test('at 115 columns the whole personal-notes:main fits: the row drawn is 77 cells before the chip, not the longest 106', async ($, on) => {
  const gauge = await start($, on, { root: VAULT, cwd: VAULT }, fakeRepo({ modified: 3 }))
  expect(await gauge.row1(115)).toBe(`${HEAD} personal-notes:main ↓0 ±3 ↑0`)
})

test('at 100 columns, narrow, the whole personal-notes:main fits as well', async ($, on) => {
  const gauge = await start($, on, { root: VAULT, cwd: VAULT }, fakeRepo({ modified: 3 }))
  expect(await gauge.row1(100)).toBe(`${NARROW_HEAD} personal-notes:main ↓0 ±3 ↑0`)
})

test('the folder as its own item at 84 columns takes the 14 cells the drawn row leaves inside the footer', { options: { showGit: false } }, async ($, on) => {
  const gauge = await start($, on, { root: VAULT, cwd: VAULT }, fakeRepo({ modified: 3 }))
  expect(await gauge.row1(84)).toBe(`${NARROW_HEAD} personal-notes`)
})

/** Cells a terminal gives the text: the gauge's emoji and CJK take two (counted here on their own, not with cellWidth). */
const termCells = (s: string): number =>
  [...s].reduce((n, c) => {
    const cp = c.codePointAt(0) ?? 0
    return n + (cp === 0x23f1 || cp === 0x23f3 || cp === 0x26a1 || (cp >= 0x4e00 && cp <= 0x9fff) ? 2 : 1)
  }, 0)

for (const [where, cwd] of [['at the root', VAULT], ['moved under it', MODS]] as const) {
  test(`the owner's row stays inside the footer's padding, 4 cells in from the viewport, at every width: ${where}`, async ($, on) => {
    const gauge = await start($, on, { root: VAULT, cwd }, fakeRepo({ modified: 3 }))
    for (let columns = 80; columns <= 160; columns++) {
      const cells = termCells(await gauge.raw1(columns))
      expect(cells, `row 1 needs ${cells} cells in ${columns} columns`).toBeLessThanOrEqual(columns - 4)
    }
  })
}
