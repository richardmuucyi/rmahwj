import type { Folder, Git } from '../types'

// The git slots and the options, with no engine in them: what `git status` said as the counts, the counts as the slots,
// which row-1 items the person chose, and how wide the pane must be for each. register.tsx runs git and draws.

/**
 * `git status --porcelain=v2 --branch`, read into the branch and the counts. Undefined when the text is not that output
 * (no `# branch.oid` header, which git prints even in a repository with no commit). `# branch.ab` is printed only while
 * the branch tracks a remote branch that exists, so its absence is "no upstream". `# branch.head` is the branch's name,
 * or "(detached)", and then the commit's short hash stands in for the name.
 */
export function parseStatus(text: string): Git | undefined {
  let header = false
  let oid = ''
  let head = ''
  let upstream = false
  let ahead = 0
  let behind = 0
  let changed = 0
  let conflicts = 0
  let untracked = 0
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('# branch.oid ')) {
      header = true
      oid = line.slice('# branch.oid '.length).trim()
    } else if (line.startsWith('# branch.head ')) head = line.slice('# branch.head '.length).trim()
    else if (line.startsWith('# branch.ab ')) {
      const m = /^# branch\.ab \+(\d+) -(\d+)/.exec(line)
      if (m) {
        upstream = true
        ahead = Number(m[1])
        behind = Number(m[2])
      }
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) changed++
    else if (line.startsWith('u ')) conflicts++
    else if (line.startsWith('? ')) untracked++
  }
  if (!header) return undefined
  const detached = head === '(detached)'
  const branch = detached ? (oid.startsWith('(') ? '' : oid.slice(0, 7)) : head
  return { branch, ...(detached ? { detached } : {}), upstream, ahead, behind, changed, conflicts, untracked }
}

/** A count as drawn: three characters at most. */
export const cap = (n: number): string => (n > 99 ? '99+' : String(n))

/** A branch name in at most `room` cells: cut short with "…" when it is longer. Nothing when there is no room. */
export function clip(name: string, room: number): string {
  const chars = [...name]
  if (room < 1) return ''
  return chars.length <= room ? name : chars.slice(0, room - 1).join('') + '…'
}

/** One slot. No colour and not dim: a count that is lit. */
export type Slot = {
  key: 'behind' | 'changed' | 'untracked' | 'ahead'
  text: string
  /** The theme key the slot is drawn in. */
  color?: 'warning' | 'error'
  dim?: boolean
}

/**
 * The slots, left to right: ↓ commits to pull, ± files to commit, ? files git does not know, ↑ commits to push. A zero
 * is dim, a count is lit. The remote's news is old or missing in three cases, each drawn so it is never read as "none":
 * "↓?" when the last fetch failed, a dash for ↓ and ↑ when the branch tracks nothing. A branch that is both behind and
 * ahead has diverged: both arrows in the theme's error. A conflicted file puts ± in error. Untracked files are their own
 * dim slot, only when there are some, and only where the pane has room for it.
 */
export function slotsOf(g: Git, withUntracked: boolean): Slot[] {
  // A stale ↓ is not known to be above zero, so the branch is not called diverged on its word.
  const diverged = g.upstream && !g.stale && g.ahead > 0 && g.behind > 0
  const behind: Slot = !g.upstream
    ? { key: 'behind', text: '↓–', dim: true }
    : g.stale
      ? { key: 'behind', text: '↓?', dim: true }
      : g.behind === 0
        ? { key: 'behind', text: '↓0', dim: true }
        : { key: 'behind', text: `↓${cap(g.behind)}`, color: diverged ? 'error' : 'warning' }
  const files = g.changed + g.conflicts
  const changed: Slot =
    g.conflicts > 0
      ? { key: 'changed', text: `±${cap(files)}`, color: 'error' }
      : files === 0
        ? { key: 'changed', text: '±0', dim: true }
        : { key: 'changed', text: `±${cap(files)}` }
  const ahead: Slot = !g.upstream
    ? { key: 'ahead', text: '↑–', dim: true }
    : g.ahead === 0
      ? { key: 'ahead', text: '↑0', dim: true }
      : { key: 'ahead', text: `↑${cap(g.ahead)}`, ...(diverged ? { color: 'error' as const } : {}) }
  const untracked: Slot[] = withUntracked && g.untracked > 0 ? [{ key: 'untracked', text: `?${cap(g.untracked)}`, dim: true }] : []
  return [behind, changed, ...untracked, ahead]
}

