import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { fakeRepo, stubGit } from './repo'
import type { Repo } from './repo'

// Which layout the two rows use: the wide one, or the narrow one below 115 columns (short labels, no untracked slot, no
// weekly reset). The width is the surface's own measure, `e.viewport.columns` on the `ui.render` envelope: on the
// terminal the conversation's columns, re-drawn when the width changes. The PromptHint component carries no width in
// its props (its props are `isDraft`, `isWorking`, `hint` and `tail`), so a `bodyColumns` there is something the
// engine never sends: the gauge read it, never got it, and drew the wide layout at every width.
//
// 115 is not a taste: the widest wide row, with every item at its longest, is 113 columns. Below that a meter or the
// cache chip wraps onto a third line. The budget test below holds the threshold to the rows, so a new item that
// widens them fails there, and says to raise the threshold.
//
// The cache timer and the cache rate sit in the clock chip with the session time ("⏱ 1h 12m ⏳ 60m 90%"), and the git
// chip ("main ↓2 ±4 ?2 ↑1") ends the row. The git chip widens row 1 by up to 36 cells, so in a repository the layout
// gives way: the branch name takes the room that is left (up to 16 cells, none under 4), the untracked slot is in every
// wide pane, and the speed waits for 85 columns. Without the chip on the row (git off in /config, or no repository)
// every threshold is the one above. The budget tests draw every item at its longest, the cache "cold" and a rate of
// 100% included, which is the longest clock chip.
//
// The session's folder starts the git chip and shares its room with the branch: up to 33 cells for both and a ":",
// so the widest row 1 is 140 cells from 146 columns up (4 for the footer's padding, 2 to spare). Without the chip it is its own item, three spaces after the row,
// up to 16 cells. A test that passes no folder (`where`) draws none: the engine is not asked where the session runs.

const HINT = { isDraft: false, isWorking: false, hint: '? for shortcuts' }
const START = Date.parse('2026-10-13T10:00:00')
const MIN = 60_000

type Surface = 'terminal' | 'desktop'

type Scenario = {
  model: string
  effort: string
  /** How far into the session the rows are drawn. */
  minutesIn: number
  context: Record<string, unknown>
  rateLimits: { kind: string; percentUsed: number; resetsAt: string }[]
  cost: number
  /** The one answered request: how long it streamed, and what it reported. */
  streamMs: number
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }
}

/** An ordinary session 72 minutes in: every item the rows can hold is on them. */
const TYPICAL: Scenario = {
  model: 'claude-opus-4-1-20250805',
  effort: 'high',
  minutesIn: 72,
  context: { tokens: 84_000, window: 200_000, percent: 42 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 71, resetsAt: '2026-10-13T14:40:00' },
    { kind: 'seven_day', percentUsed: 18, resetsAt: '2026-10-19T09:00:00' },
  ],
  cost: 3.84,
  streamMs: 2_000,
  usage: { input_tokens: 1_000, output_tokens: 124, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 9_000 },
}

/**
 * Every item at its longest: the longest model id, the longest effort name, hours and minutes of session time, every
 * input token read from the cache (a cache rate of 100%), a two-digit cost, a three-digit speed, both limits at 100%
 * (which also puts the cache on its five-minute lifetime), a reset with minutes, and the weekly date at its longest.
 */
const HEAVY: Scenario = {
  model: 'claude-haiku-4-5-20251001',
  effort: 'xhigh',
  minutesIn: 12 * 60 + 40,
  context: { tokens: 1_000_000, window: 1_000_000, percent: 100 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 100, resetsAt: '2026-10-14T00:40:00' },
    { kind: 'seven_day', percentUsed: 100, resetsAt: '2026-10-21T12:30:00' },
  ],
  cost: 12.34,
  streamMs: 2_000,
  usage: { input_tokens: 0, output_tokens: 240, cache_read_input_tokens: 1_200_000, cache_creation_input_tokens: 0 },
}

/**
 * Glyphs two cells wide. ⏱ is counted as two as well: terminals differ on it, and the safe side is the wider. CJK
 * ideographs and kana are two cells on every terminal (counted here on their own, not with the gauge's cellWidth).
 */
const TWO_CELLS = new Set(['⚡', '⏳', '⏱'])
const isWide = (c: string): boolean => {
  const cp = c.codePointAt(0) ?? 0
  return (cp >= 0x3040 && cp <= 0x30ff) || (cp >= 0x4e00 && cp <= 0x9fff)
}
const cells = (s: string): number => [...s].reduce((n, c) => n + (TWO_CELLS.has(c) || isWide(c) ? 2 : 1), 0)

