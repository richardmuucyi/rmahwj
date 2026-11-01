// The markdown day journal: one human-readable page per day, rebuilt from every
// session's JSONL log lines of that day (log/<day>/<session>.jsonl). Pure: no
// engine calls, so the board writes the page and tests read it.
//
// Rebuilt, never appended: many sessions log at once, and each one owns only its
// own JSONL file. Whatever sits under "## My notes" in the old page is kept.

import { pad2 } from './shared'

/** One logged turn, as logTurn writes it. Every field may be missing in an old line. */
export type JournalLine = {
  at?: string
  project?: string
  did?: string | null
  check?: string
  lesson?: string
  mins?: number
  files?: number
  assumed?: number
  status?: string
}

/** The heading whose section survives every rebuild. */
export const NOTES_HEADING = '## My notes'

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** `<root>/YYYY/MM/YYYY-MM-DD.md` for a `YYYY-MM-DD` day. */
export function journalPath(root: string, day: string): string {
  return `${root.replace(/[\\/]+$/, '')}/${day.slice(0, 4)}/${day.slice(5, 7)}/${day}.md`
}

/**
 * Where the journal goes: the `journalDir` setting when given, else
 * `<board>/journal`. A leading `~`, or a relative path, starts at the home
 * folder: a session's own folder changes from one session to the next.
 * Slashes are forward.
 */
export function journalRoot(setting: unknown, home: string, board: string): string {
  const raw = typeof setting === 'string' ? setting.trim() : ''
  if (raw === '') return `${board}/journal`
  const base = home.replace(/[\\/]+$/, '')
  const isAbsolute = /^([A-Za-z]:)?[\\/]/.test(raw)
  const expanded = /^~(?=$|[\\/])/.test(raw) ? `${base}${raw.slice(1)}` : isAbsolute ? raw : `${base}/${raw}`
  return expanded.replace(/\\/g, '/').replace(/\/+$/, '')
}

/** The lines of one JSONL file; a broken line is skipped, not fatal. */
export function parseLog(text: string): JournalLine[] {
  const out: JournalLine[] = []
  for (const l of text.split('\n')) {
    if (l.trim() === '') continue
    try {
      const v = JSON.parse(l) as unknown
      if (v && typeof v === 'object' && !Array.isArray(v)) out.push(v as JournalLine)
    } catch {
      // a half-written line from a crash: leave it out
    }
  }
  return out
}