/** One spelling per folder, as session-board folds them: separators, trailing separators and case. */
const folded = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

/** A path's last name; a path with none in it (`C:\`, `/`) is itself, trailing separators dropped. */
function nameOf(p: string): string {
  const parts = p.split(/[\\/]/).filter(s => s !== '')
  if (parts.length === 0) return p.startsWith('/') || p.startsWith('\\') ? '/' : p
  return parts[parts.length - 1] ?? p
}

/** Where `cwd` is against `root`: at it, under it (a folder boundary, never a name's prefix), or outside it. */
export function folderOf(root: string, cwd: string): Folder {
  const r = folded(root)
  const c = folded(cwd)
  if (c === r) return { place: 'root', root: nameOf(root) }
  if (c.startsWith(r === '' ? '/' : `${r}/`)) return { place: 'under', root: nameOf(root), here: nameOf(cwd) }
  return { place: 'outside', root: nameOf(cwd) }
}

/** East Asian wide and fullwidth ranges: a terminal gives each of these characters two cells. */
const WIDE: [number, number][] = [
  [0x1100, 0x115f], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xa000, 0xa4cf],
  [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe30, 0xfe4f], [0xff00, 0xff60], [0xffe0, 0xffe6], [0x20000, 0x3fffd],
]
/** The emoji the rows draw (⏱ ⏳ ⚡): two cells, the safe side where terminals differ on ⏱. */
const EMOJI = new Set([0x23f1, 0x23f3, 0x26a1])
const cellsOf = (ch: string): number => {
  const cp = ch.codePointAt(0) ?? 0
  return EMOJI.has(cp) || WIDE.some(([a, b]) => cp >= a && cp <= b) ? 2 : 1
}

/** How many terminal cells the text takes. */
export const cellWidth = (s: string): number => [...s].reduce((n, ch) => n + cellsOf(ch), 0)

/** Like `clip`, by cells: at most `room` of them, cut short with "…". Nothing when there is no room. */
export function clipCells(s: string, room: number): string {
  if (room < 1) return ''
  if (cellWidth(s) <= room) return s
  let out = ''
  let used = 0
  for (const ch of s) {
    const w = cellsOf(ch)
    if (used + w + 1 > room) break
    out += ch
    used += w
  }
  return out + '…'
}

/**
 * The folder part in at most `room` cells. At the root or outside it: the name, cut at the end. Under the root: whole
 * when it fits; else the root's name is cut first, so the folder it moved into stays readable; else "…›" and that
 * folder's name; nothing below that.
 */
export function fitFolder(f: Folder, room: number): string {
  if (f.place !== 'under' || f.here === undefined) return clipCells(f.root, room)
  const whole = `${f.root}›${f.here}`
  if (cellWidth(whole) <= room) return whole
  const rootRoom = room - 1 - cellWidth(f.here)
  if (rootRoom >= 2) return `${clipCells(f.root, rootRoom)}›${f.here}`
  return room - 2 >= 2 ? `…›${clipCells(f.here, room - 2)}` : ''
}

/** The folder part's colour: none at the root, the theme's warning under it, its error outside it. */
export function colorOf(f: Folder): 'warning' | 'error' | undefined {
  return f.place === 'root' ? undefined : f.place === 'under' ? 'warning' : 'error'
}

/**
 * The git chip's room, shared: the piece that goes first (the folder after a drift, the branch at the root) takes what it
 * wants of it; the other takes what is left after a one-cell separator, if that is at least BRANCH_MIN. `folder` and
 * `branch` are the cells each wants, already capped at FOLDER_MAX and BRANCH_MAX. A piece that wants none leaves the
 * whole room to the other.
 */
export function splitRoom(room: number, folder: number, branch: number, folderFirst: boolean): { folder: number; branch: number } {
  if (room < BRANCH_MIN) return { folder: 0, branch: 0 }
  const [wantFirst, wantSecond] = folderFirst ? [folder, branch] : [branch, folder]
  const first = Math.min(wantFirst, room)
  const left = first === 0 ? room : room - first - 1
  const second = left >= BRANCH_MIN ? Math.min(wantSecond, left) : 0
  return folderFirst ? { folder: first, branch: second } : { folder: second, branch: first }
}

