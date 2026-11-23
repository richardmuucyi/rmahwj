import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { fakeRepo, stubGit, subcommand } from './repo'
import type { Counts, Repo } from './repo'

// The git chip: the branch, then ↓ commits to pull, ± files to commit, ↑ commits to push in three fixed places, at the
// end of row 1. The cache timer is not a chip of its own any more: it sits in the clock chip, "⏱ 1h 12m ⏳ 60m 90%".
// The chip only reads the repository (status every 15 s and after each turn, a fetch every
// 5 minutes so ↓ is current), and the person can turn the slots, the fetch and each other row-1 item off in /config.

const HINT = { isDraft: false, isWorking: false, hint: '? for shortcuts' }
const START = Date.parse('2026-10-13T10:00:00')
const MIN = 60_000

type Surface = 'terminal' | 'desktop'

/** The scenario of width.test.tsx's TYPICAL: 72 minutes in, one answered request, so every row-1 item is on the row. */
async function start($: Engine, on: On, surface: Surface, repo: Repo | undefined) {
  const clock = mock.clock(on, { now: START + 72 * MIN })
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
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('ui.render', ($, e) => {
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

  await $.session.start({ cwd: '/home/me/vault', surface, isInteractive: true })
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-4-1-20250805', effort: 'high', messageCount: 1 })) {
    // drain
  }
  await $.turn.complete({ answer: 'Hi', durationMs: 2000, isAborted: false, turnId: 't1', reason: 'answer', usage: { model: 'claude-opus-4-1-20250805', ...usage } } as never)

  const mount = (columns?: number) =>
    $.ui.mount({ plugin: 'usage-gauge', surface, component: 'PromptHint', props: HINT, ...(columns ? { viewport: { columns, rows: 30 } } : {}) })
  return {
    clock,
    /** Time passes: the 15 s ticks fire and what they started settles. */
    async pass(ms: number) {
      await clock.advance(ms)
    },
    /** Row 1, whitespace folded. */
    async row1(columns?: number): Promise<string> {
      const band = await mount(columns)
      const text = (await band.find({ key: 'ug-row1' }))?.text.replace(/\s+/g, ' ').trim() ?? ''
      await band.unmount()
      return text
    },
    /** Row 1 as drawn, spaces kept. */
    async raw1(columns?: number): Promise<string> {
      const band = await mount(columns)
      const text = (await band.find({ key: 'ug-row1' }))?.text ?? ''
      await band.unmount()
      return text
    },
    /** Row 2, whitespace folded. */
    async row2(columns?: number): Promise<string> {
      const band = await mount(columns)
      const text = (await band.find({ key: 'ug-row2' }))?.text.replace(/\s+/g, ' ').trim() ?? ''
      await band.unmount()
      return text
    },
    /** The style of the one Text in row 1 that holds exactly this string: [theme colour or '', dim]. */
    async leaf(content: string): Promise<[string, boolean] | undefined> {
      const band = await mount()
      let found: [string, boolean] | undefined
      const walk = (node: unknown): void => {
        const n = node as { props?: { color?: string; dimColor?: boolean }; children?: unknown[] } | string | undefined
        if (n === undefined || typeof n === 'string') return
        const text = (n.children ?? []).filter(c => typeof c === 'string').join('')
        if (text === content) found = [n.props?.color ?? '', n.props?.dimColor === true]
        else for (const c of n.children ?? []) walk(c)
      }
      walk(await band.find({ key: 'ug-row1' }))
      await band.unmount()
      return found
    },
    /** The git slots as drawn: [text, theme colour or '', dim]. */
    async slots(columns?: number): Promise<[string, string, boolean][]> {
      const band = await mount(columns)
      const out: [string, string, boolean][] = []
      const walk = (node: unknown): void => {
        const n = node as { props?: { color?: string; dimColor?: boolean }; children?: unknown[] } | string | undefined
        if (n === undefined || typeof n === 'string') return
        const text = (n.children ?? []).filter(c => typeof c === 'string').join('')
        if (/^[↓±?↑]/.test(text)) out.push([text, n.props?.color ?? '', n.props?.dimColor === true])
        else for (const c of n.children ?? []) walk(c)
      }
      walk(await band.find({ key: 'ug-row1' }))
      await band.unmount()
      return out
    },
  }
}

/** Row 1 before the git chip: the model, the clock chip (session time, cache timer and cache rate), the cost and the speed. */
const HEAD = 'claude-opus-4-1-20250805 ● high ⏱ 1h 12m ⏳ 60m 90% $3.84 ⚡ 62 t/s'

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the branch, then three slots, at the end of the row: ↓ to pull, ± to commit, ↑ to push (${surface})`, async ($, on) => {
    const repo = fakeRepo({ behind: 2, ahead: 1, modified: 3, staged: 1 })
    const gauge = await start($, on, surface, repo)
    await gauge.pass(0)
    expect(await gauge.row1()).toBe(`${HEAD} main ↓2 ±4 ↑1`)
    // The rows around it are the ones the gauge always drew.
    expect(await gauge.row2()).toBe('context ▰▰▰▰▱▱▱▱▱▱ 42% 84k 5 hour ▰▰▰▰▰▰▰▱▱▱ 71% ↻ 2:40pm weekly ▰▱▱▱▱▱▱▱▱▱ 18% ↻ Mon 19 Oct 9am')
  })

  test(`files git does not track yet get a dim slot of their own, only when there are some (${surface})`, async ($, on) => {
    const repo = fakeRepo({ modified: 4, untracked: 2 })
    const gauge = await start($, on, surface, repo)
    await gauge.pass(0)
    expect(await gauge.row1()).toBe(`${HEAD} main ↓0 ±4 ?2 ↑0`)
    // They are not counted in ±: a repository can leave big files untracked on purpose, and a ± that never reached zero would say nothing.
    expect(await gauge.slots()).toEqual([['↓0', '', true], ['±4', '', false], ['?2', '', true], ['↑0', '', true]])
  })

  test(`a clean repository is three dim zeros, never a missing chip (${surface})`, async ($, on) => {
    const gauge = await start($, on, surface, fakeRepo())
    await gauge.pass(0)
    expect(await gauge.row1()).toBe(`${HEAD} main ↓0 ±0 ↑0`)
    expect(await gauge.slots()).toEqual([['↓0', '', true], ['±0', '', true], ['↑0', '', true]])
  })

  test(`a count is lit, in the theme's warning when the remote has news, in error when the branch has diverged (${surface})`, async ($, on) => {
    const repo = fakeRepo({ behind: 2 })
    const gauge = await start($, on, surface, repo)
    await gauge.pass(0)
    // Behind only: ↓ in warning, the zeros dim.
    expect(await gauge.slots()).toEqual([['↓2', 'warning', false], ['±0', '', true], ['↑0', '', true]])

    // Ahead only: ↑ lit in plain text, no colour of its own.
    repo.counts = { ...repo.counts, behind: 0, ahead: 3 }
    await gauge.pass(15_000)
    expect(await gauge.slots()).toEqual([['↓0', '', true], ['±0', '', true], ['↑3', '', false]])

    // Both: diverged. Both arrows in error.
    repo.counts = { ...repo.counts, behind: 2, ahead: 3 }
    await gauge.pass(15_000)
    expect(await gauge.slots()).toEqual([['↓2', 'error', false], ['±0', '', true], ['↑3', 'error', false]])
  })

  test(`a conflicted file counts in ± and puts it in error (${surface})`, async ($, on) => {
    const gauge = await start($, on, surface, fakeRepo({ modified: 2, conflicts: 1 }))
    await gauge.pass(0)
    expect(await gauge.slots()).toEqual([['↓0', '', true], ['±3', 'error', false], ['↑0', '', true]])
  })

  test(`a count over 99 is drawn 99+ (${surface})`, async ($, on) => {
    const gauge = await start($, on, surface, fakeRepo({ behind: 100, ahead: 99, modified: 250 }))
    await gauge.pass(0)
    expect((await gauge.slots()).map(s => s[0])).toEqual(['↓99+', '±99+', '↑99'])
  })

  test(`a branch with no upstream has nothing to pull or push: dashes, not zeros (${surface})`, async ($, on) => {
    const gauge = await start($, on, surface, fakeRepo({ ahead: null, modified: 3 }))
    await gauge.pass(0)
    expect(await gauge.slots()).toEqual([['↓–', '', true], ['±3', '', false], ['↑–', '', true]])
  })

  test(`outside a repository the slots are not drawn, and the row is the one the gauge always drew (${surface})`, async ($, on) => {
    const repo = fakeRepo()
    repo.isRepo = false
    const gauge = await start($, on, surface, repo)
    await gauge.pass(0)
    expect(await gauge.row1()).toBe(`${HEAD}`)
    // It stays quiet: no fetch from a folder that is no repository.
    await gauge.pass(10 * MIN)
    expect(repo.fetches).toBe(0)
  })

  test(`a git that cannot be run (no git installed) draws no slots and breaks nothing (${surface})`, async ($, on) => {
    on('process.run', () => ({ deny: 'spawn git ENOENT' }))
    const gauge = await start($, on, surface, undefined)
    await gauge.pass(0)
    expect(await gauge.row1()).toBe(`${HEAD}`)
  })

  test(`a git that stops answering leaves the last counts; one that says "not a repository" clears them (${surface})`, async ($, on) => {
    const repo = fakeRepo({ modified: 2, behind: 1 })
    const gauge = await start($, on, surface, repo)
    await gauge.pass(0)
    const lit = [['↓1', 'warning', false], ['±2', '', false], ['↑0', '', true]]
    expect(await gauge.slots()).toEqual(lit)

    // A timeout: the counts are not known to have changed, so they stay.
    repo.down = true
    await gauge.pass(15_000)
    expect(await gauge.slots()).toEqual(lit)

    // Back, and then the session leaves the repository (a worktree, another folder): the slots go.
    repo.down = false
    await gauge.pass(15_000)
    expect(await gauge.slots()).toEqual(lit)
    repo.isRepo = false
    await gauge.pass(15_000)
    expect(await gauge.row1()).not.toMatch(/[↓±↑]/)
    // ...and come back with the repository.
    repo.isRepo = true
    await gauge.pass(15_000)
    expect(await gauge.slots()).toEqual(lit)
  })

  test(`the counts follow the repository: status again every 15 s and after each turn (${surface})`, async ($, on) => {
    const repo = fakeRepo({ modified: 1 })
    const gauge = await start($, on, surface, repo)
    await gauge.pass(0)
    expect((await gauge.slots())[1]?.[0]).toBe('±1')

    repo.counts = { ...repo.counts, modified: 5 }
    await gauge.pass(15_000)
    expect((await gauge.slots())[1]?.[0]).toBe('±5')

    // A turn that ends reads git without waiting for the next tick.
    repo.counts = { ...repo.counts, modified: 0, ahead: 1 }
    await $.turn.complete({ answer: 'Hi', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer', usage: { model: 'm', input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } as never)
    await gauge.pass(0)
    expect(await gauge.slots()).toEqual([['↓0', '', true], ['±0', '', true], ['↑1', '', false]])
  })

  // ── the clock chip: the session time and the cache timer, one chip ───────────

  test(`the session time and the cache timer are one chip: one space between them, not the three of a gap (${surface})`, async ($, on) => {
    const gauge = await start($, on, surface, fakeRepo())
    await gauge.pass(0)
    const raw = await gauge.raw1()
    expect(raw).toContain('⏱ 1h 12m ⏳ 60m 90%')
    // ...and the chip is set apart from the cost by a gap.
    expect(raw).toContain('⏳ 60m 90%   $3.84')
  })

  // ── the branch ─────────────────────────────────────────────────────────────

  test(`the branch is plain text before the slots: no colour, not dim (${surface})`, async ($, on) => {
    const gauge = await start($, on, surface, fakeRepo({ branch: 'feature/login', behind: 1 }))
    await gauge.pass(0)
    expect(await gauge.row1()).toBe(`${HEAD} feature/login ↓1 ±0 ↑0`)
    expect(await gauge.leaf('feature/login')).toEqual(['', false])
    // One space between the branch and ↓, as between the slots.
    expect(await gauge.raw1()).toContain('feature/login ↓1 ±0 ↑0')
  })

  test(`a branch with no upstream still has its name: the dashes stand where ↓ and ↑ would (${surface})`, async ($, on) => {
    const gauge = await start($, on, surface, fakeRepo({ branch: 'feature-x', ahead: null, modified: 3 }))
    await gauge.pass(0)
    expect(await gauge.row1()).toBe(`${HEAD} feature-x ↓– ±3 ↑–`)
  })

  test(`a detached HEAD draws the commit's short hash for the branch (${surface})`, async ($, on) => {
    const gauge = await start($, on, surface, fakeRepo({ detached: true }))
    await gauge.pass(0)
    expect(await gauge.row1()).toBe(`${HEAD} aaaaaaa ↓0 ±0 ↑0`)
  })

  test(`the branch follows the checkout: a switch shows on the next look (${surface})`, async ($, on) => {
    const repo = fakeRepo()
    const gauge = await start($, on, surface, repo)
    await gauge.pass(0)
    expect(await gauge.row1()).toContain('main ↓0')
    repo.counts = { ...repo.counts, branch: 'release/2.0' }
    await gauge.pass(15_000)
    expect(await gauge.row1()).toContain('release/2.0 ↓0')
  })

  test(`the branch takes the room the drawn row leaves: cut at 85 columns, whole from 92 (${surface})`, async ($, on) => {
    // Narrow with the speed: the row drawn is 61 cells and the slots 8, so 85 columns leave 85 - 4 - 2 - 73 = 6 cells
    // (4 for the footer's padding, 2 to spare).
    // A row that leaves under 4 draws no branch: width.test.tsx draws one (the longest row at 85 columns).
    const gauge = await start($, on, surface, fakeRepo({ branch: 'feature/login' }))
    await gauge.pass(0)
    expect(await gauge.row1(85)).toBe('opus-4-1 ● high ⏱ 1h 12m ⏳ 60m 90% $3.84 ⚡ 62 t/s featu… ↓0 ±0 ↑0')
    expect(await gauge.row1(92)).toBe('opus-4-1 ● high ⏱ 1h 12m ⏳ 60m 90% $3.84 ⚡ 62 t/s feature/login ↓0 ±0 ↑0')
  })

  // ── the fetch: how ↓ learns what the remote has ───────────────────────────

  test(`a fetch at the start and then every 5 minutes, so ↓ shows what the remote has now (${surface})`, async ($, on) => {
    const repo = fakeRepo()
    // The remote gets two new commits: they reach this clone only by a fetch.
    let remote = 2
    repo.onFetch = c => {
      c.behind = remote
    }
    const gauge = await start($, on, surface, repo)
    await gauge.pass(0)
    expect(repo.fetches).toBe(1)
    expect((await gauge.slots())[0]?.[0]).toBe('↓2')

    remote = 5
    await gauge.pass(4 * MIN)
    expect(repo.fetches).toBe(1)
    expect((await gauge.slots())[0]?.[0]).toBe('↓2')
    await gauge.pass(MIN + 15_000)
    expect(repo.fetches).toBe(2)
    expect((await gauge.slots())[0]?.[0]).toBe('↓5')
  })

  test(`the fetch never stops to ask: prompts off, a timeout, and it never touches the working tree (${surface})`, async ($, on) => {
    const repo = fakeRepo()
    const gauge = await start($, on, surface, repo)
    await gauge.pass(0)
    const fetch = repo.runs.find(r => subcommand(r.argv) === 'fetch')
    expect(fetch).toBeDefined()
    expect(fetch?.init?.env).toEqual({ GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' })
    expect(fetch?.init?.timeoutMs).toBeGreaterThan(0)
    expect(fetch?.init?.timeoutMs).toBeLessThanOrEqual(30_000)
    expect(fetch?.argv).toContain('--no-recurse-submodules')
  })

  test(`a failed fetch (offline, no credentials) makes ↓ a question mark until one succeeds (${surface})`, async ($, on) => {
    const repo = fakeRepo({ behind: 3 })
    repo.fetchOk = false
    const gauge = await start($, on, surface, repo)
    await gauge.pass(0)
    // 3 is what the clone knew at the last fetch: it is old news, so it is not drawn as the answer.
    expect(await gauge.slots()).toEqual([['↓?', '', true], ['±0', '', true], ['↑0', '', true]])
    // It tries again after 5 minutes, not every 15 seconds.
    await gauge.pass(4 * MIN)
    expect(repo.fetches).toBe(1)
    repo.fetchOk = true
    await gauge.pass(MIN + 15_000)
    expect(repo.fetches).toBe(2)
    expect((await gauge.slots())[0]).toEqual(['↓3', 'warning', false])
  })

  // ── read-only ─────────────────────────────────────────────────────────────

  test(`every command it runs is a read: git status and git fetch, nothing that changes the working tree (${surface})`, async ($, on) => {
    const repo = fakeRepo({ behind: 1, ahead: 1, modified: 2, untracked: 1 })
    const gauge = await start($, on, surface, repo)
    await gauge.pass(0)
    await gauge.pass(6 * MIN)
    expect(repo.runs.length).toBeGreaterThan(3)
    for (const r of repo.runs) {
      expect(r.argv[0], r.argv.join(' ')).toBe('git')
      expect(['status', 'fetch'], r.argv.join(' ')).toContain(subcommand(r.argv))
    }
    // A plugin's git runs with the repository's hooks off, so it must never be what commits or pushes.
    expect(repo.runs.flatMap(r => r.argv).filter(a => /^(commit|push|add|checkout|reset|clean|stash|merge|rebase|pull)$/.test(a))).toEqual([])
    // Status takes no lock the person's own git command would wait for, and lists untracked files as git's default does.
    const status = repo.runs.find(r => subcommand(r.argv) === 'status')
    expect(status?.argv).toContain('--no-optional-locks')
    expect(status?.argv).toContain('--porcelain=v2')
    expect(status?.argv).toContain('--untracked-files=normal')
    // It runs in the session's folder: no cwd of its own.
    expect(repo.runs.every(r => r.init?.cwd === undefined)).toBe(true)
  })

  // ── what the person can turn off ──────────────────────────────────────────

  test('the slots off: git is not run at all, and the row is the one the gauge always drew', { options: { showGit: false } }, async ($, on) => {
    const repo = fakeRepo({ behind: 2, modified: 1 })
    const gauge = await start($, on, 'terminal', repo)
    await gauge.pass(0)
    expect(await gauge.row1()).toBe(`${HEAD}`)
    // Not at the start, not on a tick, not after a turn: git is never run.
    await gauge.pass(10 * MIN)
    await $.turn.complete({ answer: 'Hi', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer', usage: { model: 'm', input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } as never)
    await gauge.pass(0)
    expect(repo.runs).toEqual([])
  })

  test('the fetch off: status still runs, and ↓ is as of the last fetch you made', { options: { fetchRemote: false } }, async ($, on) => {
    const repo = fakeRepo({ behind: 2 })
    const gauge = await start($, on, 'terminal', repo)
    await gauge.pass(0)
    await gauge.pass(20 * MIN)
    expect(repo.fetches).toBe(0)
    expect(repo.runs.length).toBeGreaterThan(2)
    expect((await gauge.slots())[0]).toEqual(['↓2', 'warning', false])
  })

  /** Each option, and what it takes off the full row (the space beside it goes too). */
  const ITEMS: [string, string][] = [
    ['showTime', '⏱ 1h 12m '],
    ['showCost', '$3.84 '],
    ['showSpeed', '⚡ 62 t/s '],
    ['showCache', '⏳ 60m 90% '],
  ]
  for (const [option, gone] of ITEMS) {
    test(`${option} off removes it and nothing else, with no double gap`, { options: { [option]: false } }, async ($, on) => {
      const gauge = await start($, on, 'terminal', fakeRepo({ behind: 1 }))
      await gauge.pass(0)
      const full = `${HEAD} main ↓1 ±0 ↑0`
      expect(await gauge.row1()).toBe(full.replace(gone, ''))
      // A gap is three spaces (a chip carries one more of its own): six in a row would be a hole where an item was.
      expect(await gauge.raw1()).not.toMatch(/ {6}/)
    })
  }

  test('every item off but the chips: just the model and effort', { options: { showTime: false, showCost: false, showSpeed: false, showGit: false, showCache: false } }, async ($, on) => {
    const gauge = await start($, on, 'terminal', fakeRepo())
    await gauge.pass(0)
    expect(await gauge.row1()).toBe('claude-opus-4-1-20250805 ● high')
  })
}