/** FNV-1a, 32 bits, as 8 hex digits: enough to tell whether a page was edited. */
function checksumOf(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

const CHECKSUM_LINE = /^checksum: ([0-9a-f]{8})\n/m

const TICKED = /^- \[[xX]\] /gm

/** The page's lines, and where its notes heading is: any case, any spacing ("## my Notes" too). -1 when it is gone. */
function split(page: string): { lines: string[]; notesAt: number } {
  const lines = page.replace(/\r\n/g, '\n').split('\n')
  return { lines, notesAt: lines.findIndex(l => /^##\s+my\s+notes\s*$/i.test(l.trim())) }
}

/**
 * What the checksum covers: the part the mod writes, up to and including the
 * notes heading, without the checksum line, with every tick undone. A tick in
 * "To check" is yours to make and the next rebuild keeps it, so it is no edit.
 */
function signed(generated: string): string {
  return generated.replace(CHECKSUM_LINE, '').replace(TICKED, '- [ ] ')
}

/**
 * True when someone changed an old page outside "## My notes", apart from
 * ticking a check: the text the mod wrote no longer matches its checksum, or
 * the notes heading is gone. The board keeps a copy of such a page before the
 * rebuild replaces it.
 */
export function editedOutsideNotes(old: string): boolean {
  if (old.trim() === '') return false
  const { lines, notesAt } = split(old)
  const sum = CHECKSUM_LINE.exec(lines.join('\n'))?.[1]
  if (notesAt < 0 || sum === undefined) return true
  return checksumOf(signed(lines.slice(0, notesAt).join('\n') + `\n${NOTES_HEADING}`)) !== sum
}

/** Everything under "## My notes" in an old page, to the end: the page always puts that section last. Empty when there is none. */
export function keptNotes(old: string): string {
  const { lines, notesAt } = split(old)
  return notesAt < 0 ? '' : lines.slice(notesAt + 1).join('\n').trim()
}

/**
 * True when a day page needs a rebuild: there is none, its `turns:` count
 * differs from the `turns` the log holds, or it was cut short (no notes
 * heading). Your own edits alone do not make a page stale.
 */
export function isStale(old: string, turns: number): boolean {
  if (old.trim() === '') return true
  const { lines, notesAt } = split(old)
  const said = /^turns: (\d+)$/m.exec(lines.join('\n'))?.[1]
  return notesAt < 0 || said === undefined || Number(said) !== turns
}

/** The checks ticked in an old page's "To check", as the text after the box. */
export function tickedChecks(old: string): Set<string> {
  const { lines, notesAt } = split(old)
  const from = lines.findIndex(l => l.trim() === '## To check')
  const to = lines.findIndex((l, i) => i > from && /^## /.test(l))
  const part = from < 0 ? [] : lines.slice(from + 1, to < 0 ? (notesAt < 0 ? lines.length : notesAt) : to)
  return new Set(part.filter(l => /^- \[[xX]\] /.test(l)).map(l => l.slice('- [x] '.length).trim()))
}

function hm(mins: number): string {
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h} h` : `${h} h ${pad2(m)} min`
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()
const minsOf = (l: JournalLine) => (typeof l.mins === 'number' && l.mins > 0 ? Math.round(l.mins) : 1)
const filesOf = (l: JournalLine) => (typeof l.files === 'number' && l.files > 0 ? l.files : 0)
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function longDate(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const at = new Date(y!, (m ?? 1) - 1, d ?? 1)
  return `${WEEKDAYS[at.getDay()]}, ${d} ${MONTHS[(m ?? 1) - 1]} ${y}`
}

/** Parts of the day, by the hour a turn started. */
const PARTS = [['Night', 0], ['Morning', 1], ['Afternoon', 2], ['Evening', 3]] as const
function partOf(at: string | undefined): number {
  const h = Number(/^(\d{1,2}):/.exec(at ?? '')?.[1] ?? NaN)
  if (!Number.isFinite(h)) return 1
  return h < 6 ? 0 : h < 12 ? 1 : h < 18 ? 2 : 3
}

/** A stable sort by the HH:MM start time. */
function byTime<T>(xs: T[], at: (x: T) => string | undefined = x => (x as JournalLine).at): T[] {
  return xs.map((x, i) => [x, i] as const).sort((a, b) => (at(a[0]) ?? '').localeCompare(at(b[0]) ?? '') || a[1] - b[1]).map(([x]) => x)
}

function facts(mins: number, files: number): string {
  return [hm(mins), files > 0 ? plural(files, 'file') : ''].filter(Boolean).join(' · ')
}

/** A check that asks nothing of you: empty, "none", "nothing yet …", "wait for …". */
const NOT_A_CHECK = /^(|none|nothing|n\/a|-)\.?$|^(nothing yet|wait|waiting)\b/i

/** A summary that says work was still going when the turn ended. */
const LEFT_RUNNING = /\b(waiting|wait for|running|still going|in progress|pending|started|launched|kicked off)\b/i

/** Turns as bullets, oldest first; a run of turns with no summary folds into one bullet. */
function bullets(lines: JournalLine[]): string[] {
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const l = lines[i]!
    const did = typeof l.did === 'string' ? oneLine(l.did) : ''
    if (did === '') {
      let j = i
      while (j < lines.length && !(typeof lines[j]!.did === 'string' && oneLine(lines[j]!.did as string) !== '')) j++
      const run = lines.slice(i, j)
      const span = run.length > 1 ? `${run[0]!.at ?? '?'}–${run[run.length - 1]!.at ?? '?'}` : (run[0]!.at ?? '?')
      const m = run.reduce((s, x) => s + minsOf(x), 0)
      const f = run.reduce((s, x) => s + filesOf(x), 0)
      out.push(`- ${span} *${plural(run.length, 'turn')} with no summary* · ${facts(m, f)}`)
      i = j
      continue
    }
    // "answered" means Claude replied, not that the work is finished: a turn that left a job going says so
    const note = l.status === 'stopped' ? ' *(stopped)*'
      : l.status === 'error' ? ' *(ended on an error)*'
      : LEFT_RUNNING.test(did) ? ' *(left running)*'
      : ''
    out.push(`- ${l.at ?? '?'} ${did}${note} · ${facts(minsOf(l), filesOf(l))}`)
    i++
  }
  return out
}

/**
 * The day page. `sessions` maps a session id to its logged turns, oldest first.
 * `notes` is what the old page held under "## My notes", `ticked` the checks
 * you ticked there (tickedChecks).
 */
export function renderJournal(day: string, sessions: Map<string, JournalLine[]>, notes = '', ticked: Set<string> = new Set()): string {
  type Thread = { id: string; project: string; lines: JournalLine[] }
  const threads: Thread[] = []
  for (const [id, lines] of sessions) {
    // One session can move between projects only by a restart, so its first project names it.
    if (lines.length > 0) threads.push({ id, project: lines.find(l => l.project)?.project ?? 'unknown project', lines })
  }
  const all = threads.flatMap(t => t.lines.map(l => ({ l, project: t.project })))
  const totalMins = all.reduce((s, x) => s + minsOf(x.l), 0)
  // "none", "nothing yet" or "wait for the review" is Claude saying there is nothing for you to check yet
  const checks = all.filter(x => typeof x.l.check === 'string' && !NOT_A_CHECK.test(oneLine(x.l.check)))
  const lessons = all.filter(x => typeof x.l.lesson === 'string' && oneLine(x.l.lesson) !== '')
  const byProject = new Map<string, Thread[]>()
  for (const t of threads.sort((a, b) => (a.lines[0]!.at ?? '').localeCompare(b.lines[0]!.at ?? ''))) {
    byProject.set(t.project, [...(byProject.get(t.project) ?? []), t])
  }
  const projectMins = [...byProject].map(([p, ts]) => [p, ts.reduce((s, t) => s + t.lines.reduce((n, l) => n + minsOf(l), 0), 0)] as const)
  projectMins.sort((a, b) => b[1] - a[1])

  const out: string[] = [
    '---',
    `date: ${day}`,
    'type: work-journal',
    `turns: ${all.length}`,
    `minutes: ${totalMins}`,
    '---',
    '',
    `# Work journal: ${longDate(day)}`,
    '',
    `> Rebuilt by the session-board mod from each session's log. Write your own lines under "${NOTES_HEADING.slice(3)}": they are kept.`,
    '',
    `**${plural(all.length, 'turn')} · ${plural(byProject.size, 'project')} · ${hm(totalMins)} of Claude work · ${checks.length} to check**`,
    '',
    '## What I worked on',
  ]
  for (const [p] of projectMins) {
    out.push('', `### ${p} · ${hm(projectMins.find(x => x[0] === p)![1])}`)
    // Sessions of one project interleave: the page reads by the clock, in parts of the day.
    const lines = byTime(byProject.get(p)!.flatMap(t => t.lines))
    for (const [name, part] of PARTS) {
      const inPart = lines.filter(l => partOf(l.at) === part)
      if (inPart.length > 0) out.push('', `**${name}**`, '', ...bullets(inPart))
    }
  }

  out.push('', '## To check', '')
  if (checks.length === 0) out.push('Nothing was flagged to check.')
  for (const x of byTime(checks, x => x.l.at)) {
    const text = `${oneLine(x.l.check!)} · *${x.project}, ${x.l.at ?? '?'}*`
    out.push(`- [${ticked.has(text) ? 'x' : ' '}] ${text}`)
  }

  out.push('', '## Reflections', '')
  const reflections: string[] = []
  if (projectMins.length > 0 && totalMins > 0) {
    const [p, m] = projectMins[0]!
    reflections.push(projectMins.length === 1 ? `All the work was on ${p}.` : `Most time went to ${p}: ${hm(m)} of ${hm(totalMins)}.`)
  }
  const longest = all.reduce<(typeof all)[number] | undefined>((a, x) => (!a || minsOf(x.l) > minsOf(a.l) ? x : a), undefined)
  if (longest && minsOf(longest.l) >= 15) {
    const what = typeof longest.l.did === 'string' && oneLine(longest.l.did) !== '' ? `: ${oneLine(longest.l.did)}` : ''
    reflections.push(`The longest turn took ${hm(minsOf(longest.l))} (${longest.project}, ${longest.l.at ?? '?'})${what}.`)
  }
  const stopped = all.filter(x => x.l.status === 'stopped').length
  const errors = all.filter(x => x.l.status === 'error').length
  if (stopped + errors > 0) {
    reflections.push(`${[stopped > 0 ? `${plural(stopped, 'turn')} stopped` : '', errors > 0 ? `${plural(errors, 'turn')} ended on an error` : ''].filter(Boolean).join(' and ')} before the end.`)
  }
  const assumed = all.reduce((s, x) => s + (typeof x.l.assumed === 'number' ? x.l.assumed : 0), 0)
  if (assumed > 0) reflections.push(`Claude logged ${plural(assumed, 'assumption')} to confirm.`)
  const quiet = all.filter(x => !(typeof x.l.did === 'string' && oneLine(x.l.did) !== '')).length
  if (quiet > 0) reflections.push(`${plural(quiet, 'turn')} left no summary.`)
  out.push(...(reflections.length > 0 ? reflections.map(r => `- ${r}`) : ['Nothing stood out in the numbers.']))

  out.push('', '## Lessons learned', '')
  if (lessons.length === 0) out.push('No lessons were noted today.')
  for (const x of lessons) out.push(`- ${oneLine(x.l.lesson!)} · *${x.project}, ${x.l.at ?? '?'}*`)

  out.push('', NOTES_HEADING)
  const generated = out.join('\n').replace(/\n{3,}/g, '\n\n')
  // The checksum lets the next rebuild see an edit made outside "## My notes".
  const page = generated.replace('\n---\n', `\nchecksum: ${checksumOf(signed(generated))}\n---\n`)
  // Your notes go back exactly as you wrote them.
  return notes.trim() === '' ? `${page}\n\n` : `${page}\n\n${notes.trim()}\n`
}