/** Which of the optional row-1 items the person wants, and whether to fetch. Anything but an explicit false is on. */
export type Show = { time: boolean; cost: boolean; speed: boolean; git: boolean; cache: boolean; fetch: boolean; folder: boolean }

export function showOf(options: Readonly<Record<string, unknown>>): Show {
  const on = (v: unknown): boolean => v !== false
  return {
    time: on(options.showTime),
    cost: on(options.showCost),
    speed: on(options.showSpeed),
    git: on(options.showGit),
    cache: on(options.showCache),
    fetch: on(options.fetchRemote),
    folder: on(options.showFolder),
  }
}

/**
 * Below this many columns the rows use short labels and drop the untracked slot and the weekly reset. The widest wide
 * row, every item at its longest, is 113 cells (tests/width.test.tsx measures it), and a row wider than the surface wraps
 * a meter or the cache chip onto a third line. 115 leaves 2 to spare.
 */
export const NARROW_BELOW = 115

/**
 * With the git slots on the row, row 1 at its longest (the clock chip showing "cold 100%", every count at 99+, the model
 * and effort longest) is 85 cells before the branch in a narrow pane with the speed. Below SPEED_FROM, the 85, the speed
 * gives way to the git slots, so the slots fit in the narrowest pane even then. The untracked slot needs no wait: every
 * wide pane has room for it. tests/width.test.tsx measures these on the drawn rows.
 *
 * The flexible part, the folder, a ":" and the branch, takes the room the DRAWN row leaves (roomOf, since 0.13.1): up to
 * FLEX_MAX (33) cells, 4 for the footer's padding and 2 to spare, none under BRANCH_MIN. Before 0.13.1 the room was the longest row's, so a real row
 * left blank cells that the folder never got. splitRoom decides who gives way: the folder at the root, the branch once
 * the session has moved.
 */
const FIXED_NARROW_SPEED = 85
const SPARE = 2
/**
 * The hint line is drawn inside the footer box, which has 2 cells of padding each side outside full-screen mode (Claude
 * Code 2.1.330: `var Tdt=2`, `$n=Nn?0:Tdt, Rr=Tr-2*$n`, the box's `paddingX:$n`), while `viewport.columns` is the whole
 * conversation width. So the line has 4 cells fewer than it is told. In full-screen mode the 4 cells go unused.
 */
const FOOTER = 4
export const BRANCH_MAX = 16
export const BRANCH_MIN = 4
/** The most cells the folder part takes, and the most the folder, its separator and the branch take together. */
export const FOLDER_MAX = 16
export const FLEX_MAX = FOLDER_MAX + 1 + BRANCH_MAX
export const SPEED_FROM = FIXED_NARROW_SPEED

export type Layout = {
  narrow: boolean
  speed: boolean
  untracked: boolean
}

/**
 * Which labels and items the pane gets. `columns` is the surface's own measure; none, or 0, is a surface that has not
 * measured and is drawn in full. `git` is whether the slots are on the row at all: without them nothing gives way, so
 * the thresholds are the ones the gauge had before the slots (narrow below 115, the speed in every pane).
 */
export function layoutOf(columns: number | undefined, git: boolean): Layout {
  const known = columns !== undefined && columns > 0
  const narrow = known && columns < NARROW_BELOW
  const speed = !git || !known || columns >= SPEED_FROM
  return { narrow, speed, untracked: !narrow }
}

/**
 * The cells a flexible item may take: what the pane leaves after `used` cells and 2 to spare, up to `max`, none under
 * BRANCH_MIN. A surface that has not measured (no width, or 0) gets `max`.
 */
export function roomOf(columns: number | undefined, used: number, max: number): number {
  if (columns === undefined || columns <= 0) return max
  const room = Math.min(max, columns - FOOTER - SPARE - used)
  return room >= BRANCH_MIN ? room : 0
}

/** The text a drawn element shows: its strings in order, through every child; a button's label when it has no children. */
export function textOf(node: unknown): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (node === null || typeof node !== 'object') return ''
  const el = node as { props?: { label?: unknown }; children?: unknown[] }
  if (Array.isArray(el.children) && el.children.length > 0) return el.children.map(textOf).join('')
  return typeof el.props?.label === 'string' ? el.props.label : ''
}