/** Where the engine says the session runs. Absent: the engine is not asked to say, and no folder is drawn. */
type Where = { root: string; cwd: string }

/** A session with one request answered, drawn into surfaces of any size. With a `repo`, in that repository; with a `where`, in that folder. */
async function drawn($: Engine, on: On, surface: Surface, s: Scenario = TYPICAL, repo?: Repo, where?: Where) {
  const clock = mock.clock(on, { now: START + s.minutesIn * MIN })
  on('session.usage', () => ({
    value: { startedAt: START, context: s.context, rateLimits: s.rateLimits, cost: { usd: s.cost } } as never,
  }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.model', () => ({ value: s.model }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine-own" />
  })
  on('turn.step', async function* (_$, e) {
    yield { kind: 'text', index: 0, text: 'Hi' } as never
    await clock.advance(s.streamMs)
    return { turnId: e.turnId, index: e.index, answer: 'Hi', toolUses: [], stopReason: 'end_turn', usage: s.usage } as never
  })
  if (repo) stubGit(on, repo)
  if (where) {
    on('session.root', () => ({ value: where.root }))
    on('session.cwd', () => ({ value: where.cwd }))
  }
  await $.session.start({ cwd: where?.cwd ?? '/home/me/vault', surface, isInteractive: true })
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: s.model, effort: s.effort as never, messageCount: 1 })) {
    // drain
  }
  await $.turn.complete({ answer: 'Hi', durationMs: s.streamMs, isAborted: false, turnId: 't1', reason: 'answer', usage: { model: s.model, ...s.usage } } as never)
  // Git and the folder are read in the background: let them settle before anything is drawn.
  if (repo || where) await clock.advance(0)

  type Target = { viewport?: { columns: number; rows: number }; props?: Record<string, unknown> }
  const mount = ($: Engine, target: Target) =>
    $.ui.mount({
      plugin: 'usage-gauge', surface, component: 'PromptHint',
      props: { ...HINT, ...target.props } as never,
      ...(target.viewport ? { viewport: target.viewport } : {}),
    })

  return {
    clock,
    /** Both rows, whitespace folded, as drawn into a surface of this size (no viewport: the surface has not measured). */
    async draw(target: Target) {
      const band = await mount($, target)
      const text = async (key: string) => (await band.find({ key }))?.text.replace(/\s+/g, ' ').trim() ?? ''
      const out = { r1: await text('ug-row1'), r2: await text('ug-row2') }
      await band.unmount()
      return out
    },
    /** How many terminal cells each row needs on one line, spaces kept. */
    async measure(columns: number) {
      const band = await mount($, { viewport: { columns, rows: 30 } })
      const w = async (key: string) => cells((await band.find({ key }))?.text ?? '')
      const out = { w1: await w('ug-row1'), w2: await w('ug-row2') }
      await band.unmount()
      return out
    },
  }
}

const WIDE = {
  r1: 'claude-opus-4-1-20250805 ● high ⏱ 1h 12m ⏳ 60m 90% $3.84 ⚡ 62 t/s',
  r2: 'context ▰▰▰▰▱▱▱▱▱▱ 42% 84k 5 hour ▰▰▰▰▰▰▰▱▱▱ 71% ↻ 2:40pm weekly ▰▱▱▱▱▱▱▱▱▱ 18% ↻ Mon 19 Oct 9am',
}
const NARROW = {
  r1: 'opus-4-1 ● high ⏱ 1h 12m ⏳ 60m 90% $3.84 ⚡ 62 t/s',
  r2: 'ctx ▰▰▰▰▱▱▱▱▱▱ 42% 84k 5h ▰▰▰▰▰▰▰▱▱▱ 71% ↻ 2:40pm wk ▰▱▱▱▱▱▱▱▱▱ 18%',
}
const HEAVY_WIDE = {
  r1: 'claude-haiku-4-5-20251001 ◉ xhigh ⏱ 12h 40m ⏳ 5m 100% $12.34 ⚡ 120 t/s',
  r2: 'context ▰▰▰▰▰▰▰▰▰▰ 100% 1.0M 5 hour ▰▰▰▰▰▰▰▰▰▰ 100% ↻ 12:40am weekly ▰▰▰▰▰▰▰▰▰▰ 100% ↻ Wed 21 Oct 12:30pm',
}
const HEAVY_NARROW = {
  r1: 'haiku-4-5 ◉ xhigh ⏱ 12h 40m ⏳ 5m 100% $12.34 ⚡ 120 t/s',
  r2: 'ctx ▰▰▰▰▰▰▰▰▰▰ 100% 1.0M 5h ▰▰▰▰▰▰▰▰▰▰ 100% ↻ 12:40am wk ▰▰▰▰▰▰▰▰▰▰ 100%',
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the layout follows the surface's measured width: narrow below 115 columns, wide from 115 (${surface})`, async ($, on) => {
    const { draw } = await drawn($, on, surface)
    for (const [columns, want] of [
      [40, NARROW], [60, NARROW], [89, NARROW], [90, NARROW], [100, NARROW], [114, NARROW],
      [115, WIDE], [120, WIDE], [200, WIDE],
    ] as const) {
      expect(await draw({ viewport: { columns, rows: 30 } }), `${columns} columns`).toEqual(want)
    }
  })

  test(`a surface that has not measured gets the wide layout, and so does a width of 0 (${surface})`, async ($, on) => {
    const { draw } = await drawn($, on, surface)
    expect(await draw({})).toEqual(WIDE)
    expect(await draw({ viewport: { columns: 0, rows: 0 } })).toEqual(WIDE)
  })

  test(`a reply too quick to time leaves no speed to show: the speed chip takes no room, wide or narrow (${surface})`, async ($, on) => {
    const { draw } = await drawn($, on, surface, { ...TYPICAL, streamMs: 0 })
    expect((await draw({ viewport: { columns: 200, rows: 30 } })).r1).toBe('claude-opus-4-1-20250805 ● high ⏱ 1h 12m ⏳ 60m 90% $3.84')
    expect((await draw({ viewport: { columns: 100, rows: 30 } })).r1).toBe('opus-4-1 ● high ⏱ 1h 12m ⏳ 60m 90% $3.84')
  })

  test(`a bodyColumns in the props is not a width: the engine sends none to this component (${surface})`, async ($, on) => {
    const { draw } = await drawn($, on, surface)
    // Read as a width, this would draw the narrow layout. It is not one, so the unmeasured surface draws wide...
    expect(await draw({ props: { bodyColumns: 60 } })).toEqual(WIDE)
    // ...and a measured width decides, whatever the props say.
    expect(await draw({ props: { bodyColumns: 200 }, viewport: { columns: 60, rows: 30 } })).toEqual(NARROW)
  })

  // ── the budget: no row needs more than the width it is drawn into ──────────

  test(`the widest rows draw as expected, so the budget below is measured on the longest items (${surface})`, async ($, on) => {
    const { draw } = await drawn($, on, surface, HEAVY)
    expect(await draw({ viewport: { columns: 140, rows: 30 } })).toEqual(HEAVY_WIDE)
    expect(await draw({ viewport: { columns: 80, rows: 30 } })).toEqual(HEAVY_NARROW)
  })

  test(`at every width from 80 columns up, the layout chosen fits each row on one line, with every item at its longest (${surface})`, async ($, on) => {
    const { measure } = await drawn($, on, surface, HEAVY)
    const widths = [...Array.from({ length: 51 }, (_, i) => 80 + i), 140, 160, 200, 300]
    for (const columns of widths) {
      const { w1, w2 } = await measure(columns)
      expect(w1, `row 1 needs ${w1} cells in ${columns} columns`).toBeLessThanOrEqual(columns)
      expect(w2, `row 2 needs ${w2} cells in ${columns} columns`).toBeLessThanOrEqual(columns)
    }
  })

  test(`the widest wide row is 113 cells, so 115 keeps 2 to spare; the widest narrow row is 74, so 80 columns is enough (${surface})`, async ($, on) => {
    const { measure } = await drawn($, on, surface, HEAVY)
    const wide = await measure(115)
    expect(Math.max(wide.w1, wide.w2)).toBe(113)
    const narrow = await measure(114)
    expect(Math.max(narrow.w1, narrow.w2)).toBe(74)
  })

  // ── the git chip: branch ↓ ± ? ↑ on row 1, and what gives way for it ────────

  const BASE = 'claude-opus-4-1-20250805 ● high ⏱ 1h 12m ⏳ 60m 90% $3.84 ⚡ 62 t/s'
  const SHORT = 'opus-4-1 ● high ⏱ 1h 12m ⏳ 60m 90% $3.84'
  const SPEED = '⚡ 62 t/s'
  const TYPICAL_REPO = { behind: 2, ahead: 1, modified: 3, staged: 1, untracked: 2 }

  test(`in a repository the pane gives way in order: the speed waits for 85 columns, the untracked slot is in every wide pane (${surface})`, async ($, on) => {
    const { draw } = await drawn($, on, surface, TYPICAL, fakeRepo(TYPICAL_REPO))
    for (const [columns, r1] of [
      // The narrowest panes: the speed gives way to the git chip, and the branch has the room it leaves.
      [80, `${SHORT} main ↓2 ±4 ↑1`],
      [84, `${SHORT} main ↓2 ±4 ↑1`],
      // Narrow: the short model name, no untracked slot. Row 2 is the narrow one.
      [100, `${SHORT} ${SPEED} main ↓2 ±4 ↑1`],
      [114, `${SHORT} ${SPEED} main ↓2 ±4 ↑1`],
      // Wide: the untracked slot, and row 2 keeps its weekly reset.
      [115, `${BASE} main ↓2 ±4 ?2 ↑1`],
      [200, `${BASE} main ↓2 ±4 ?2 ↑1`],
    ] as const) {
      const got = await draw({ viewport: { columns, rows: 30 } })
      expect(got.r1, `${columns} columns`).toBe(r1)
      expect(got.r2, `${columns} columns`).toBe(columns < 115 ? NARROW.r2 : WIDE.r2)
    }
  })

  test(`the branch name takes the room that is left: cut with … to fit (${surface})`, async ($, on) => {
    const { draw } = await drawn($, on, surface, TYPICAL, fakeRepo({ ...TYPICAL_REPO, branch: 'feature/very-long-branch-name' }))
    for (const [columns, r1] of [
      // The room is what the drawn row leaves (0.13.1): 4 for the footer's padding, 2 to spare, up to 16.
      [80, `${SHORT} feature/very… ↓2 ±4 ↑1`], // no speed: 80 - 4 - 2 - (49 + 3 + 1 + 8) = 13 cells
      [84, `${SHORT} feature/very-lo… ↓2 ±4 ↑1`], // 17, so 16
      // The speed comes in at 85 and takes the branch's room; it grows again as the pane does.
      [85, `${SHORT} ${SPEED} featu… ↓2 ±4 ↑1`], // 85 - 4 - 2 - (61 + 3 + 1 + 8) = 6 cells
      [88, `${SHORT} ${SPEED} feature/… ↓2 ±4 ↑1`], // 9 cells
      [91, `${SHORT} ${SPEED} feature/ver… ↓2 ±4 ↑1`], // 12 cells
      [95, `${SHORT} ${SPEED} feature/very-lo… ↓2 ±4 ↑1`], // 16 cells, the most
      [115, `${BASE} feature/very-lo… ↓2 ±4 ?2 ↑1`],
      [125, `${BASE} feature/very-lo… ↓2 ±4 ?2 ↑1`],
    ] as const) {
      expect((await draw({ viewport: { columns, rows: 30 } })).r1, `${columns} columns`).toBe(r1)
    }
  })

  test(`a detached HEAD shows the commit's short hash where the branch goes (${surface})`, async ($, on) => {
    const { draw } = await drawn($, on, surface, TYPICAL, fakeRepo({ detached: true }))
    expect((await draw({ viewport: { columns: 200, rows: 30 } })).r1).toBe(`${BASE} aaaaaaa ↓0 ±0 ↑0`)
  })

  test(`a surface that has not measured is drawn in full, the speed and a branch of 16 both (${surface})`, async ($, on) => {
    const { draw } = await drawn($, on, surface, TYPICAL, fakeRepo({ ...TYPICAL_REPO, branch: 'feature/very-long-branch-name' }))
    const full = { r1: `${BASE} feature/very-lo… ↓2 ±4 ?2 ↑1`, r2: WIDE.r2 }
    expect(await draw({})).toEqual(full)
    expect(await draw({ viewport: { columns: 0, rows: 0 } })).toEqual(full)
  })

  test(`with the git chip off, every threshold is the one the gauge always had (${surface})`, { options: { showGit: false } }, async ($, on) => {
    const { draw } = await drawn($, on, surface, TYPICAL, fakeRepo(TYPICAL_REPO))
    for (const [columns, want] of [[80, NARROW], [114, NARROW], [115, WIDE], [200, WIDE]] as const) {
      expect(await draw({ viewport: { columns, rows: 30 } }), `${columns} columns`).toEqual(want)
    }
  })

  // Every item at its longest: a hundred of everything in the repository, a branch name too long to fit, and the cache
  // gone cold, which with a rate of 100% is the longest the clock chip gets ("cold" is 4 characters, a number of minutes
  // at most 3).
  const HEAVY_REPO = { behind: 150, ahead: 150, modified: 150, untracked: 150, branch: 'feature/very-long-branch-name' }
  const COLD = 6 * 60_000

  test(`the widest rows with the git chip, every item at its longest (${surface})`, async ($, on) => {
    const { draw } = await drawn($, on, surface, HEAVY, fakeRepo(HEAVY_REPO))
    const head = 'haiku-4-5 ◉ xhigh ⏱ 12h 40m ⏳ 5m 100% $12.34'
    const wide = 'claude-haiku-4-5-20251001 ◉ xhigh ⏱ 12h 40m ⏳ 5m 100% $12.34 ⚡ 120 t/s'
    expect(await draw({ viewport: { columns: 140, rows: 30 } })).toEqual({
      r1: `${wide} feature/very-lo… ↓99+ ±99+ ?99+ ↑99+`,
      r2: HEAVY_WIDE.r2,
    })
    // The cache is warm here ("5m", 2 cells shorter than "cold"), so each room is 2 cells more than the longest row's;
    // each room leaves 4 cells for the footer's padding and 2 to spare.
    expect((await draw({ viewport: { columns: 120, rows: 30 } })).r1).toBe(`${wide} feature/… ↓99+ ±99+ ?99+ ↑99+`)
    expect((await draw({ viewport: { columns: 100, rows: 30 } })).r1).toBe(`${head} ⚡ 120 t/s feature/v… ↓99+ ±99+ ↑99+`)
    expect((await draw({ viewport: { columns: 85, rows: 30 } })).r1).toBe(`${head} ⚡ 120 t/s ↓99+ ±99+ ↑99+`)
    expect((await draw({ viewport: { columns: 80, rows: 30 } })).r1).toBe(`${head} ↓99+ ±99+ ↑99+`)
  })

  const OPTION_SETS: [string, Record<string, boolean>][] = [
    ['everything on', {}],
    ['speed off', { showSpeed: false }],
    ['git off', { showGit: false }],
    ['cache off', { showCache: false }],
    ['time off', { showTime: false }],
    ['only the chips and the git chip', { showTime: false, showCost: false, showSpeed: false, showCache: false }],
  ]
  for (const [name, options] of OPTION_SETS) {
    test(`at every width from 80 columns up each row fits on one line, everything at its longest: ${name} (${surface})`, { options }, async ($, on) => {
      const { measure, clock } = await drawn($, on, surface, HEAVY, fakeRepo(HEAVY_REPO))
      await clock.advance(COLD)
      const widths = [...Array.from({ length: 81 }, (_, i) => 80 + i), 200, 300]
      for (const columns of widths) {
        const { w1, w2 } = await measure(columns)
        expect(w1, `row 1 needs ${w1} cells in ${columns} columns`).toBeLessThanOrEqual(columns)
        expect(w2, `row 2 needs ${w2} cells in ${columns} columns`).toBeLessThanOrEqual(columns)
      }
    })
  }

  test(`row 1 at its longest per layout, 4 cells for the footer and 2 to spare: the branch fills what is left (${surface})`, async ($, on) => {
    const { measure, clock } = await drawn($, on, surface, HEAVY, fakeRepo(HEAVY_REPO))
    await clock.advance(COLD)
    // [columns, cells row 1 needs]
    for (const [columns, cells] of [
      [300, 123], // untracked slot, a branch of 16: the widest row there is
      [129, 123], // the branch reaches 16: 129 - 4 - 2 - 107
      [125, 119], // a branch of 12
      [115, 106], // the narrowest wide pane: 2 cells of room, no branch
      [114, 102], // narrow, a branch of 16
      [96, 90], // narrow, a branch of 4
      [95, 85], // 3 cells of room: no branch
      [85, 85], // the speed's old rule: the longest row is as wide as the pane (older than 0.13.1)
      [84, 78], // no speed, a branch of 5
      [80, 72], // no speed, 1 cell of room: no branch
    ] as const) {
      expect((await measure(columns)).w1, `${columns} columns`).toBe(cells)
    }
    // Row 2 is the one it always was.
    expect((await measure(115)).w2).toBe(113)
    expect((await measure(114)).w2).toBe(74)
  })

  test(`the cache gone cold at a rate of 100% is the longest clock chip: "cold" is 4 characters, a number of minutes at most 3 (${surface})`, async ($, on) => {
    const { draw, clock } = await drawn($, on, surface, HEAVY)
    await clock.advance(COLD)
    expect((await draw({ viewport: { columns: 200, rows: 30 } })).r1).toContain('⏱ 12h 46m ⏳ cold 100%')
  })

  // ── the session's folder: it shares the git chip's room, or is its own item ──

  // A root name too long for its 16 cells, at the root and moved under it, and a CJK root whose characters take two
  // cells each: the room is shared by the folder's cells, not its characters.
  const LONG = '/home/me/a-very-long-project-folder'
  const CJK = '/home/me/工作流改造術'
  const WHERES: [string, Where][] = [
    ['a long root, at it', { root: LONG, cwd: LONG }],
    ['a long root, moved under it', { root: LONG, cwd: `${LONG}/sub` }],
    ['a CJK root, at it', { root: CJK, cwd: CJK }],
    ['a CJK root, moved under it', { root: CJK, cwd: `${CJK}/資料` }],
  ]
  for (const [where, w] of WHERES) {
    for (const [name, options] of OPTION_SETS) {
      test(`at every width from 80 columns up each row fits on one line, with the folder: ${where}, ${name} (${surface})`, { options }, async ($, on) => {
        const { measure, clock } = await drawn($, on, surface, HEAVY, fakeRepo(HEAVY_REPO), w)
        await clock.advance(COLD)
        const widths = [...Array.from({ length: 81 }, (_, i) => 80 + i), 200, 300]
        for (const columns of widths) {
          const { w1, w2 } = await measure(columns)
          expect(w1, `row 1 needs ${w1} cells in ${columns} columns`).toBeLessThanOrEqual(columns)
          expect(w2, `row 2 needs ${w2} cells in ${columns} columns`).toBeLessThanOrEqual(columns)
        }
      })
    }
  }

  // A branch of wide characters: 8 characters, 15 cells. It is measured and cut in cells, with the folder or without it.
  const CJK_BRANCH_REPO = { ...HEAVY_REPO, branch: '功能/文件夹显示' }
  const CJK_BRANCH_CASES: [string, Where | undefined, Record<string, boolean>][] = [
    ['the folder off', undefined, { showFolder: false }],
    ['at the root', { root: LONG, cwd: LONG }, {}],
    ['moved under it', { root: LONG, cwd: `${LONG}/sub` }, {}],
  ]
  for (const [name, w, options] of CJK_BRANCH_CASES) {
    test(`at every width from 80 columns up each row fits on one line, with a CJK branch: ${name} (${surface})`, { options }, async ($, on) => {
      const { measure, clock } = await drawn($, on, surface, HEAVY, fakeRepo(CJK_BRANCH_REPO), w)
      await clock.advance(COLD)
      const widths = [...Array.from({ length: 81 }, (_, i) => 80 + i), 200, 300]
      for (const columns of widths) {
        const { w1 } = await measure(columns)
        expect(w1, `row 1 needs ${w1} cells in ${columns} columns`).toBeLessThanOrEqual(columns)
      }
    })
  }

  test(`row 1 at its longest with the folder: 106 + 33 + 1 = 140 cells, from 146 columns (${surface})`, async ($, on) => {
    const { measure, draw, clock } = await drawn($, on, surface, HEAVY, fakeRepo(HEAVY_REPO), { root: LONG, cwd: `${LONG}/sub` })
    await clock.advance(COLD)
    expect((await measure(300)).w1).toBe(140)
    expect((await measure(146)).w1).toBe(140)
    expect((await measure(145)).w1).toBe(139)
    expect((await draw({ viewport: { columns: 300, rows: 30 } })).r1).toContain('a-very-long…›sub:feature/very-lo… ↓99+')
  })

  test(`the folder as its own item, three spaces after the row: 84 cells before it in a wide pane, 68 in a narrow one (${surface})`, { options: { showGit: false } }, async ($, on) => {
    const { measure, clock } = await drawn($, on, surface, HEAVY, fakeRepo(HEAVY_REPO), { root: LONG, cwd: LONG })
    await clock.advance(COLD)
    expect((await measure(300)).w1).toBe(84 + 3 + 16)
    expect((await measure(115)).w1).toBe(84 + 3 + 16)
    expect((await measure(114)).w1).toBe(68 + 3 + 16)
    expect((await measure(84)).w1).toBe(68 + 3 + 7)
    expect((await measure(80)).w1).toBe(68) // 3 cells of room: no folder
  })
}
