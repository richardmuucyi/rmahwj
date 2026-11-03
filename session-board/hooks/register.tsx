import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginState, Register, RenderElement } from 'claude-code'

import type { AgentRow, BgRow, BoardEntry, BoardStatus, CardTask, FileKind, FileRow, TaskKind, ToolKind, TurnRecord } from '../types'
import {
  compactionNotes,
  configureGuard,
  contextPane,
  guardCompactFailed,
  guardCompacted,
  guardCompacting,
  guardMeasured,
  guardPromptSent,
  guardOpensWithChip,
  guardRequestCounted,
  guardRow,
  guardSessionEnded,
  guardTurnStarted,
  guardTyped,
  loadInstructions,
  noteGuardCall,
  pruneGuardLogs,
  refreshDay,
  refreshGuard,
} from './guard-glue'
import type { GuardIo } from './guard-glue'
import { short, same, barCells, pad2, clockTime, FIRST_COL, LABEL_BG, LABEL_FG, LINK } from './shared'
import { editedOutsideNotes, isStale, journalPath, journalRoot, keptNotes, parseLog, renderJournal, tickedChecks } from './journal'
import type { JournalLine } from './journal'
import type { Kit } from './shared'

// Reads only what each session is already doing (prompts, tool calls, turn
// ends). It adds nothing to any conversation, so it costs no tokens.

const PANE = 'session-board'
const board = atom({ plugin: 'session-board', key: 'board' } as const, [])
const now = atom({ plugin: 'session-board', key: 'now' } as const, 0)
const self = atom({ plugin: 'session-board', key: 'self' } as const, null)
const alerts = atom({ plugin: 'session-board', key: 'alerts' } as const, { needs: [], replied: [] })
const showEnded = atom({ plugin: 'session-board', key: 'showEnded' } as const, false)
const liveAtom = atom({ plugin: 'session-board', key: 'live' } as const, {
  isWorking: false,
  progress: null,
  showProgress: false,
  agents: [],
  turnFiles: 0,
  bg: 0,
  bgKinds: {},
  bgRows: [],
})
const turnsAtom = atom({ plugin: 'session-board', key: 'turns' } as const, [])
const journalAtom = atom({ plugin: 'session-board', key: 'journal' } as const, null)
const expandedAtom = atom({ plugin: 'session-board', key: 'expanded' } as const, null)
const reviewAtom = atom({ plugin: 'session-board', key: 'review' } as const, { open: 0, high: 0 })
const recapAtom = atom({ plugin: 'session-board', key: 'recap' } as const, null)
const filesView = atom({ plugin: 'session-board', key: 'files' } as const, {
  view: 'board',
  scope: 'turn',
  list: [],
  isLoading: false,
  open: null,
})
const guardAtom = atom({ plugin: 'session-board', key: 'guard' } as const, {
  chip: 'none',
  saving: 0,
  ctx: 0,
  window: 1_000_000,
  mode: 'advise',
  phase: 'idle',
  jobs: 0,
  series: [],
  history: [],
  adviseAt: 300_000,
  floor: 120_000,
  hasFile: false,
  pickOpen: false,
  picks: { notes: true, lean: true, tasks: false, files: false, jobs: false, assumptions: false },
  facts: { tasks: [], files: [], jobs: [], assumptions: 0, high: 0 },
  command: '/compact',
  boxHolds: false,
})

/** One colour per state, used everywhere: strip pills, panel edges, counts. */
const COLOR: Record<BoardStatus, string> = {
  'needs-you': 'yellow',
  working: 'cyan',
  replied: 'green',
  background: 'magenta',
  stopped: 'gray',
  open: 'gray',
  gone: 'gray',
  closed: 'gray',
}

const CARD_VERSION = 5
// The card's `edits`: the newest this many files.
const EDITS_MAX = 200
const REFRESH_MS = 5_000
const HEARTBEAT_MS = 30_000
// No heartbeat for this long: the session closed, crashed, or the computer slept.
const GONE_MS = 2 * 60_000
// Sessions that ended stay listed this long.
const KEEP_ENDED_MS = 30 * 60_000
// A card file untouched this long is past both limits above: not even read.
const STALE_FILE_MS = KEEP_ENDED_MS + GONE_MS + HEARTBEAT_MS

const ORDER: Record<BoardStatus, number> = {
  'needs-you': 0,
  working: 1,
  replied: 2,
  background: 3,
  stopped: 4,
  open: 5,
  gone: 6,
  closed: 7,
}
const ICON: Record<BoardStatus, string> = {
  'needs-you': '?',
  working: '◔',
  replied: '✓',
  background: '◌',
  stopped: '‖',
  open: '○',
  gone: '×',
  closed: '×',
}
function label(c: BoardEntry): string {
  switch (c.status) {
    case 'needs-you':
      return 'Needs you'
    case 'working':
      return 'Working'
    case 'replied':
      return 'Done'
    case 'background': {
      const n = c.tasks?.length ?? 0
      return n === 1 ? 'Waiting on a background task' : `Waiting on ${n} background tasks`
    }
    case 'stopped':
      return 'Stopped'
    case 'open':
      return c.asked === '' ? 'Open · nothing asked yet' : 'Open · resumed'
    case 'gone':
      return 'Not responding'
    case 'closed':
      return 'Closed'
  }
}

/** Cuts one line to `n` characters, keeping its spacing (for diff lines). */
function clip(text: string, n: number): string {
  return text.length > n ? `${text.slice(0, Math.max(1, n - 1))}…` : text
}

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.round(m / 60)}h`
}

function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter(p => p !== '')
  return parts[parts.length - 1] ?? path
}

/** One spelling per folder: separators, a trailing separator and case folded. */
const folderKey = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

/** The folder's name, or `parent/name` where another listed folder shares the name. */
function folderLabel(folder: string, project: string, all: readonly BoardEntry[]): string {
  const key = folderKey(folder)
  const clash = all.some(c => c.project.toLowerCase() === project.toLowerCase() && folderKey(c.folder) !== key)
  if (!clash) return project
  const parts = folder.split(/[\\/]/).filter(p => p !== '')
  return parts.slice(-2).join('/')
}

const STATUSES = new Set<string>(Object.keys(ORDER))

/** A card as another session wrote it, or undefined when it is not one this version reads. */
function parseCard(text: string): BoardEntry | undefined {
  const c = JSON.parse(text) as Partial<BoardEntry> | null
  if (!c || typeof c !== 'object') return undefined
  if (typeof c.id !== 'string' || typeof c.folder !== 'string' || typeof c.project !== 'string') return undefined
  if (typeof c.status !== 'string' || !STATUSES.has(c.status)) return undefined
  if (typeof c.changedAt !== 'number' || typeof c.seenAt !== 'number') return undefined
  return {
    ...c,
    // A background task's report is never "Asked": drop one saved by an older
    // version, so neither a reload nor another session's card brings it back.
    asked: typeof c.asked === 'string' && !/^<task-notification[\s>]/.test(c.asked.trim()) ? c.asked : '',
    tasks: Array.isArray(c.tasks) ? c.tasks.filter((x): x is string => typeof x === 'string') : undefined,
    bg: Array.isArray(c.bg)
      ? c.bg.filter(
          (x): x is CardTask =>
            !!x && typeof x.id === 'string' && typeof x.label === 'string' && typeof x.what === 'string' &&
            typeof x.since === 'number' && typeof x.isExact === 'boolean' && (KIND_ORDER as string[]).includes(x.kind),
        )
      : undefined,
    progress:
      c.progress && typeof c.progress.done === 'number' && typeof c.progress.total === 'number' && c.progress.total > 0
        ? { done: c.progress.done, total: c.progress.total }
        : undefined,
    edits: Array.isArray(c.edits) ? c.edits.filter((x): x is string => typeof x === 'string') : undefined,
  } as BoardEntry
}

/** What a tool call is doing, in plain words, from its own arguments. */
function describe(tool: string, args: Record<string, unknown>): string {
  const s = (k: string) => (typeof args[k] === 'string' ? (args[k] as string) : '')
  const file = (k: string) => (s(k) ? baseName(s(k)) : 'a file')
  switch (tool) {
    case 'Read':
      return `Reading ${file('file_path')}`
    case 'Edit':
    case 'MultiEdit':
      return `Editing ${file('file_path')}`
    case 'Write':
      return `Writing ${file('file_path')}`
    case 'NotebookEdit':
      return `Editing ${file('notebook_path')}`
    case 'Bash':
    case 'PowerShell':
      if (s('description')) return short(s('description'), 50)
      return s('command') ? `Running ${short(s('command'), 40)}` : 'Running a command'
    case 'Grep':
    case 'Glob':
      return 'Searching files'
    case 'WebSearch':
      return s('query') ? `Searching the web: ${short(s('query'), 40)}` : 'Searching the web'
    case 'WebFetch':
      return 'Reading a web page'
    case 'Agent':
    case 'Task':
      return s('description') ? `Subagent: ${short(s('description'), 40)}` : 'Running a subagent'
    case 'Skill':
      return s('skill') ? `Using skill ${s('skill')}` : 'Using a skill'
    case 'TodoWrite':
    case 'TaskCreate':
    case 'TaskUpdate':
      return 'Updating its task list'
    case 'AskUserQuestion': {
      const qs = Array.isArray(args.questions) ? args.questions : []
      const q = qs[0] as { question?: unknown } | undefined
      return typeof q?.question === 'string' ? `Answer its question: ${short(q.question, 60)}` : 'Answer its question'
    }
    case 'ExitPlanMode':
      return 'Review its plan'
    case 'Monitor':
      return s('description') ? `Monitor: ${short(s('description'), 40)}` : 'Starting a monitor'
    default: {
      const mcp = tool.match(/^mcp__(.+?)__(.+)$/)
      if (mcp) return `Using ${mcp[1]}: ${mcp[2]}`
      return `Using ${tool}`
    }
  }
}

/** The keys tool.call carries beside the tool's own arguments. */
const RESERVED = new Set(['tool', 'tool_use_id', 'agentId', 'consent', 'requestMeta'])
function toolArgs(e: object): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(e)) if (!RESERVED.has(k)) out[k] = v
  return out
}
function asRecord(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    try {
      const v = JSON.parse(raw) as unknown
      return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
    } catch {
      return {}
    }
  }
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
}

/** What one background task summary (classic Stop's `background_tasks`) is doing, in a few words. */
function taskWhat(t: { description: string; command?: string; agent_type?: string; name?: string }): string {
  return short(t.description || t.name || t.command || t.agent_type || 'task', 50)
}

/** A background task's kind from its type (classic Stop's `background_tasks[].type`): a background shell is a job.
 *  A type this version does not know counts as a plain task, never as one of the others. */
function kindOf(type: string): TaskKind {
  if (type === 'shell' || type === 'bash' || type === 'local_bash') return 'job'
  if (type === 'monitor') return 'monitor'
  if (type === 'subagent' || type === 'agent') return 'agent'
  return 'task'
}

/** A tool call in flight, and the dialog it waits on, if any. */
type Call = { tool: string; agentId?: string; args: Record<string, unknown>; what: string; asking?: string; at: number }
/** One piece of background work: its label ("shell: Render on the GPU"), what it does, and when it started. `isExact`
 *  is false where the start is only the first time a Stop listed it (it may have started earlier: "≥"). */
type Tracked = { label: string; what: string; kind: TaskKind; agentId?: string; since: number; isExact: boolean }
/** A Tracked entry from its label's two parts. */
const task = (prefix: string, what: string, kind: TaskKind, since: number, isExact: boolean, agentId?: string): Tracked => ({
  label: `${prefix}: ${what}`, what, kind, since, isExact, ...(agentId !== undefined ? { agentId } : {}),
})

// Module state: a hot reload starts it over, and session.start (which fires
// again for a reloaded module) restores the card from its own file.
let dir = ''
let me: BoardEntry | undefined
/** The session phase apart from any dialog: what the card shows once no dialog is open. */
let phase: Exclude<BoardStatus, 'needs-you' | 'gone'> = 'open'
let mainActivity: string | undefined
let isTurnRunning = false
/** The background work the last classic Stop reported, undefined where it reported none. */
let stopTasks: Map<string, Tracked> | undefined
/** When that Stop came: work this session's own calls started after it is not in its list yet. */
let stopAt = 0
let stopSeenThisTurn = false
/** Background work seen at our own tool calls: all of it where Stop carries no `background_tasks`, else what started
 *  since the last Stop (see bgList). */
const tracked = new Map<string, Tracked>()
/** Agents whose ended status was seen at one refresh; dropped when seen again at the next. */
const endedOnce = new Set<string>()
const calls = new Map<string, Call>()
let callSeq = 0
/** After /clear or an in-process resume: the old id, until the new one is read. */
let retiredId: string | undefined
let isDirty = false
let writing: Promise<void> = Promise.resolve()

/** Rebuilds the card from the phase and the dialogs in flight; marks it dirty when it changed. */
function derive(t: number): void {
  if (!me) return
  const asking = [...calls.values()].filter(c => c.asking !== undefined).sort((a, b) => a.at - b.at)[0]
  let status: BoardStatus = phase
  let activity: string | undefined
  let tasks: string[] | undefined
  if (asking) {
    status = 'needs-you'
    activity = asking.asking
  } else if (phase === 'working') {
    activity = mainActivity
  } else if (phase === 'background') {
    tasks = currentTasks()
    activity = tasks.join(' · ')
  } else if (phase === 'stopped') {
    activity = mainActivity
  }
  const p = progressOf()
  const progress = p ? { done: p.done, total: p.total } : undefined
  // Every phase, not only "background": a reload mid-turn restores the jobs, with their real ids and start times, from it.
  const list = [...bgList()].map(([id, x]) => ({ id, label: x.label, what: x.what, kind: x.kind, since: x.since, isExact: x.isExact }))
  const bg = list.length > 0 ? list : undefined
  const all = editList()
  const edits = all.length > 0 ? all : undefined
  if (status === me.status && activity === me.activity && same(tasks, me.tasks) && same(progress, me.progress) && same(bg, me.bg) && same(edits, me.edits)) return
  // A working card keeps the time its turn started; a new tool is no change of state.
  const changedAt = status === me.status ? me.changedAt : t
  me = { ...me, v: CARD_VERSION, status, activity, tasks, progress, bg, edits, changedAt, seenAt: t }
  isDirty = true
}

/** The background work in flight now: the last Stop's list, plus what this session's own calls started since that Stop
 *  (a job started mid-turn is not in any Stop list yet). Without a Stop list, everything its calls started. */
function bgList(): Map<string, Tracked> {
  if (!stopTasks) return tracked
  const out = new Map(stopTasks)
  for (const [id, x] of tracked) if (!out.has(id) && x.since >= stopAt) out.set(id, x)
  return out
}

/** A task that finished (its report came, or its agent stopped): off every list at once. */
function dropTask(id: string): void {
  tracked.delete(id)
  stopTasks?.delete(id)
  // Nothing left to wait on and no turn running: your turn.
  if (phase === 'background' && bgList().size === 0) phase = 'replied'
}

function currentTasks(): string[] {
  return [...bgList().values()].map(x => x.label)
}

/** How many of the current background tasks are of each kind, for the ◈ chip. */
function currentKinds(): Partial<Record<TaskKind, number>> {
  const n: Partial<Record<TaskKind, number>> = {}
  for (const x of bgList().values()) n[x.kind] = (n[x.kind] ?? 0) + 1
  return n
}

/** How long something has run: "45s", "12m", "1h 05m". */
function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${pad2(m % 60)}m`
}

/** A task's running time, "≥" first where it may have started before the board first saw it. */
const ranFor = (x: { since: number; isExact: boolean }, t: number) => `${x.isExact ? '' : '≥'}${elapsed(t - x.since)}`

const KIND_ORDER: TaskKind[] = ['job', 'agent', 'monitor', 'wake-up', 'task']
/** Each kind's word, its plural and its initial for a narrow pane. */
const KIND_WORD: Record<TaskKind, [string, string, string]> = {
  job: ['job', 'jobs', 'j'], agent: ['agent', 'agents', 'a'], monitor: ['monitor', 'monitors', 'm'],
  'wake-up': ['wake-up', 'wake-ups', 'w'], task: ['task', 'tasks', 't'],
}

/** The ◈ chip's text: each kind counted apart ("◈ 1 job · 1 monitor"), initials when narrow ("◈1j 1m"). Running
 *  background agents the last Stop did not list count as agents. With no kinds at all (state from before this
 *  version), the plain total, as before. On a wide pane the oldest task's running time sits in brackets beside its
 *  kind once it reaches a minute ("◈ 2 jobs (12m) · 1 monitor"); a narrow pane has no room, and there "1m" already
 *  means one monitor. */
function bgChipText(kinds: Partial<Record<TaskKind, number>> | undefined, total: number, isNarrow: boolean, oldest?: { kind: TaskKind; time: string }): string {
  const k: Partial<Record<TaskKind, number>> = { ...(kinds ?? {}) }
  const known = KIND_ORDER.reduce((sum, x) => sum + (k[x] ?? 0), 0)
  if (known === 0) return isNarrow ? `◈${total}` : `◈ ${total}`
  if (total > known) k.agent = (k.agent ?? 0) + total - known
  const parts = KIND_ORDER.filter(x => (k[x] ?? 0) > 0).map(x => {
    const n = k[x] ?? 0
    if (isNarrow) return `${n}${KIND_WORD[x][2]}`
    return `${n} ${n === 1 ? KIND_WORD[x][0] : KIND_WORD[x][1]}${oldest?.kind === x ? ` (${oldest.time})` : ''}`
  })
  return isNarrow ? `◈${parts.join(' ')}` : `◈ ${parts.join(' · ')}`
}

/** The oldest task's kind and running time, for the chip: only once it reaches a minute. A wake-up waits, it does not
 *  run, so it is never the one timed. */
function oldestRun(rows: readonly BgRow[], t: number): { kind: TaskKind; time: string } | undefined {
  const first = rows.filter(r => r.kind !== 'wake-up').sort((a, b) => a.since - b.since)[0]
  return first && t - first.since >= 60_000 ? { kind: first.kind, time: ranFor(first, t) } : undefined
}

/** Writes the latest card, one write at a time, in order. Never rejects. */
function flush($: EngineInterface): Promise<void> {
  if (!me || retiredId !== undefined || dir === '') return writing
  isDirty = false
  const path = `${dir}/${me.id}.json`
  const text = JSON.stringify(me)
  // This session's own state for the strip: redrawn at once, not on the 5 s refresh.
  // The ◈ chip beside the pill names the background work, so the pill says only "Waiting".
  const mine = { status: me.status as string, text: me.status === 'replied' ? 'Done' : me.status === 'background' ? 'Waiting' : label(me) }
  void update($, self, v => (v && v.status === mine.status && v.text === mine.text ? v : mine)).catch(() => undefined)
  writing = writing.then(() => $.fs.write(path, text)).catch(() => undefined)
  return writing
}

/** The turn ended: the phase follows from how it ended and what is still in flight. */
function settleTurnEnd(): void {
  phase = currentTasks().length > 0 ? 'background' : 'replied'
}

/** Adopt the session's id when it changed (/clear, /resume): retire the old card, start a fresh one. */
async function adoptId($: EngineInterface, t: number): Promise<void> {
  if (!me) return
  const id = await $.session.id()
  if (id === me.id && retiredId === undefined) return
  if (id === retiredId) return // the new id is not there yet
  if (retiredId === undefined && me.status !== 'closed') {
    const old = { ...me, status: 'closed' as const, activity: undefined, tasks: undefined, bg: undefined, changedAt: t, seenAt: t }
    writing = writing.then(() => $.fs.write(`${dir}/${old.id}.json`, JSON.stringify(old))).catch(() => undefined)
  }
  retiredId = undefined
  phase = 'open'
  mainActivity = undefined
  stopTasks = undefined
  stopAt = 0
  tracked.clear()
  calls.clear()
  restoredProgress = undefined
  resetLive($)
  sessionStartedAt = t
  pushLive($)
  me = { ...me, v: CARD_VERSION, id, asked: '', status: 'open', activity: undefined, tasks: undefined, progress: undefined, bg: undefined, changedAt: t, seenAt: t }
  isDirty = true
}

/** Drops tracked/Stop-reported subagents that $.agent.list() shows ended at two refreshes running. */
async function pruneEndedAgents($: EngineInterface): Promise<void> {
  const list = stopTasks ?? tracked
  if (phase !== 'background' || ![...list.values()].some(x => x.agentId !== undefined)) return
  const agents = await $.agent.list()
  const ended = new Set(agents.filter(a => a.status === 'completed' || a.status === 'failed' || a.status === 'killed').map(a => a.id))
  for (const [key, x] of list) {
    if (x.agentId === undefined || !ended.has(x.agentId)) {
      endedOnce.delete(key)
      continue
    }
    if (endedOnce.has(key)) {
      list.delete(key)
      endedOnce.delete(key)
    } else endedOnce.add(key)
  }
  // Everything it waited on has ended and no turn followed: your turn.
  if (bgList().size === 0) phase = 'replied'
}

// ─── This session's live detail: model, task list, subagents, files changed ───
// All of it from events the session raises anyway (its steps, tool calls and
// their results) and from git status run on this computer: no tokens.

let sessionRoot = ''
/** The main loop's model, as its latest step named it. */
let ownModel: string | undefined

type Todo = { id: string; subject: string; status: 'pending' | 'in_progress' | 'completed'; active?: string }
/** Claude's own task list (TodoWrite, or TaskCreate/TaskUpdate/TaskList), main loop only. */
const todos = new Map<string, Todo>()
let todoSeq = 0
/** The task list changed in the turn running (or the last one). */
let todoTouched = false
/** After a reload: the card's last counts, until the list is seen again. */
let restoredProgress: { done: number; total: number } | undefined

const agents = new Map<string, AgentRow>()

/** A changed file with Claude's own diff lines, where Claude made the change. */
type Change = FileRow & { hunks: string[] }
const MAX_HUNK_LINES = 400
const DIFF_SHOWN = 120
let turnChanges = new Map<string, Change>()
let sessionChanges = new Map<string, Change>()
/** The card's edits from before a hot reload, which empties sessionChanges. */
let restoredEdits: string[] = []
/** Absolute path by key, for asking git about a file. */
const absByKey = new Map<string, string>()

type Sig = { code: string; stat: string; from?: string }
type Snap = { top: string; head: string; sigs: Map<string, Sig> }
/** The repository's top folder; null where the session's folder is not in one (or git is missing). */
let gitTop: string | null | undefined
let sessionBase: Promise<Snap | undefined> | undefined
let turnBase: Promise<Snap | undefined> | undefined
let gitTurn: Change[] = []
let gitSession: Change[] = []
let gitCheckedAt: number | undefined
let refreshing: Promise<void> | undefined

const TODO_STATUS = new Set(['pending', 'in_progress', 'completed'])
const str = (v: unknown) => (typeof v === 'string' ? v : '')

/** "claude-opus-4-1-20250805" → "opus-4-1". */
function shortModel(m: string | undefined): string | undefined {
  if (!m) return undefined
  return m
    .replace(/^claude-/, '')
    .replace(/-\d{8}$/, '')
    .replace(/\[1m\]$/i, ' 1M')
}

function progressOf(): { done: number; total: number; now?: string } | null {
  if (todos.size === 0) return restoredProgress ? { ...restoredProgress } : null
  const all = [...todos.values()]
  const doing = all.find(t => t.status === 'in_progress')
  return {
    done: all.filter(t => t.status === 'completed').length,
    total: all.length,
    now: doing ? doing.active || doing.subject : undefined,
  }
}

/** The task list, from the main loop's own task tools and their results. True when it changed. */
function noteTask(tool: string, args: Record<string, unknown>, rec: Record<string, unknown>): boolean {
  const status = (v: unknown): Todo['status'] => (typeof v === 'string' && TODO_STATUS.has(v) ? (v as Todo['status']) : 'pending')
  switch (tool) {
    case 'TodoWrite': {
      if (!Array.isArray(args.todos)) return false
      todos.clear()
      args.todos.forEach((raw, i) => {
        const t = asRecord(raw)
        if (str(t.content) !== '') todos.set(`todo-${i}`, { id: `todo-${i}`, subject: str(t.content), status: status(t.status), active: str(t.activeForm) || undefined })
      })
      break
    }
    case 'TaskCreate': {
      const task = asRecord(rec.task)
      const id = str(task.id) || `new-${++todoSeq}`
      todos.set(id, { id, subject: str(args.subject) || str(task.subject), status: 'pending', active: str(args.activeForm) || undefined })
      break
    }
    case 'TaskUpdate': {
      const id = str(args.taskId)
      if (id === '') return false
      if (args.status === 'deleted') {
        todos.delete(id)
        break
      }
      const was = todos.get(id) ?? { id, subject: `Task ${id}`, status: 'pending' as const }
      todos.set(id, {
        ...was,
        subject: str(args.subject) || was.subject,
        active: str(args.activeForm) || was.active,
        status: typeof args.status === 'string' ? status(args.status) : was.status,
      })
      break
    }
    case 'TaskList': {
      if (!Array.isArray(rec.tasks)) return false
      todos.clear()
      for (const raw of rec.tasks) {
        const t = asRecord(raw)
        if (str(t.id) !== '') todos.set(str(t.id), { id: str(t.id), subject: str(t.subject), status: status(t.status) })
      }
      break
    }
    default:
      return false
  }
  restoredProgress = undefined
  todoTouched = true
  return true
}

/** A path as the files view shows it: relative to the session's folder where inside it. */
function relPath(abs: string): string {
  const p = abs.replace(/\\/g, '/')
  const r = sessionRoot.replace(/\\/g, '/').replace(/\/+$/, '')
  if (r !== '' && p.toLowerCase().startsWith(`${r.toLowerCase()}/`)) return p.slice(r.length + 1)
  return p.split('/').filter(x => x !== '').slice(-2).join('/')
}

function patchLines(raw: unknown): string[] {
  const out: string[] = []
  if (!Array.isArray(raw)) return out
  for (const x of raw) {
    const h = asRecord(x)
    const n = (k: string) => (typeof h[k] === 'number' ? (h[k] as number) : 0)
    out.push(`@@ -${n('oldStart')},${n('oldLines')} +${n('newStart')},${n('newLines')} @@`)
    if (Array.isArray(h.lines)) for (const l of h.lines) if (typeof l === 'string') out.push(l)
  }
  return out
}

function merge(into: Map<string, Change>, c: Change): void {
  const was = into.get(c.key)
  if (!was) {
    into.set(c.key, { ...c, hunks: c.hunks.slice(0, MAX_HUNK_LINES) })
    return
  }
  const sum = (a?: number, b?: number) => (a === undefined || b === undefined ? undefined : a + b)
  into.set(c.key, {
    ...was,
    kind: was.kind === 'added' && c.kind !== 'deleted' ? 'added' : c.kind,
    plus: sum(was.plus, c.plus),
    minus: sum(was.minus, c.minus),
    hunks: [...was.hunks, ...c.hunks].slice(0, MAX_HUNK_LINES),
  })
}

const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])

/** A file Claude (or a subagent) wrote or edited, from the tool's own result. */
function noteFile(tool: string, args: Record<string, unknown>, rec: Record<string, unknown>): boolean {
  const path = str(rec.filePath) || str(args.file_path) || str(args.notebook_path)
  if (path === '' || rec.staged === true) return false
  let kind: FileKind = 'modified'
  let hunks = patchLines(rec.structuredPatch)
  if (tool === 'Write' && rec.type === 'create') {
    kind = 'added'
    if (hunks.length === 0 && typeof rec.content === 'string') {
      const body = rec.content.replace(/\n$/, '')
      hunks = body === '' ? [] : body.split('\n').map(l => `+${l}`)
    }
  }
  const body = hunks.filter(l => !l.startsWith('@@'))
  const isKnown = tool !== 'NotebookEdit' && (hunks.length > 0 || kind === 'added')
  const key = folderKey(path)
  absByKey.set(key, path)
  const c: Change = {
    key,
    path: relPath(path),
    kind,
    plus: isKnown ? body.filter(l => l.startsWith('+')).length : undefined,
    minus: isKnown ? body.filter(l => l.startsWith('-')).length : undefined,
    by: 'claude',
    hunks,
  }
  merge(turnChanges, c)
  merge(sessionChanges, c)
  // Newest last, so the card's cap drops the oldest.
  const merged = sessionChanges.get(key)!
  sessionChanges.delete(key)
  sessionChanges.set(key, merged)
  return true
}

/** The files this session edited, for its card: the restored ones (older), then its own calls', newest last. */
function editList(): string[] {
  return [...restoredEdits.filter(k => !sessionChanges.has(k)), ...sessionChanges.keys()].slice(-EDITS_MAX)
}

/** Runs git in the session's folder; its output, or undefined when it failed. */
async function git($: EngineInterface, args: string[], cwd?: string): Promise<string | undefined> {
  const r = await $.process
    .run(['git', '-c', 'core.quotepath=off', ...args], { cwd: cwd ?? sessionRoot, timeoutMs: 15_000 })
    .catch(() => undefined)
  return r && (r.exitCode === 0 || r.exitCode === 1) ? r.stdout : undefined
}

/** What git status says now: each changed path's status code and line counts. */
async function snap($: EngineInterface): Promise<Snap | undefined> {
  if (gitTop === null || sessionRoot === '') return undefined
  if (gitTop === undefined) {
    const r = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { cwd: sessionRoot, timeoutMs: 15_000 }).catch(() => undefined)
    gitTop = r && r.exitCode === 0 && r.stdout.trim() !== '' ? r.stdout.trim() : null
    if (gitTop === null) return undefined
  }
  const top = gitTop
  const [st, head] = await Promise.all([
    git($, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], top),
    git($, ['rev-parse', '--verify', '-q', 'HEAD'], top),
  ])
  if (st === undefined) return undefined
  const h = (head ?? '').trim()
  const ns = h !== '' ? await git($, ['diff', 'HEAD', '--numstat', '-z', '--no-renames'], top) : ''
  const stats = new Map<string, string>()
  for (const item of (ns ?? '').split('\0')) {
    const m = item.match(/^(\S+)\t(\S+)\t([\s\S]+)$/)
    if (m) stats.set(m[3]!, `${m[1]}\t${m[2]}`)
  }
  const sigs = new Map<string, Sig>()
  const parts = st.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const t = parts[i]!
    if (t.length < 4) continue
    const code = t.slice(0, 2)
    const rel = t.slice(3)
    const from = /[RC]/.test(code) ? parts[++i] : undefined
    sigs.set(rel, { code, stat: stats.get(rel) ?? '', from })
  }
  return { top, head: h, sigs }
}

/** The paths whose git status changed between two snapshots. */
function compare(base: Snap, cur: Snap): Change[] {
  const out: Change[] = []
  const hasCommitted = base.head !== cur.head
  for (const rel of new Set([...base.sigs.keys(), ...cur.sigs.keys()])) {
    const a = base.sigs.get(rel)
    const b = cur.sigs.get(rel)
    if (a && b && a.code === b.code && a.stat === b.stat) continue
    // Clean again: committed (not a change of the files) or changed back.
    if (!b && hasCommitted) continue
    const code = b?.code ?? '  '
    const kind: FileKind = !b
      ? 'modified'
      : code === '??' || code[0] === 'A'
        ? 'added'
        : code.includes('D')
          ? 'deleted'
          : code.includes('R')
            ? 'renamed'
            : 'modified'
    // Line counts only where the file was clean before: then git's count is this change's.
    const counts = !a && b?.stat ? b.stat.split('\t').map(Number) : []
    const abs = `${cur.top}/${rel}`
    const key = folderKey(abs)
    absByKey.set(key, abs)
    out.push({
      key,
      path: relPath(abs),
      kind,
      plus: Number.isFinite(counts[0]) ? counts[0] : undefined,
      minus: Number.isFinite(counts[1]) ? counts[1] : undefined,
      from: b?.from ? relPath(`${cur.top}/${b.from}`) : undefined,
      by: 'git',
      hunks: [],
    })
  }
  return out
}

const KIND_RANK: Record<FileKind, number> = { added: 0, modified: 1, renamed: 2, deleted: 3 }

/** Claude's own edits, then what only git saw (shell edits, deletes, renames). */
function viewList(scope: 'turn' | 'session'): FileRow[] {
  const mine = scope === 'turn' ? turnChanges : sessionChanges
  const seen = scope === 'turn' ? gitTurn : gitSession
  const out = new Map<string, FileRow>()
  const row = ({ hunks: _h, ...r }: Change): FileRow => r
  for (const c of mine.values()) out.set(c.key, row(c))
  for (const g of seen) {
    const c = out.get(g.key)
    if (!c) out.set(g.key, row(g))
    else if (g.kind === 'deleted' || g.kind === 'renamed') out.set(g.key, { ...c, kind: g.kind, from: g.from })
  }
  return [...out.values()].sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.path.localeCompare(b.path))
}

const gitState = () => (gitTop === null ? null : gitTop === undefined ? undefined : true)

async function publishFiles($: EngineInterface): Promise<void> {
  await update($, filesView, v => {
    const list = viewList(v.scope)
    const isGit = gitState()
    if (same(list, v.list) && v.isGit === isGit && v.checkedAt === gitCheckedAt) return v
    return { ...v, list, isGit, checkedAt: gitCheckedAt }
  })
}

/** This session's live detail for the strip and the panel; redrawn only when it changed. */
function pushLive($: EngineInterface): void {
  const p = progressOf()
  const order = { running: 0, failed: 1, stopped: 2, done: 3 }
  const bg = bgList()
  const fresh = {
    isWorking: isTurnRunning,
    model: ownModel,
    progress: p,
    showProgress: p !== null && (p.done < p.total || todoTouched),
    agents: [...agents.values()].sort((a, b) => order[a.status] - order[b.status] || a.startedAt - b.startedAt),
    turnFiles: viewList('turn').length,
    // The strip's count: the background work in flight, while a turn runs too (the "Waiting on …" label names the same).
    bg: bg.size,
    // The same, counted by kind for the ◈ chip (jobs, agents, monitors, wake-ups).
    bgKinds: currentKinds(),
    // One row each, oldest first, for the panel's BACKGROUND section and the chip's time.
    bgRows: [...bg].map(([id, x]) => ({ id, kind: x.kind, what: x.what, since: x.since, isExact: x.isExact })).sort((a, b) => a.since - b.since),
  }
  void update($, liveAtom, v => (same(v, fresh) ? v : fresh)).catch(() => undefined)
  publishTurns($)
}

/** git status now against the snapshot at the session's start, and at the running turn's start. */
function refreshGit($: EngineInterface): Promise<void> {
  if (refreshing) return refreshing
  refreshing = (async () => {
    await update($, filesView, v => ({ ...v, isLoading: true }))
    const cur = await snap($).catch(() => undefined)
    if (cur) {
      lastSnap = cur
      const sb = await sessionBase
      if (sb) gitSession = compare(sb, cur)
      // A turn that ended keeps what it changed: later edits (yours, another session's) are not its.
      const tb = isTurnRunning ? await turnBase : undefined
      if (tb) gitTurn = compare(tb, cur)
      gitCheckedAt = await $.clock.now()
    }
    await update($, filesView, v => ({ ...v, isLoading: false }))
    await publishFiles($)
    pushLive($)
  })()
    .catch(() => undefined)
    .finally(() => {
      refreshing = undefined
    })
  return refreshing
}

/** The turn ended: what git says changed since it started, kept as that turn's. */
function settleTurnFiles($: EngineInterface): void {
  const tb = turnBase
  if (!tb) return
  void (async () => {
    const base = await tb
    if (!base) return
    const cur = await snap($)
    if (!cur || turnBase !== tb) return
    lastSnap = cur
    gitTurn = compare(base, cur)
    if (sessionBase) {
      const sb = await sessionBase
      if (sb) gitSession = compare(sb, cur)
    }
    gitCheckedAt = await $.clock.now()
    await publishFiles($)
    pushLive($)
  })().catch(() => undefined)
}

/** Opens the panel on the files view. */
async function openFiles($: EngineInterface): Promise<void> {
  // Open first, inside the press (see the recap's turn button): an open after an await is "unasked".
  const opening = $.ui.open({ id: PANE, title: 'Sessions', closeOnEscape: true })
  await update($, filesView, v => ({ ...v, view: 'files' as const, open: null }))
  await opening
  await publishFiles($)
  await refreshGit($)
}

/** Shows (or hides) one file's diff: Claude's own edit lines, or git's diff against the last commit. */
async function toggleDiff($: EngineInterface, key: string): Promise<void> {
  const cur = await read($, filesView)
  if (cur.open?.key === key) {
    await update($, filesView, v => ({ ...v, open: null }))
    return
  }
  const row = cur.list.find(r => r.key === key)
  const mine = (cur.scope === 'turn' ? turnChanges : sessionChanges).get(key)
  let lines: string[] = []
  let note: string | undefined
  if (mine && mine.hunks.length > 0) {
    lines = mine.hunks
    note = "Claude's edits"
  } else if (row?.kind === 'deleted' && !gitTop) {
    note = 'Deleted'
  } else if (gitTop) {
    const abs = (absByKey.get(key) ?? '').replace(/\\/g, '/')
    const top = gitTop.replace(/\\/g, '/')
    const rel = abs.toLowerCase().startsWith(`${top.toLowerCase()}/`) ? abs.slice(top.length + 1) : ''
    if (rel !== '') {
      let out = await git($, ['diff', 'HEAD', '--', rel], gitTop)
      if (!out || out.trim() === '') out = await git($, ['diff', '--no-index', '--', '/dev/null', rel], gitTop)
      const all = (out ?? '').split('\n')
      const first = all.findIndex(l => l.startsWith('@@'))
      lines = first >= 0 ? all.slice(first).filter((l, i, xs) => !(i === xs.length - 1 && l === '')) : []
      note = lines.length > 0 ? 'git diff against the last commit' : row?.kind === 'deleted' ? 'Deleted' : 'No text diff (binary, or back as committed)'
    }
  } else {
    note = 'No diff recorded'
  }
  await update($, filesView, v => ({
    ...v,
    open: { key, lines: lines.slice(0, DIFF_SHOWN), more: Math.max(0, lines.length - DIFF_SHOWN), note },
  }))
}

/** Starts the session's file and task tracking over (a new session, /clear, a reload). */
function resetLive($: EngineInterface): void {
  todos.clear()
  todoTouched = false
  agents.clear()
  turnChanges = new Map()
  sessionChanges = new Map()
  restoredEdits = []
  gitTurn = []
  gitSession = []
  turnBase = undefined
  gitTop = undefined
  gitCheckedAt = undefined
  lastSnap = undefined
  sessionBase = snap($).catch(() => undefined)
  turnRecs = []
  void update($, turnsAtom, () => []).catch(() => undefined)
  void update($, recapAtom, () => null).catch(() => undefined)
}

/** Agents the session lists: their status where it ended, and any this module missed (a reload). */
async function syncAgents($: EngineInterface): Promise<boolean> {
  const hasRunning = [...agents.values()].some(a => a.status === 'running')
  if (!hasRunning && !isTurnRunning) return false
  const list = await $.agent.list()
  const t = await $.clock.now()
  let changed = false
  for (const info of list) {
    const was = agents.get(info.id)
    const ended = info.status === 'completed' ? 'done' : info.status === 'failed' ? 'failed' : info.status === 'killed' ? 'stopped' : undefined
    if (!was) {
      if (ended) continue
      agents.set(info.id, { id: info.id, type: info.type || 'agent', description: info.description, status: 'running', startedAt: t })
      changed = true
    } else if (ended && was.status === 'running') {
      agents.set(info.id, { ...was, status: ended, endedAt: t, activity: undefined })
      changed = true
    }
  }
  return changed
}

// ─── Turns: one record per turn of this session ───
// Facts from the session's own events, plus Claude's one-line "Turn: …"
// summary, which the guidance below asks for (the only part that costs tokens).

const TURN_GUIDANCE = `## Turn summary
When you used tools in a turn, end your final reply with one line in exactly this form:
Turn: <what you did, under 15 words>
If there is one thing the user should verify, add it to that line: "Turn: <what you did> · check: <what to verify, under 10 words>". Leave the line out of replies that used no tools.`

/** With the journal on, Claude may add a lesson for the day page; with it off, the guidance stays as short as before. */
const LESSON_GUIDANCE = `If the turn taught something worth keeping (a cause found, a trap, a better way), add it to the same line too: "· lesson: <under 15 words>". Most turns have no lesson.`

function turnGuidance(): string {
  return isJournal ? `${TURN_GUIDANCE}\n${LESSON_GUIDANCE}` : TURN_GUIDANCE
}

const MAX_TURNS = 20
let sessionStartedAt = 0
/** Newest first; the first is the running turn, or the last one. */
let turnRecs: TurnRecord[] = []

function toolKind(tool: string, args: Record<string, unknown>): ToolKind | undefined {
  if (tool === 'Agent' || tool === 'Task' || /log_assumption$/.test(tool)) return undefined
  if (['Read', 'Grep', 'Glob', 'LS', 'WebFetch', 'WebSearch', 'NotebookRead'].includes(tool)) return 'read'
  if (FILE_TOOLS.has(tool)) return 'edit'
  if (tool === 'Bash' || tool === 'PowerShell') {
    const cmd = `${str(args.command)} ${str(args.description)}`
    return /\b(test|tests|pytest|jest|vitest|mocha|rspec|go test|cargo test|npm t)\b/i.test(cmd) ? 'test' : 'shell'
  }
  return 'other'
}

/** Claude's "Turn: … · check: … · lesson: …" line, the last one in its answer. Check and lesson come in either order. */
function parseSummary(answer: string): { summary?: string; check?: string; lesson?: string } {
  const lines = answer.split('\n').map(l => l.trim()).filter(l => /^[*_]*turn[*_]*\s*:/i.test(l))
  const line = lines[lines.length - 1]
  if (!line) return {}
  const body = line.replace(/^[*_]*turn[*_]*\s*:[*_]*\s*/i, '').replace(/[*_]+$/, '').trim()
  const [what, ...parts] = body.split(/\s*[·|•]\s*(?=(?:check|lesson)\s*:)/i)
  const field = (name: 'check' | 'lesson') => {
    const p = parts.find(x => x.toLowerCase().startsWith(name))
    return p?.replace(/^\w+\s*:\s*/, '').replace(/[*_.]+$/, '').trim() || undefined
  }
  return { summary: what?.trim() || undefined, check: field('check'), lesson: field('lesson') }
}

/** The running (or last) turn, refreshed from what the session tracks now. */
function refreshTurn(): void {
  const cur = turnRecs[0]
  if (!cur) return
  const list = viewList('turn')
  const n = (k: FileKind) => list.filter(r => r.kind === k).length
  turnRecs[0] = {
    ...cur,
    files: { added: n('added'), modified: n('modified'), deleted: n('deleted'), renamed: n('renamed'), top: list.slice(0, 4) },
    agents: [...agents.values()].map(a => ({ id: a.id, type: a.type, model: a.model, status: a.status, startedAt: a.startedAt, endedAt: a.endedAt })),
  }
}

function publishTurns($: EngineInterface): void {
  refreshTurn()
  const fresh = turnRecs.slice()
  void update($, turnsAtom, v => (same(v, fresh) ? v : fresh)).catch(() => undefined)
}

function noteTurnTool(tool: string, args: Record<string, unknown>): void {
  const cur = turnRecs[0]
  if (!cur || cur.status !== 'running') return
  if (/log_assumption$/.test(tool) && str(args.assumption) !== '') {
    const impact = args.impact === 'high' || args.impact === 'low' ? args.impact : undefined
    turnRecs[0] = { ...cur, assumptions: [...cur.assumptions, { text: str(args.assumption), impact }] }
    return
  }
  const kind = toolKind(tool, args)
  if (!kind) return
  turnRecs[0] = { ...cur, tools: { ...cur.tools, [kind]: (cur.tools[kind] ?? 0) + 1 }, toolTotal: cur.toolTotal + 1 }
}

/** The `journal` setting: off by default. On, it keeps the JSONL log and the markdown day journal. */
let isJournal = false
/** Where the markdown day journal goes: `<root>/YYYY/MM/YYYY-MM-DD.md`. Set at session.start. */
let journalDir = ''
const LOG_KEEP_DAYS = 30

/**
 * Removes day folders of the journal log older than LOG_KEEP_DAYS. Only
 * folders directly under `<board>/log/` named as a date are ever touched.
 * The file API cannot delete, so the host's own remove command does.
 */
async function pruneLogs($: EngineInterface): Promise<void> {
  if (!isJournal || dir === '') return
  const root = `${dir}/log`
  const entries = await $.fs.list(root).catch(() => [])
  const cutoff = (await $.clock.now()) - LOG_KEEP_DAYS * 86_400_000
  const isWindows = /^[A-Za-z]:/.test(dir)
  for (const f of entries) {
    if (f.kind !== 'dir' || !/^\d{4}-\d{2}-\d{2}$/.test(f.name)) continue
    const at = Date.parse(`${f.name}T00:00:00`)
    if (!Number.isFinite(at) || at >= cutoff) continue
    const path = `${root}/${f.name}`
    const argv = isWindows ? ['cmd', '/c', 'rd', '/s', '/q', path.replace(/\//g, '\\')] : ['rm', '-rf', '--', path]
    await $.process.run(argv, { timeoutMs: 10_000 }).catch(() => undefined)
  }
}

const CARD_KEEP_MS = 7 * 86_400_000
const CARD_FILE = /^(.+)\.(json|assume)$/

/**
 * Removes the card and assumptions files of other sessions untouched for
 * CARD_KEEP_MS. One fresh file keeps the whole session: a live session's
 * .assume is rewritten only when its count changes, so it can be old while
 * the card still heartbeats.
 */
async function pruneCards($: EngineInterface): Promise<void> {
  if (dir === '') return
  const entries = await $.fs.list(dir).catch(() => [])
  const cutoff = (await $.clock.now()) - CARD_KEEP_MS
  const sessions = new Map<string, { paths: string[]; isOld: boolean }>()
  for (const f of entries) {
    const m = f.kind === 'file' ? CARD_FILE.exec(f.name) : null
    if (!m || m[1] === me?.id) continue
    const s = sessions.get(m[1]) ?? { paths: [], isOld: true }
    // mtimeMs 0 is an unknown age: keep.
    s.isOld &&= f.mtimeMs > 0 && f.mtimeMs < cutoff
    s.paths.push(`${dir}/${f.name}`)
    sessions.set(m[1], s)
  }
  const paths = [...sessions.values()].filter(s => s.isOld).flatMap(s => s.paths)
  const isWindows = /^[A-Za-z]:/.test(dir)
  for (let i = 0; i < paths.length; i += 40) {
    const chunk = paths.slice(i, i + 40)
    const argv = isWindows ? ['cmd', '/c', 'del', '/f', '/q', ...chunk.map(p => p.replace(/\//g, '\\'))] : ['rm', '-f', '--', ...chunk]
    await $.process.run(argv, { timeoutMs: 10_000 }).catch(() => undefined)
  }
}

/**
 * The daily journal log: one line per turn that used tools, for the journal's
 * wrap-up to read. Outside the vault; no prompt text and no file paths from
 * the turn's records, but Claude's own summary may name a file. One
 * file per session per day, so sessions never write the same file.
 */
function logTurn($: EngineInterface, r: TurnRecord): void {
  if (!isJournal || !me || dir === '' || r.toolTotal === 0) return
  const d = new Date(r.startedAt)
  const day = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
  const path = `${dir}/log/${day}/${me.id}.jsonl`
  const f = r.files
  const line = JSON.stringify({
    at: clockTime(r.startedAt),
    project: me.project,
    did: r.summary ?? null,
    check: r.check,
    lesson: r.lesson,
    mins: Math.max(1, Math.round(((r.endedAt ?? r.startedAt) - r.startedAt) / 60_000)),
    files: f.added + f.modified + f.deleted + f.renamed,
    assumed: r.assumptions.length,
    status: r.status,
  })
  writing = writing
    .then(async () => {
      const old = await $.fs.read(path).catch(() => '')
      await $.fs.write(path, `${old}${line}\n`)
      const i = turnRecs.findIndex(x => x.id === r.id)
      if (i >= 0) turnRecs[i] = { ...turnRecs[i]!, logged: true }
      publishTurns($)
      await countToday($)
      await writeJournal($, day)
    })
    .catch(() => undefined)
}

/**
 * The markdown day journal, rebuilt from every session's JSONL of that day.
 * Each session writes only its own JSONL, so a rebuild never loses a line for
 * good: two rebuilds at once can leave one turn out until the next rebuild.
 * Whatever the old page holds under "## My notes" is kept.
 */
async function writeJournal($: EngineInterface, day: string, read?: Map<string, JournalLine[]>): Promise<void> {
  if (!isJournal || dir === '' || journalDir === '') return
  const sessions = read ?? (await readDay($, day))
  if (sessions.size === 0) return
  const path = journalPath(journalDir, day)
  const old = await $.fs.read(path).catch(() => '')
  const page = renderJournal(day, sessions, keptNotes(old), tickedChecks(old))
  if (page === old) return
  // Text written outside "## My notes" would be lost: keep the edited page beside the new one.
  if (editedOutsideNotes(old)) {
    const d = new Date(await $.clock.now())
    const stamp = `${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
    await $.fs.write(`${path.slice(0, -'.md'.length)}.edited-${stamp}.md`, old)
  }
  await writeWhole($, path, page)
}

/**
 * Writes a file so that a crash leaves either the old text or the new, never
 * half of it: the text goes to `<path>.tmp` first, then the host's own move
 * renames it over the file (the file API has no rename). On one disk that
 * rename is atomic. If the move fails, the file is written in place, as
 * before, and the temp file is removed.
 */
async function writeWhole($: EngineInterface, path: string, text: string): Promise<void> {
  const tmp = `${path}.tmp`
  await $.fs.write(tmp, text)
  const isWindows = /^[A-Za-z]:/.test(path)
  const win = (p: string) => p.replace(/\//g, '\\')
  const moved = await $.process
    .run(isWindows ? ['cmd', '/c', 'move', '/y', win(tmp), win(path)] : ['mv', '-f', '--', tmp, path], { timeoutMs: 10_000 })
    .then(r => r.exitCode === 0)
    .catch(() => false)
  if (moved) return
  await $.fs.write(path, text)
  const argv = isWindows ? ['cmd', '/c', 'del', '/f', '/q', win(tmp)] : ['rm', '-f', '--', tmp]
  await $.process.run(argv, { timeoutMs: 10_000 }).catch(() => undefined)
}

/** Every session's logged turns of one day, by session id. */
async function readDay($: EngineInterface, day: string): Promise<Map<string, JournalLine[]>> {
  const logDay = `${dir}/log/${day}`
  const names = (await $.fs.list(logDay).catch(() => []))
    .filter(f => f.kind === 'file' && f.name.endsWith('.jsonl'))
    .map(f => f.name)
    .sort()
  const sessions = new Map<string, JournalLine[]>()
  for (const name of names) {
    const lines = parseLog(await $.fs.read(`${logDay}/${name}`).catch(() => ''))
    if (lines.length > 0) sessions.set(name.slice(0, -'.jsonl'.length), lines)
  }
  return sessions
}

/**
 * At session start: rebuilds the page of every day still in the log (the last
 * LOG_KEEP_DAYS) that has no page, a page that counts fewer or more turns than
 * the log holds, or a page cut short. A page that is up to date is left alone,
 * so an edit you made to a past day is not undone when nothing new came in.
 */
async function healJournal($: EngineInterface): Promise<void> {
  if (!isJournal || dir === '' || journalDir === '') return
  const days = (await $.fs.list(`${dir}/log`).catch(() => []))
    .filter(f => f.kind === 'dir' && /^\d{4}-\d{2}-\d{2}$/.test(f.name))
    .map(f => f.name)
    .sort()
  for (const day of days) {
    const sessions = await readDay($, day)
    const turns = [...sessions.values()].reduce((n, l) => n + l.length, 0)
    if (turns === 0) continue
    const old = await $.fs.read(journalPath(journalDir, day)).catch(() => '')
    if (isStale(old, turns)) await writeJournal($, day, sessions)
  }
}

/** Lines in today's journal log, every session's: the Turns tab's 📓 count. */
async function countToday($: EngineInterface): Promise<void> {
  if (!isJournal || dir === '') return
  const d = new Date(await $.clock.now())
  const day = `${dir}/log/${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
  let n = 0
  for (const f of await $.fs.list(day).catch(() => [])) {
    if (f.kind !== 'file' || !f.name.endsWith('.jsonl')) continue
    const text = await $.fs.read(`${day}/${f.name}`).catch(() => '')
    n += text.split('\n').filter(l => l.trim() !== '').length
  }
  await update($, journalAtom, v => (v?.today === n ? v : { today: n }))
}
function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return s % 60 === 0 || m >= 10 ? `${m}m` : `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

/** "opus", "sonnet", "haiku", or the short model name. */
function modelFamily(m: string | undefined): string {
  const s = shortModel(m) ?? '?'
  return s.match(/opus|sonnet|haiku/)?.[0] ?? s
}
function modelColor(m: string | undefined): string {
  const f = modelFamily(m)
  return f === 'opus' ? 'magenta' : f === 'sonnet' ? 'blue' : f === 'haiku' ? 'green' : 'yellow'
}

const TOOL_COLOR: Record<ToolKind, string> = { read: 'cyan', edit: 'yellow', shell: 'magenta', test: 'green', other: 'gray' }
const TOOL_ORDER: ToolKind[] = ['read', 'edit', 'shell', 'test', 'other']

/** A coloured badge: a model, a kind, a state. */
function badge(ui: Kit, key: string, color: string, text: string): RenderElement {
  const { Text } = ui
  return (
    <Text key={key} bold color="black" backgroundColor={color}>
      {` ${text} `}
    </Text>
  )
}

/** The tab bar on top of the panel: Sessions · Turns · Files · Context. */
function tabBar($: EngineInterface, view: 'board' | 'turns' | 'files' | 'context', turns: number, files: number, ui: Kit): RenderElement {
  const { Box, Text, Button } = ui
  const tab = (id: 'board' | 'turns' | 'files' | 'context', text: string) => (
    <Button
      key={`sb-tab-${id}`}
      plain
      onPress={() =>
        void (async () => {
          await update($, filesView, v => ({ ...v, view: id, open: null }))
          if (id === 'files') await refreshGit($)
          if (id === 'context') await refreshDay(guardIo($)).catch(() => undefined)
        })()
      }
    >
      {view === id ? (
        <Text bold color="black" backgroundColor="cyan">{` ${text} `}</Text>
      ) : (
        <Text dimColor>{` ${text} `}</Text>
      )}
    </Button>
  )
  return (
    <Box key="sb-tabs" marginBottom={1}>
      {tab('board', 'Sessions')}
      <Text> </Text>
      {tab('turns', turns > 0 ? `Turns ${turns}` : 'Turns')}
      <Text> </Text>
      {tab('files', files > 0 ? `Files ${files}` : 'Files')}
      <Text> </Text>
      {tab('context', 'Context')}
    </Box>
  )
}

/** One turn as a full card: Claude's line, the check, files, tools, subagents, assumptions. */
function turnCard($: EngineInterface, r: TurnRecord, t: number, width: number, isLatest: boolean, ui: Kit): RenderElement {
  const { Box, Text, Button } = ui
  const inner = Math.max(20, width - 4)
  const hasHigh = r.assumptions.some(a => a.impact === 'high')
  const ended = r.endedAt ?? t
  const statusText =
    r.status === 'running' ? <Text color="cyan">◔ working</Text>
    : r.status === 'answered' ? <Text bold color="green">✓ answered</Text>
    : r.status === 'stopped' ? <Text bold color="red">× stopped</Text>
    : <Text bold color="red">✗ error</Text>
  const fileTotal = r.files.added + r.files.modified + r.files.deleted + r.files.renamed
  const segs = TOOL_ORDER.filter(k => (r.tools[k] ?? 0) > 0)
  const BAR = Math.min(20, Math.max(8, inner - 26))
  let left = BAR
  const cells = segs.map((k, i) => {
    const n = i === segs.length - 1 ? left : Math.max(1, Math.round(((r.tools[k] ?? 0) / Math.max(1, r.toolTotal)) * BAR))
    const take = Math.min(left, n)
    left -= take
    return [k, take] as const
  })
  return (
    <Box key={`sb-turn-card-${r.id}`} flexDirection="column">
      <Text>
        {isLatest && badge(ui, `sb-turn-tag-${r.id}`, 'cyan', r.status === 'running' ? '◔ RUNNING' : '● LATEST')}
        <Text bold>{`${isLatest ? ' ' : ''}${clockTime(r.startedAt)}`}</Text>
        <Text dimColor>{` · ${duration(ended - r.startedAt)}  `}</Text>
        {r.model && badge(ui, `sb-turn-model-${r.id}`, modelColor(r.model), modelFamily(r.model))}
        <Text>{'  '}</Text>
        {statusText}
        {r.logged && <Text color="green">{'  📓'}</Text>}
      </Text>
      <Box flexDirection="column" borderStyle="round" borderColor={hasHigh ? 'yellow' : 'cyan'} paddingX={1}>
        {r.summary ? (
          <Text bold>{short(r.summary, inner * 2)}</Text>
        ) : (
          <Text dimColor italic>{r.status === 'running' ? 'Working…' : 'No summary line from Claude'}</Text>
        )}
        {r.check && (
          <Text>
            {badge(ui, `sb-turn-check-${r.id}`, 'yellow', '⚑ CHECK')}
            <Text color="yellow">{` ${short(r.check, inner - 11)}`}</Text>
          </Text>
        )}
        {isJournal && r.summary && r.status !== 'running' && (
          <Button
            key={`sb-turn-journal-${r.id}`}
            plain
            onPress={() => void $.prompt.fill({ text: `done ${r.summary}`, mode: 'replace' }).catch(() => undefined)}
          >
            <Text color={LINK}>📓 Journal ›</Text>
          </Button>
        )}
        {fileTotal > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>{`FILES · ${fileTotal}`}</Text>
            {r.files.top.map(f => {
              const m = KIND_MARK[f.kind]
              const stat = f.kind === 'deleted' ? 'deleted' : f.plus !== undefined ? `+${f.plus ?? 0} −${f.minus ?? 0}` : ''
              return (
                <Text key={`sb-turn-file-${r.id}-${f.key}`}>
                  {badge(ui, `sb-turn-fm-${r.id}-${f.key}`, m.color, m.mark)}
                  <Text>{` ${short(f.path, Math.max(8, inner - stat.length - 7))}`}</Text>
                  <Text dimColor>{stat ? `  ${stat}` : ''}</Text>
                </Text>
              )
            })}
            {isLatest && (
              <Button key={`sb-turn-files-${r.id}`} plain onPress={() => void openFiles($)}>
                <Text color={LINK}>{fileTotal > r.files.top.length ? `all ${fileTotal} with diffs ›` : 'diffs ›'}</Text>
              </Button>
            )}
          </Box>
        )}
        {r.toolTotal > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>{`TOOLS · ${r.toolTotal}`}</Text>
            <Text>
              {cells.map(([k, n]) => (
                <Text key={`sb-turn-bar-${r.id}-${k}`} color={TOOL_COLOR[k]}>
                  {'█'.repeat(n)}
                </Text>
              ))}
              <Text>{'  '}</Text>
              {segs.map(k => (
                <Text key={`sb-turn-tk-${r.id}-${k}`} color={TOOL_COLOR[k]}>{`${k} ${r.tools[k]} `}</Text>
              ))}
            </Text>
          </Box>
        )}
        {r.agents.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>SUBAGENTS</Text>
            {r.agents.map((a, i) => (
              <Text key={`sb-turn-agent-${r.id}-${a.id}`}>
                <Text dimColor>{i === r.agents.length - 1 ? '└─ ' : '├─ '}</Text>
                <Text bold color={a.status === 'running' ? 'magenta' : a.status === 'done' ? 'green' : 'red'}>
                  {a.status === 'running' ? '◔' : a.status === 'done' ? '✓' : a.status === 'failed' ? '✗' : '×'}
                </Text>
                <Text>{` ${short(a.type, 18)} `}</Text>
                {badge(ui, `sb-turn-am-${r.id}-${a.id}`, modelColor(a.model), shortModel(a.model) ?? '?')}
                <Text dimColor>{` ${duration((a.endedAt ?? t) - a.startedAt)}`}</Text>
              </Text>
            ))}
          </Box>
        )}
        {r.assumptions.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>{`ASSUMED · ${r.assumptions.length}`}</Text>
            {r.assumptions.slice(0, 4).map((a, i) => (
              <Text key={`sb-turn-as-${r.id}-${i}`}>
                {a.impact === 'high' ? badge(ui, `sb-turn-ah-${r.id}-${i}`, 'yellow', 'HIGH') : badge(ui, `sb-turn-al-${r.id}-${i}`, 'gray', 'low')}
                <Text>{` ${short(a.text, inner - 8)}`}</Text>
              </Text>
            ))}
            {r.assumptions.length > 4 && <Text dimColor>{`… ${r.assumptions.length - 4} more in /assumptions`}</Text>}
          </Box>
        )}
      </Box>
    </Box>
  )
}

/** The Turns tab: a session header, the latest turn as a card, earlier turns folded. */
function turnsPane(
  $: EngineInterface,
  recs: TurnRecord[],
  t: number,
  width: number,
  expanded: string | null,
  l: Live,
  journal: { today: number } | null,
  ui: Kit,
): RenderElement {
  const { Box, Text, Button } = ui
  const done = recs.filter(r => r.endedAt !== undefined).slice(0, 12).reverse()
  const longest = Math.max(1, ...done.map(r => r.endedAt! - r.startedAt))
  const SPARK = '▁▂▃▄▅▆▇█'
  const spark = done.map(r => SPARK[Math.min(7, Math.floor(((r.endedAt! - r.startedAt) / longest) * 7.999))]).join('')
  const session = viewList('session')
  const count = (k: FileKind) => session.filter(f => f.kind === k).length
  const assumed = recs.reduce((n, r) => n + r.assumptions.length, 0)
  const [latest, ...earlier] = recs
  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>{short(me?.project ?? '', Math.max(8, width - 30))}</Text>
        <Text>{'  '}</Text>
        {l.model && badge(ui, 'sb-turns-model', modelColor(l.model), shortModel(l.model) ?? '')}
        <Text dimColor>{`  ${duration(t - sessionStartedAt)} · ${recs.length} turn${recs.length === 1 ? '' : 's'}`}</Text>
        {journal && <Text>{'  '}</Text>}
        {journal && badge(ui, 'sb-turns-journal', 'green', `📓 ${journal.today} today`)}
      </Text>
      {(spark !== '' || session.length > 0 || assumed > 0) && (
        <Text>
          {spark !== '' && <Text dimColor>turn length </Text>}
          {spark !== '' && <Text color="cyan">{spark}</Text>}
          {spark !== '' && <Text>{'  '}</Text>}
          {count('added') > 0 && <Text color="green">{`+${count('added')} `}</Text>}
          {count('modified') + count('renamed') > 0 && <Text color="yellow">{`~${count('modified') + count('renamed')} `}</Text>}
          {count('deleted') > 0 && <Text color="red">{`−${count('deleted')} `}</Text>}
          {session.length > 0 && <Text dimColor>files </Text>}
          {assumed > 0 && <Text color="yellow">{`· ⚠ ${assumed} assumed`}</Text>}
        </Text>
      )}
      {!latest && (
        <Box marginTop={1}>
          <Text dimColor>No turns yet. Each turn shows here as it runs.</Text>
        </Box>
      )}
      {latest && <Box marginTop={1}>{turnCard($, latest, t, width, true, ui)}</Box>}
      {earlier.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>EARLIER</Text>
          {earlier.map(r => {
            const isOpen = expanded === r.id
            const color = r.status === 'answered' ? 'green' : r.status === 'running' ? 'cyan' : 'red'
            const icon = r.status === 'answered' ? '✓' : r.status === 'running' ? '◔' : r.status === 'stopped' ? '×' : '✗'
            const files = r.files
            const line2 = r.summary ?? (r.status === 'stopped' ? 'You stopped it' : r.status === 'error' ? 'Stopped on an error' : r.toolTotal === 0 ? 'Chat only' : 'No summary line')
            const facts = [`${r.toolTotal} tools`, r.agents.length > 0 ? `${r.agents.length} subagent${r.agents.length === 1 ? '' : 's'}` : '', r.assumptions.length > 0 ? `${r.assumptions.length} assumed` : '']
              .filter(x => x !== '')
              .join(' · ')
            return (
              <Box key={`sb-turn-row-${r.id}`} flexDirection="column" marginTop={1}>
                <Button key={`sb-turn-toggle-${r.id}`} plain onPress={() => void update($, expandedAtom, v => (v === r.id ? null : r.id))}>
                  <Text>
                    <Text color={color}>▌ </Text>
                    <Text bold color={color}>{icon}</Text>
                    <Text bold>{` ${clockTime(r.startedAt)}`}</Text>
                    <Text dimColor>{` ${duration((r.endedAt ?? t) - r.startedAt)}  `}</Text>
                    {r.model && badge(ui, `sb-turn-rm-${r.id}`, modelColor(r.model), modelFamily(r.model))}
                    <Text>{'  '}</Text>
                    {files.added > 0 && <Text color="green">{`+${files.added} `}</Text>}
                    {files.modified + files.renamed > 0 && <Text color="yellow">{`~${files.modified + files.renamed} `}</Text>}
                    {files.deleted > 0 && <Text color="red">{`−${files.deleted} `}</Text>}
                    {r.logged && <Text color="green">📓</Text>}
                    <Text dimColor>{isOpen ? ' ▾' : ' ▸'}</Text>
                  </Text>
                </Button>
                <Text>
                  <Text color={color}>▌ </Text>
                  <Text italic dimColor={!r.summary}>{`  ${short(line2, width - 6)}`}</Text>
                </Text>
                {!isOpen && facts !== '' && (
                  <Text>
                    <Text color={color}>▌ </Text>
                    <Text dimColor>{`  ${facts}`}</Text>
                  </Text>
                )}
                {isOpen && <Box marginTop={1}>{turnCard($, r, t, width, false, ui)}</Box>}
              </Box>
            )
          })}
        </Box>
      )}
    </Box>
  )
}

/** The panel's block for this session: model, task bar, subagents, the files button. */
function thisSession($: EngineInterface, l: Live, t: number, width: number, ui: Kit): RenderElement {
  const { Box, Text, Button } = ui
  const model = shortModel(l.model)
  const p = l.progress
  // Background work, oldest first. A background agent the SUBAGENTS section lists is not repeated here.
  const listed = new Set(l.agents.filter(a => a.status === 'running').map(a => a.id))
  const bgRows = (l.bgRows ?? []).filter(r => r.kind !== 'agent' || !listed.has(r.id))
  return (
    <Box key="sb-self-block" flexDirection="column" marginTop={1}>
      <Text>
        <Text bold color="black" backgroundColor="cyan">
          {' THIS SESSION '}
        </Text>
        {model && <Text dimColor>{`  ${model}`}</Text>}
      </Text>
      {p && (
        <Text>
          {(() => {
            const [filled, empty] = barCells(p.done, p.total, 16)
            return (
              <Text>
                <Text color="cyan">{'▰'.repeat(filled)}</Text>
                <Text dimColor>{'▱'.repeat(empty)}</Text>
              </Text>
            )
          })()}
          <Text bold>{` ${p.done}/${p.total}`}</Text>
          {p.now && <Text dimColor>{` · ${short(p.now, Math.max(8, width - 26))}`}</Text>}
        </Text>
      )}
      {bgRows.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color={COLOR.background}>
            {`BACKGROUND · ${bgRows.length} running`}
          </Text>
          {bgRows.map(r => {
            // "▌ ◔ job      Render ja_test on Drama 3        12m": the kind in a column, the time at the right edge.
            const time = ranFor(r, t)
            const kind = KIND_WORD[r.kind][0].padEnd(8)
            const room = Math.max(8, width - 4 - kind.length - time.length - 2)
            const what = short(r.what, room)
            return (
              <Text key={`sb-bg-${r.id}`}>
                <Text color={COLOR.background}>▌ </Text>
                <Text>{`◔ ${kind} ${what.padEnd(room)} `}</Text>
                <Text dimColor>{time}</Text>
              </Text>
            )
          })}
        </Box>
      )}
      {l.agents.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="magenta">
            {`SUBAGENTS · ${l.agents.filter(a => a.status === 'running').length} running`}
          </Text>
          {l.agents.map(a => {
            const color = a.status === 'running' ? 'magenta' : a.status === 'failed' ? 'red' : 'gray'
            const icon = a.status === 'running' ? '◔' : a.status === 'done' ? '✓' : a.status === 'failed' ? '✗' : '×'
            const when = a.status === 'running' ? ago(t - a.startedAt) : a.status
            const head = [a.type, shortModel(a.model) ?? 'model not known yet', when].join(' · ')
            return (
              <Box key={`sb-agent-${a.id}`} flexDirection="column">
                <Text>
                  <Text color={color}>▌ </Text>
                  <Text bold={a.status === 'running'} dimColor={a.status !== 'running'}>
                    {icon} {short(head, width - 6)}
                  </Text>
                </Text>
                {a.description !== '' && (
                  <Text>
                    <Text color={color}>▌ </Text>
                    <Text italic dimColor>
                      {`  ${short(a.description, width - 8)}`}
                    </Text>
                  </Text>
                )}
                {a.activity && a.status === 'running' && (
                  <Text>
                    <Text color={color}>▌ </Text>
                    <Text dimColor>{`  → ${short(a.activity, width - 10)}`}</Text>
                  </Text>
                )}
              </Box>
            )
          })}
        </Box>
      )}
      <Box marginTop={1}>
        <Button key="sb-files-open" plain onPress={() => void openFiles($)}>
          <Text color={LINK}>
            {l.turnFiles > 0
              ? `✎ Files changed ${l.isWorking ? 'this' : 'last'} turn · ${l.turnFiles} ›`
              : '✎ Files changed ›'}
          </Text>
        </Button>
      </Box>
    </Box>
  )
}

const KIND_MARK: Record<FileKind, { mark: string; color: string; pill: string }> = {
  added: { mark: '+', color: 'green', pill: 'added' },
  modified: { mark: '~', color: 'yellow', pill: 'modified' },
  renamed: { mark: '→', color: 'magenta', pill: 'renamed' },
  deleted: { mark: '−', color: 'red', pill: 'deleted' },
}

type FilesState = {
  view: 'board' | 'turns' | 'files' | 'context'
  toggled?: string[]
  scope: 'turn' | 'session'
  list: FileRow[]
  isGit?: boolean | null
  checkedAt?: number
  isLoading: boolean
  open: { key: string; lines: string[]; more: number; note?: string } | null
}

/** A long path cut in the middle, keeping its file name: "learnings/_sources/0091…/run_fixes.py". */
function midShort(path: string, n: number): string {
  if (path.length <= n) return path
  const parts = path.split('/')
  const name = parts.pop() ?? path
  if (name.length + 2 >= n) return short(name, n)
  let head = ''
  for (const p of parts) {
    if (head.length + p.length + name.length + 3 > n) break
    head += `${p}/`
  }
  return `${head}…/${name}`
}

/** The folder a file is grouped under: its first segment, deepened while every sibling shares it. */
function groupFiles(rows: FileRow[]): { folder: string; files: { row: FileRow; name: string }[] }[] {
  const byTop = new Map<string, FileRow[]>()
  for (const r of rows) {
    const i = r.path.indexOf('/')
    const top = i < 0 ? '' : r.path.slice(0, i + 1)
    byTop.set(top, [...(byTop.get(top) ?? []), r])
  }
  const out: { folder: string; files: { row: FileRow; name: string }[] }[] = []
  for (const [top, list] of byTop) {
    let folder = top
    if (top !== '' && list.length > 1) {
      // Deepen while every file still shares the next folder.
      for (;;) {
        const rest = list.map(r => r.path.slice(folder.length))
        const first = rest[0]!.indexOf('/')
        if (first < 0) break
        const seg = rest[0]!.slice(0, first + 1)
        if (!rest.every(x => x.startsWith(seg) && x.length > seg.length)) break
        folder += seg
      }
    } else if (list.length === 1) {
      // One file alone gets no folder row: its full path is shown.
      folder = ''
    }
    const files = list
      .map(row => ({ row, name: row.path.slice(folder.length) }))
      .sort((x, y) => KIND_RANK[x.row.kind] - KIND_RANK[y.row.kind] || (y.row.plus ?? 0) + (y.row.minus ?? 0) - ((x.row.plus ?? 0) + (x.row.minus ?? 0)) || x.name.localeCompare(y.name))
    const loose = out.find(g => g.folder === folder)
    if (folder === '' && loose) loose.files.push(...files)
    else out.push({ folder, files })
  }
  // Loose files (no folder) first, then folders by size.
  const size = (g: { files: { row: FileRow }[] }) => g.files.reduce((n, f) => n + (f.row.plus ?? 0) + (f.row.minus ?? 0), 0)
  return out.sort((x, y) => (x.folder === '' ? -1 : y.folder === '' ? 1 : size(y) - size(x)))
}

/** A git diff --stat bar: five cells, scaled to the biggest change listed, green then red. */
function statBar(plus: number, minus: number, biggest: number): [number, number, number] {
  const total = plus + minus
  if (total === 0 || biggest === 0) return [0, 0, 5]
  const cells = Math.max(1, Math.min(5, Math.ceil((total / biggest) * 5)))
  const green = plus === 0 ? 0 : minus === 0 ? cells : Math.max(1, Math.min(cells - 1, Math.round((plus / total) * cells)))
  return [green, cells - green, 5 - cells]
}

const DIFF_BG = { add: '#173a26', del: '#3d1b1e', hunk: '#14303d' }
const NEW_FILE_SHOWN = 12

/** One file's diff, git style: hunk headers, old and new line numbers, coloured rows. */
function diffView(lines: string[], more: number, isNew: boolean, width: number, keyBase: string, ui: Kit): RenderElement[] {
  const { Text } = ui
  const out: RenderElement[] = []
  let oldN = 1
  let newN = 1
  let shown = 0
  const pad = (text: string) => (text.length >= width ? clip(text, width) : text + ' '.repeat(width - text.length))
  const num = (n: number | undefined) => (n === undefined ? '    ' : String(n).padStart(4))
  const cap = isNew ? NEW_FILE_SHOWN : Infinity
  let hidden = 0
  lines.forEach((raw, i) => {
    const ln = raw.replace(/\t/g, '  ')
    const hunk = ln.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/)
    if (hunk) {
      oldN = Number(hunk[1])
      newN = Number(hunk[2])
      if (isNew) return
      const where = `@@ line ${newN}${hunk[3] ? ` · ${hunk[3].trim()}` : ''}`
      out.push(
        <Text key={`${keyBase}-h-${i}`} color="cyan" backgroundColor={DIFF_BG.hunk}>
          {pad(` ${where}`)}
        </Text>,
      )
      return
    }
    if (ln.startsWith('\\')) return
    if (shown >= cap) {
      hidden++
      return
    }
    shown++
    const body = ln.slice(1)
    if (ln.startsWith('+')) {
      out.push(
        <Text key={`${keyBase}-l-${i}`} backgroundColor={DIFF_BG.add}>
          <Text dimColor>{isNew ? `${num(newN)} ` : `     ${num(newN)} `}</Text>
          <Text color="green">{pad(`+ ${body}`).slice(0, Math.max(0, width - (isNew ? 5 : 10)))}</Text>
        </Text>,
      )
      newN++
    } else if (ln.startsWith('-')) {
      out.push(
        <Text key={`${keyBase}-l-${i}`} backgroundColor={DIFF_BG.del}>
          <Text dimColor>{`${num(oldN)}      `}</Text>
          <Text color="red">{pad(`− ${body}`).slice(0, Math.max(0, width - 10))}</Text>
        </Text>,
      )
      oldN++
    } else {
      out.push(
        <Text key={`${keyBase}-l-${i}`}>
          <Text dimColor>{`${num(oldN)} ${num(newN)} `}</Text>
          <Text dimColor>{clip(`  ${body}`, Math.max(0, width - 10))}</Text>
        </Text>,
      )
      oldN++
      newN++
    }
  })
  const left = hidden + more
  if (left > 0) {
    out.push(
      <Text key={`${keyBase}-more`} dimColor>
        {`      … ${left} more line${left === 1 ? '' : 's'}${isNew ? ' · new file' : ''}`}
      </Text>,
    )
  }
  return out
}

/** Folder labels grouped like the strip's pills: "vault ×2, iams-ups". */
function grouped(labels: readonly string[]): string {
  const n = new Map<string, number>()
  for (const x of labels) n.set(x, (n.get(x) ?? 0) + 1)
  return [...n].map(([name, k]) => (k > 1 ? `${name} ×${k}` : name)).join(', ')
}

/** The panel's files view: this turn's (or the session's) files, as a folder tree with git-style stats and diffs.
 *  `also`: by file key, the other live sessions that edited it too. */
function filesPane($: EngineInterface, fv: FilesState, t: number, width: number, also: ReadonlyMap<string, string>, ui: Kit): RenderElement {
  const { Box, Text, Button } = ui
  const tab = (scope: 'turn' | 'session', text: string) => {
    const isOn = fv.scope === scope
    return (
      <Button
        key={`sb-files-tab-${scope}`}
        plain
        onPress={() =>
          void (async () => {
            await update($, filesView, v => ({ ...v, scope, open: null }))
            await publishFiles($)
          })()
        }
      >
        {isOn ? <Text bold color="black" backgroundColor="blue">{` ${text} `}</Text> : <Text dimColor>{` ${text} `}</Text>}
      </Button>
    )
  }
  const counts = (['added', 'modified', 'renamed', 'deleted'] as const)
    .map(k => [k, fv.list.filter(r => r.kind === k).length] as const)
    .filter(([, n]) => n > 0)
  const totalPlus = fv.list.reduce((n, r) => n + (r.plus ?? 0), 0)
  const totalMinus = fv.list.reduce((n, r) => n + (r.minus ?? 0), 0)
  const biggest = Math.max(0, ...fv.list.map(r => (r.plus ?? 0) + (r.minus ?? 0)))
  const groups = groupFiles(fv.list)
  const toggled = new Set(fv.toggled ?? [])
  const isFolded = (folder: string, n: number) => folder !== '' && (n > 8) !== toggled.has(folder)
  const footer =
    fv.isGit === null
      ? "Not a git folder: only Claude's own Write/Edit changes are listed (no shell edits or deletes)."
      : fv.isLoading
        ? 'Checking git status…'
        : fv.checkedAt !== undefined
          ? `Claude's edits + git status · checked ${ago(t - fv.checkedAt)} ago`
          : "Claude's edits + git status"
  const nums = (plus?: number, minus?: number) => {
    const bits: RenderElement[] = []
    if (plus) bits.push(<Text key="p" color="green">{`+${plus.toLocaleString('en-US')}`}</Text>)
    if (minus) bits.push(<Text key="m" color="red">{`${plus ? ' ' : ''}−${minus.toLocaleString('en-US')}`}</Text>)
    return bits
  }
  const fileRow = (r: FileRow, name: string, branch: string) => {
    const m = KIND_MARK[r.kind]
    const isOpen = fv.open?.key === r.key
    const plus = r.plus ?? 0
    const minus = r.minus ?? 0
    const statText =
      r.kind === 'deleted' ? (r.minus ? `deleted · ${r.minus} lines` : 'deleted') : r.kind === 'renamed' && !plus && !minus ? 'renamed' : `${plus ? `+${plus}` : ''}${plus && minus ? ' ' : ''}${minus ? `−${minus}` : ''}`
    const [g, rd, empty] = statBar(plus, minus, biggest)
    const label = r.kind === 'renamed' && r.from ? `${name} ← ${r.from}` : name
    const alsoText = also.has(r.key) ? ` also: ${also.get(r.key)}` : ''
    const nameRoom = Math.max(10, width - branch.length - statText.length - alsoText.length - 14)
    return (
      <Box key={`sb-file-${r.key}`} flexDirection="column">
        <Button key={`sb-file-btn-${r.key}`} plain onPress={() => void toggleDiff($, r.key)}>
          <Text>
            <Text dimColor>{branch}</Text>
            <Text bold color={m.color}>{`${m.mark} `}</Text>
            <Text bold={isOpen} color={r.kind === 'deleted' ? 'red' : undefined}>{midShort(label, nameRoom)}</Text>
            {alsoText !== '' && <Text color="yellow" dimColor>{alsoText}</Text>}
            <Text>{'  '}</Text>
            {r.kind === 'deleted' || r.kind === 'renamed' ? (
              <Text color={m.color}>{statText}</Text>
            ) : (
              nums(r.plus, r.minus)
            )}
            {r.kind !== 'deleted' && r.kind !== 'renamed' && (plus > 0 || minus > 0) && (
              <Text>
                {'  '}
                <Text color="green">{'■'.repeat(g)}</Text>
                <Text color="red">{'■'.repeat(rd)}</Text>
                <Text dimColor>{'■'.repeat(empty)}</Text>
              </Text>
            )}
            <Text dimColor>{isOpen ? '  ▾' : '  ▸'}</Text>
          </Text>
        </Button>
        {isOpen && fv.open && (
          <Box flexDirection="column" marginBottom={1}>
            {fv.open.note && <Text dimColor italic>{`      ${fv.open.note}`}</Text>}
            {diffView(fv.open.lines, fv.open.more, r.kind === 'added', width, `sb-diff-${r.key}`, ui)}
          </Box>
        )}
      </Box>
    )
  }
  return (
    <Box flexDirection="column">
      <Box>
        {tab('turn', isTurnRunning ? 'This turn' : 'Last turn')}
        <Text> </Text>
        {tab('session', 'Whole session')}
        <Text>{'   '}</Text>
        <Button key="sb-files-refresh" plain onPress={() => void refreshGit($)}>
          <Text color={LINK}>↻ Refresh</Text>
        </Button>
      </Box>
      {counts.length > 0 && (
        <Box marginTop={1}>
          {counts.map(([k, n], i) => (
            <Text key={`sb-files-count-${k}`}>
              {i > 0 ? ' ' : ''}
              <Text bold color="black" backgroundColor={KIND_MARK[k].color}>{` ${KIND_MARK[k].mark}${n} ${KIND_MARK[k].pill} `}</Text>
            </Text>
          ))}
          {(totalPlus > 0 || totalMinus > 0) && (
            <Text>
              {'  '}
              {totalPlus > 0 && <Text bold color="green">{`+${totalPlus.toLocaleString('en-US')}`}</Text>}
              {totalMinus > 0 && <Text bold color="red">{`${totalPlus > 0 ? ' ' : ''}−${totalMinus.toLocaleString('en-US')}`}</Text>}
              <Text dimColor> lines</Text>
            </Text>
          )}
        </Box>
      )}
      {fv.list.length === 0 && (
        <Box marginTop={1}>
          <Text dimColor>{fv.isLoading ? 'Checking…' : fv.scope === 'turn' ? 'No files changed in this turn.' : 'No files changed in this session.'}</Text>
        </Box>
      )}
      <Box flexDirection="column" marginTop={1}>
        {groups.map(gr => {
          if (gr.folder === '') return gr.files.map(f => fileRow(f.row, f.name, ''))
          const folded = isFolded(gr.folder, gr.files.length)
          const plus = gr.files.reduce((n, f) => n + (f.row.plus ?? 0), 0)
          const minus = gr.files.reduce((n, f) => n + (f.row.minus ?? 0), 0)
          return (
            <Box key={`sb-folder-${gr.folder}`} flexDirection="column">
              <Button
                key={`sb-folder-btn-${gr.folder}`}
                plain
                onPress={() =>
                  void update($, filesView, v => {
                    const set = new Set(v.toggled ?? [])
                    if (set.has(gr.folder)) set.delete(gr.folder)
                    else set.add(gr.folder)
                    return { ...v, toggled: [...set] }
                  })
                }
              >
                <Text>
                  <Text dimColor>{folded ? '▸ ' : '▾ '}</Text>
                  <Text bold>{midShort(gr.folder, Math.max(12, width - 26))}</Text>
                  <Text>{'  '}</Text>
                  {nums(plus, minus)}
                  <Text dimColor>{` · ${gr.files.length} file${gr.files.length === 1 ? '' : 's'}${folded ? ' · open ›' : ''}`}</Text>
                </Text>
              </Button>
              {!folded && gr.files.map((f, i) => fileRow(f.row, f.name, i === gr.files.length - 1 ? '  └ ' : '  ├ '))}
            </Box>
          )
        })}
      </Box>
      <Box marginTop={1}>
        <Text dimColor italic>
          {footer}
        </Text>
      </Box>
    </Box>
  )
}

/**
 * After a turn: what Claude asks you to verify, and assumptions waiting for review.
 * One piece that sits beside the "this session" pill. Not repeated here: how long the turn
 * took (Claude's own "Worked for" line says it), the file counts (the Files tab has them)
 * and a link to the Turns tab (`☰ All ›` opens the panel).
 */
function recapStrip(r: TurnRecord, review: { open: number; high: number }, ui: Kit): RenderElement {
  const { Text } = ui
  return (
    <Text key="sb-recap">
      {r.check !== undefined && badge(ui, 'sb-recap-check-pill', 'yellow', '⚑ CHECK')}
      {r.check !== undefined && <Text color="yellow">{` ${r.check}`}</Text>}
      {r.check !== undefined && review.open > 0 && <Text>{'  '}</Text>}
      {review.open > 0 && badge(ui, 'sb-recap-review', 'yellow', `⚠ ${review.open} to review ↓`)}
    </Text>
  )
}

type Live = { isWorking: boolean; model?: string; progress: { done: number; total: number; now?: string } | null; showProgress: boolean; agents: AgentRow[]; turnFiles: number; bgRows?: BgRow[] }

/** The strip's row for this session while it works: task bar, subagents, files changed. */
function liveStrip($: EngineInterface, columns: number, l: Live, running: number, ui: Kit): RenderElement {
  const { Box, Text, Button } = ui
  const parts: RenderElement[] = []
  const sep = (k: string) => (
    <Text key={k} dimColor>
      {'  │  '}
    </Text>
  )
  let used = 0
  if (l.showProgress && l.progress) {
    const [filled, empty] = barCells(l.progress.done, l.progress.total, 10)
    const count = ` ${l.progress.done}/${l.progress.total}`
    used += 10 + count.length
    parts.push(
      <Text key="sb-live-bar">
        <Text color="cyan">{'▰'.repeat(filled)}</Text>
        <Text dimColor>{'▱'.repeat(empty)}</Text>
        <Text bold>{count}</Text>
      </Text>,
    )
  }
  const tail: RenderElement[] = []
  if (running > 0) {
    // Each running subagent's model, as a badge in that model's colour.
    const live = l.agents.filter(a => a.status === 'running')
    const one = live.length === 1 ? live[0] : undefined
    const groups = new Map<string, { model?: string; n: number }>()
    for (const a of live) {
      const f = modelFamily(a.model)
      groups.set(f, { model: a.model, n: (groups.get(f)?.n ?? 0) + 1 })
    }
    const badges: RenderElement[] = []
    if (one) {
      badges.push(<Text key="sb-live-agent-type">{`${short(one.type, 16)} · `}</Text>)
      badges.push(badge(ui, 'sb-live-agent-m', modelColor(one.model), modelFamily(one.model)))
      used += short(one.type, 16).length + 12
    } else if (live.length <= 3) {
      live.forEach((a, i) => {
        if (i > 0) badges.push(<Text key={`sb-live-ag-gap-${i}`}> </Text>)
        badges.push(badge(ui, `sb-live-ag-${a.id}`, modelColor(a.model), modelFamily(a.model)))
      })
      used += live.length * 9
    } else {
      ;[...groups.entries()].forEach(([f, g], i) => {
        if (i > 0) badges.push(<Text key={`sb-live-agg-gap-${i}`}> </Text>)
        badges.push(badge(ui, `sb-live-agg-${f}`, modelColor(g.model), g.n > 1 ? `${f} ×${g.n}` : f))
      })
      used += groups.size * 11
    }
    tail.push(
      sep('sb-live-s1'),
      <Text key="sb-live-agents">
        <Text>◈ </Text>
        {badges}
      </Text>,
    )
  }
  if (l.turnFiles > 0) {
    const label = `✎ ${l.turnFiles} file${l.turnFiles === 1 ? '' : 's'} ›`
    used += label.length + 5
    tail.push(
      sep('sb-live-s2'),
      <Button key="sb-live-files" plain onPress={() => void openFiles($)}>
        <Text color={LINK}>{label}</Text>
      </Button>,
    )
  }
  // What it is on now, in the room left.
  const room = columns - used - 4
  if (l.showProgress && l.progress?.now && room > 8) {
    parts.push(
      <Text key="sb-live-now" dimColor>
        {` ${short(l.progress.now, room)}`}
      </Text>,
    )
  }
  if (parts.length === 0 && tail.length > 0) tail.shift()
  return (
    <Box key="sb-live" flexWrap="wrap">
      {parts}
      {tail}
    </Box>
  )
}

// ── what the context guard reads from the board ───────────────────────────────
// The guard itself is in guard-glue.tsx. The engine refuses a hooks module whose `$` crosses an import, so the guard
// never holds `$`: it holds the GuardIo that guardIo() builds here, and every `$.noun.event(...)` call stays in this file.

/** git status at the last refresh: which paths are dirty now. */
let lastSnap: Snap | undefined

/** Files this session changed that git still shows as uncommitted. */
function uncommittedMine(): { count: number; paths: string[] } {
  const cur = lastSnap
  if (!cur) return { count: 0, paths: [] }
  const dirty = new Set([...cur.sigs.keys()].map(rel => folderKey(`${cur.top}/${rel}`)))
  const mine = new Map<string, string>()
  for (const c of sessionChanges.values()) if (dirty.has(c.key)) mine.set(c.key, c.path)
  for (const c of gitSession) if (dirty.has(c.key)) mine.set(c.key, c.path)
  return { count: mine.size, paths: [...mine.values()].sort() }
}

type Overlap = NonNullable<PluginState['session-board']['alerts']['overlap']>
const OVERLAP_GIT_MS = 30_000
let overlapGitAt = -Infinity
/** The candidate files git last checked, and whether the strip showed any: git runs again only for new candidates or
 *  to see a shown file clear. */
let overlapChecked = ''
let isOverlapShown = false

/** Files this session and another live session both edited. Where git tracks a file, only while it is uncommitted:
 *  a commit by either session clears it. */
async function overlapOf($: EngineInterface, others: readonly BoardEntry[], cards: readonly BoardEntry[], t: number): Promise<Overlap | undefined> {
  const mine = new Set(editList())
  const byKey = new Map<string, BoardEntry[]>()
  for (const c of others) {
    if (c.status === 'gone' || c.status === 'closed') continue
    for (const k of new Set(c.edits ?? [])) if (mine.has(k)) byKey.set(k, [...(byKey.get(k) ?? []), c])
  }
  const candidates = JSON.stringify([...byKey.keys()].sort())
  // Nothing else runs git when the other session commits.
  if (byKey.size > 0 && (isOverlapShown || candidates !== overlapChecked) && t - overlapGitAt >= OVERLAP_GIT_MS) {
    overlapGitAt = t
    overlapChecked = candidates
    await refreshGit($)
  }
  const cur = lastSnap
  const top = typeof gitTop === 'string' ? folderKey(gitTop) : undefined
  const dirty = cur ? new Set([...cur.sigs.keys()].map(rel => folderKey(`${cur.top}/${rel}`))) : undefined
  const files = [...byKey].filter(([k]) => top === undefined || dirty === undefined || !k.startsWith(`${top}/`) || dirty.has(k))
  isOverlapShown = files.length > 0
  if (files.length === 0) return undefined
  const label = (c: BoardEntry) => folderLabel(c.folder, c.project, cards)
  const sessions = new Map(files.flatMap(([, cs]) => cs.map(c => [c.id, c] as const)))
  const names = new Map<string, { name: string; n: number }>()
  for (const c of [...sessions.values()].sort((a, b) => a.changedAt - b.changedAt)) {
    const name = label(c)
    names.set(name, { name, n: (names.get(name)?.n ?? 0) + 1 })
  }
  return {
    files: files.map(([key, cs]) => ({ key, path: relPath(absByKey.get(key) ?? key), with: cs.map(label) })),
    names: [...names.values()],
  }
}

/** Background shells and monitors, and subagents still running, by name. */
function jobLines(): string[] {
  const subagents = [...agents.values()].filter(a => a.status === 'running' && a.background !== true).map(a => `subagent ${a.type} · ${shortModel(a.model) ?? 'agent'}`)
  return [...currentTasks(), ...subagents]
}

/** How many of them: the number the chip calls jobs, and the one the picker's row shows. */
function jobsNow(): number {
  return jobLines().length
}

function guardIo($: EngineInterface): GuardIo {
  return {
    now: () => $.clock.now(),
    toast: (text, o) => $.ui.toast(text, o),
    openPane: () => $.ui.open({ id: PANE, title: 'Sessions', closeOnEscape: true }),
    storeGet: key => $.store.get(key),
    storeSet: (key, value) => $.store.set(key, value),
    readFile: path => $.fs.read(path),
    writeFile: (path, text) => $.fs.write(path, text),
    listDir: path => $.fs.list(path),
    run: (argv, o) => $.process.run(argv, o),
    // The guard only types into the prompt box; it never calls session.compact itself.
    fill: text => $.prompt.fill({ text, mode: 'replace' }),
    setGuard: fn => update($, guardAtom, fn),
    showContextTab: () => update($, filesView, v => ({ ...v, view: 'context' as const, open: null })),
    review: () => read($, reviewAtom),
    dir: () => dir,
    me: () => me,
    isTurnRunning: () => isTurnRunning,
    jobs: jobsNow,
    uncommitted: uncommittedMine,
    tasks: currentTasks,
    todoLines: () => [...todos.values()].filter(t => t.status !== 'completed').map(t => t.subject),
    jobLines,
    agents: () => [...agents.values()].filter(a => a.status === 'running').map(a => `${a.type} · ${shortModel(a.model) ?? 'agent'}`),
    refreshGit: () => refreshGit($),
    git: args => git($, args),
  }
}

/** True when a drawing shows nothing (an empty box or blank text): such a tree only adds a blank row. */
function isBlank(n: unknown): boolean {
  if (n === null || n === undefined || n === false || n === true) return true
  if (typeof n === 'string') return n.trim() === ''
  if (typeof n === 'number') return false
  if (Array.isArray(n)) return n.every(isBlank)
  const el = n as { type?: unknown; children?: unknown[] }
  if (el.type === 'Box' || el.type === 'Text') return (el.children ?? []).every(isBlank)
  return false
}

export const register: Register = (on, options) => {
  isJournal = options.journal === true
  on('session.start', async ($, e, next) => {
    // The context guard: the options, then the mode you last chose in the Context tab.
    await configureGuard(guardIo($), options)
    const home = (await $.env.get('USERPROFILE')) || (await $.env.get('HOME')) || ''
    if (home === '') return next(e) // nowhere shared to write: stay out of the way
    dir = `${home.replace(/[\\/]$/, '')}/.claude/session-board`
    journalDir = journalRoot(options.journalDir, home, dir)
    const root = await $.session.root()
    sessionRoot = root
    resetLive($)
    const at = await $.clock.now()
    sessionStartedAt = at
    const id = await $.session.id()
    // A reload of this module, or a resumed session: its own card says where it stood.
    const prior = await $.fs
      .read(`${dir}/${id}.json`)
      .then(parseCard)
      .catch(() => undefined)
    const isLive = prior !== undefined && prior.status !== 'closed' && prior.status !== 'gone' && at - prior.seenAt < GONE_MS
    me = {
      v: CARD_VERSION,
      id,
      folder: root,
      project: baseName(root),
      asked: prior?.asked ?? '',
      status: 'open',
      activity: undefined,
      changedAt: at,
      seenAt: at,
    }
    phase = 'open'
    if (isLive && prior) {
      // Hot reload mid-session: keep what the card said. A dialog that was open
      // stays shown until the next tool call in the main loop settles.
      // The background work it held, under the ids the engine gave it, so each one's report still takes it off; its
      // kind and start time as they were. A card from before 0.29.0 has labels only: their kind from the label, their
      // start no later than the card's last change.
      const restoredTasks = (): Map<string, Tracked> =>
        prior.bg
          ? new Map(prior.bg.map(x => [x.id, { ...x, ...(x.kind === 'agent' ? { agentId: x.id } : {}) }]))
          : new Map((prior.tasks ?? []).map((label, i) => {
              const cut = label.indexOf(': ')
              const what = cut < 0 ? label : label.slice(cut + 2)
              const kind = cut < 0 ? 'task' : label.startsWith('wake-up: ') ? 'wake-up' : kindOf(label.slice(0, cut))
              return [`restored-${i}`, { label, what, kind, since: prior.changedAt, isExact: false }]
            }))
      if (prior.status === 'working' || prior.status === 'needs-you') {
        phase = 'working'
        isTurnRunning = true
        mainActivity = prior.status === 'working' ? prior.activity : undefined
        if (prior.status === 'needs-you') calls.set('restored', { tool: '', args: {}, what: '', asking: prior.activity, at })
        if (prior.bg) stopTasks = restoredTasks()
      } else if (prior.status === 'background') {
        phase = 'background'
        stopTasks = restoredTasks()
      } else {
        phase = prior.status === 'stopped' || prior.status === 'replied' ? prior.status : 'open'
        mainActivity = prior.activity
      }
      me = { ...me, changedAt: prior.changedAt }
      restoredProgress = prior.progress
      restoredEdits = prior.edits ?? []
    }
    derive(at)
    isDirty = true
    await flush($)
    void pruneLogs($).catch(() => undefined)
    void pruneCards($).catch(() => undefined)
    void pruneGuardLogs(guardIo($)).catch(() => undefined)
    void countToday($).catch(() => undefined)
    // in the same queue as the turn lines, so this session never rebuilds a page twice at once
    writing = writing.then(() => healJournal($)).catch(() => undefined)
    await $.command.register({ name: 'sessions', description: 'Show all Claude Code sessions, this folder first' }).catch(() => undefined)
    void loadInstructions(guardIo($)).then(() => refreshGuard(guardIo($))).catch(() => undefined)

    let lastBeat = at
    let lastGood = new Map<string, BoardEntry>()

    $.clock.every(REFRESH_MS, () => {
      void (async () => {
        const t = await $.clock.now()
        await adoptId($, t).catch(() => undefined)
        await pruneEndedAgents($).catch(() => undefined)
        await syncAgents($).catch(() => false)
        pushLive($)
        await refreshGuard(guardIo($)).catch(() => undefined)
        // Today's journal count includes other sessions: refreshed while the Turns tab shows it.
        if (isJournal && (await read($, filesView)).view === 'turns') await countToday($).catch(() => undefined)
        // The pilot log's count follows the other sessions while the Context tab shows it.
        if ((await read($, filesView)).view === 'context') await refreshDay(guardIo($)).catch(() => undefined)
        // Open assumptions of this session, as the assumptions mod writes them.
        if (me) {
          const raw = await $.fs.read(`${dir}/${me.id}.assume`).catch(() => undefined)
          let rv = { open: 0, high: 0 }
          try {
            const v = raw === undefined ? undefined : (JSON.parse(raw) as { open?: unknown; high?: unknown })
            if (v && typeof v.open === 'number' && typeof v.high === 'number') rv = { open: v.open, high: v.high }
          } catch {
            // half written: next round
          }
          await update($, reviewAtom, v => (same(v, rv) ? v : rv))
        }
        derive(t)
        if (me && (isDirty || t - lastBeat >= HEARTBEAT_MS)) {
          lastBeat = t
          me = { ...me, seenAt: t }
          await flush($)
        }
        const files = await $.fs.list(dir).catch(() => [])
        const cards: BoardEntry[] = []
        const good = new Map<string, BoardEntry>()
        for (const f of files) {
          if (f.kind !== 'file' || !f.name.endsWith('.json')) continue
          // Untouched past every limit: an ended session. Skip the read.
          if (f.mtimeMs > 0 && t - f.mtimeMs > STALE_FILE_MS) continue
          const text = await $.fs.read(`${dir}/${f.name}`).catch(() => undefined)
          let c: BoardEntry | undefined
          try {
            c = text === undefined ? undefined : parseCard(text)
          } catch {
            // A card mid-write: show what it said last round.
            c = lastGood.get(f.name)
          }
          if (!c) continue
          good.set(f.name, c)
          // This session's own card: the live one, not last round's file.
          if (me && c.id === me.id) c = me
          const isQuiet = c.status !== 'closed' && t - c.seenAt > GONE_MS
          const card: BoardEntry = isQuiet ? { ...c, status: 'gone', activity: undefined, tasks: undefined, bg: undefined, changedAt: c.seenAt } : c
          const isEnded = card.status === 'closed' || card.status === 'gone'
          if (!isEnded || t - card.changedAt < KEEP_ENDED_MS) cards.push(card)
        }
        lastGood = good
        cards.sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.changedAt - a.changedAt)
        await update($, board, () => cards)
        await update($, now, () => t)

        const ownId = me?.id
        const others = cards.filter(c => c.id !== ownId)

        // Status line: alerts only, about other sessions, empty otherwise.
        // Needs you first, named by folder; replied after, named when one.
        // Background waits and working sessions are not alerts.
        const byAge = (x: BoardEntry, y: BoardEntry) => x.changedAt - y.changedAt
        const needs = others.filter(c => c.status === 'needs-you').sort(byAge)
        const replied = others.filter(c => c.status === 'replied').sort(byAge)
        // One entry per folder, oldest first: "iams-ups", "vault ×2".
        const group = (list: BoardEntry[]) => {
          const groups = new Map<string, { name: string; n: number }>()
          for (const c of list) {
            const key = folderKey(c.folder)
            const g = groups.get(key)
            groups.set(key, { name: folderLabel(c.folder, c.project, cards), n: (g?.n ?? 0) + 1 })
          }
          return [...groups.values()]
        }
        // Every other live session, counted, so the strip says how many are out there.
        const quiet = {
          working: others.filter(c => c.status === 'working').length,
          waiting: others.filter(c => c.status === 'background').length,
          idle: others.filter(c => c.status === 'open' || c.status === 'stopped').length,
        }
        const overlap = await overlapOf($, others, cards, t).catch(() => undefined)
        const fresh = { needs: group(needs), replied: group(replied), quiet, ...(overlap ? { overlap } : {}) }
        // Drawn in the strip above the prompt (below), not the status line.
        const prev = await read($, alerts)
        if (JSON.stringify(prev) !== JSON.stringify(fresh)) await update($, alerts, () => fresh)
        await $.ui.status(undefined)
      })().catch(() => undefined)
    })
    return next(e)
  })

  // Ask for Claude's one-line turn summary: the only part of the board that costs tokens.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    return {
      sections: [...composed.sections, { id: 'session-board:turn-summary', text: turnGuidance(), scope: 'session' as const }],
    }
  })

  on('command.run', { command: 'sessions' }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: 'Sessions', closeOnEscape: true })
    return { text: opened.isPlaced ? 'Sessions panel opened. Esc closes it.' : 'Widen the window to see the sessions panel.' }
  })

  on('prompt.submit', async ($, e, next) => {
    // "Asked" is only what you typed (at the terminal, from the app, or from your
    // phone): not a background task's report, a peer's message or a plugin's
    // prompt, which also arrive as prompts.
    const o = e.origin
    const isYours =
      o.kind === 'composer' || o.kind === 'bridge' || o.kind === 'sdk' || (o.kind === 'plugin' && o.asUser === true)
    const text = e.text.trim()
    // A background task's report can arrive under the app's own origin
    // ('sdk' in the desktop app), so recognise it by its text as well.
    const isTaskReport = o.kind === 'task-notification' || /^<task-notification[\s>]/.test(text)
    const t = await $.clock.now()
    await adoptId($, t).catch(() => undefined)
    // A background task's report: that task is done, and leaves every list at once.
    if (isTaskReport) {
      for (const m of e.text.matchAll(/<task-id>([^<]+)<\/task-id>/g)) dropTask(m[1]!.trim())
      derive(t)
      pushLive($)
    }
    if (isYours && !isTaskReport && text !== '') {
      // Sending a prompt is a veto, and ends the result row of the last compaction.
      await guardPromptSent(guardIo($))
    }
    const previous = me?.asked
    if (me && isYours && !isTaskReport && text !== '' && !text.startsWith('/')) me = { ...me, asked: short(text, 120) }
    if (isYours && !isTaskReport && text !== '') await update($, recapAtom, () => null)
    const result = await next(e)
    if (me && 'drop' in result && result.drop !== undefined && previous !== undefined) me = { ...me, asked: previous }
    if (me && me.asked !== previous) {
      isDirty = true
      await flush($)
    }
    return result
  }).catch(($, e, next) => next(e)) // never block your prompt

  on('turn.start', async ($, e, next) => {
    const t = await $.clock.now()
    await adoptId($, t).catch(() => undefined)
    isTurnRunning = true
    stopSeenThisTurn = false
    phase = 'working'
    mainActivity = 'Thinking'
    // A new turn: its own files; subagents that ended drop off; git's view as it starts.
    todoTouched = false
    turnChanges = new Map()
    gitTurn = []
    for (const [id, a] of agents) if (a.status !== 'running') agents.delete(id)
    turnBase = gitTop === null ? undefined : snap($).catch(() => undefined)
    turnRecs = [
      { id: e.turnId, startedAt: t, status: 'running' as const, model: ownModel, files: { added: 0, modified: 0, deleted: 0, renamed: 0, top: [] }, tools: {}, toolTotal: 0, agents: [], assumptions: [] },
      ...turnRecs,
    ].slice(0, MAX_TURNS)
    await update($, recapAtom, () => null)
    derive(t)
    await flush($)
    pushLive($)
    void publishFiles($).catch(() => undefined)
    await guardTurnStarted(guardIo($))
    return next(e)
  })

  // Each model request names its model: the main loop's, or a subagent's.
  on('turn.step', async function* ($, e, next) {
    try {
      const m = e.model
      if (e.agentId === undefined) {
        guardRequestCounted()
        if (m && m !== ownModel) {
          ownModel = m
          const cur = turnRecs[0]
          if (cur && cur.status === 'running') turnRecs[0] = { ...cur, model: m }
          pushLive($)
        }
      } else {
        const a = agents.get(e.agentId)
        if (a && ((m && a.model !== m) || a.status !== 'running')) {
          agents.set(a.id, { ...a, model: m || a.model, status: 'running', endedAt: undefined })
          pushLive($)
        }
      }
    } catch {
      // never in the way of the request
    }
    return yield* next(e)
  })

  // Background work this session starts, as its own calls report it. Used only
  // when classic Stop carries no `background_tasks`.
  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (r.agentId) {
      const t = await $.clock.now()
      if (e.background) tracked.set(r.agentId, task('subagent', short(e.description ?? e.subagentType ?? '', 50), 'agent', t, true, r.agentId))
      const model = 'model' in r && typeof r.model === 'string' && r.model !== '' ? r.model : e.model
      agents.set(r.agentId, { id: r.agentId, type: e.subagentType || 'agent', description: e.description ?? '', model, status: 'running', startedAt: t, background: e.background === true })
      pushLive($)
    }
    return r
  }).catch(($, e, next) => next(e))

  // A permission dialog is really on screen: the session waits for you. Only
  // when no hook beneath (another plugin, your settings hooks) decided it, since
  // then no dialog is shown. (Not tool.check: its "ask" only means the rules
  // alone did not settle it.)
  on('classic.PermissionRequest', async ($, e, next) => {
    const r = await next(e)
    if (!me || r.decision !== undefined || r.block !== undefined) return r
    const tool = String(e.tool_name)
    // In these modes no dialog is shown: auto lets a model classifier approve or
    // deny, bypassPermissions allows, dontAsk denies. Only a question box or a
    // plan review still waits for you there.
    const mode = String(e.permission_mode ?? '')
    const isUserChoice = tool === 'AskUserQuestion' || tool === 'ExitPlanMode'
    if (!isUserChoice && (mode === 'auto' || mode === 'bypassPermissions' || mode === 'dontAsk')) return r
    const t = await $.clock.now()
    const loop = e.agent_id
    const input = asRecord(e.tool_input)
    // Which call in flight asks: the same tool in the same loop, the same input if any is.
    const mine = [...calls.entries()].filter(([, c]) => c.agentId === loop && c.tool === tool && c.asking === undefined)
    const hit = mine.find(([, c]) => same(c.args, input)) ?? mine.sort((a, b) => a[1].at - b[1].at)[0]
    let what = describe(tool, input)
    if (/^(Running|Using \S+)\s*$/.test(what) && hit) what = hit[1].what
    const prefix = tool === 'AskUserQuestion' || tool === 'ExitPlanMode' ? '' : 'Approve: '
    const asking = `${prefix}${what}${loop !== undefined ? ' (subagent)' : ''}`
    if (hit) hit[1].asking = asking
    else calls.set(`ask-${++callSeq}`, { tool, agentId: loop, args: input, what, asking, at: t })
    derive(t)
    await flush($)
    return r
  }).catch(($, e, next) => next(e)) // never stand in the way of the dialog

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const loop = e.agentId
    const args = toolArgs(e)
    const what = describe(tool, args)
    const key = e.tool_use_id ?? `call-${++callSeq}`
    const t = await $.clock.now()
    const isQuestion = tool === 'AskUserQuestion' && loop === undefined
    calls.set(key, { tool, agentId: loop, args, what, asking: isQuestion ? what : undefined, at: t })
    if (loop === undefined) mainActivity = what
    else if (isTurnRunning) mainActivity = `${what} (subagent)`
    noteTurnTool(tool, args)
    const sub = loop === undefined ? undefined : agents.get(loop)
    if (sub) {
      agents.set(sub.id, { ...sub, activity: what })
      pushLive($)
    }
    derive(t)
    // Only a question box is worth a write before the call; the rest rides the next refresh.
    if (isQuestion) await flush($)
    try {
      const result = await next(e)
      // Background work this call left running (fallback tracking only).
      if (!('deny' in result && result.deny !== undefined)) {
        const rec = asRecord(result.result)
        // Its start: when the call returned with it running (the engine's own id, as its Stop list and its report use).
        const at = await $.clock.now()
        if (typeof rec.backgroundTaskId === 'string') tracked.set(rec.backgroundTaskId, task('shell', short(what, 50), 'job', at, true))
        if (tool === 'Monitor' && typeof rec.taskId === 'string') tracked.set(rec.taskId, task('monitor', short(what, 50), 'monitor', at, true))
        if (tool === 'Agent' && rec.status === 'async_launched' && typeof rec.agentId === 'string') {
          const was = tracked.get(rec.agentId)
          tracked.set(rec.agentId, task('subagent', short(typeof args.description === 'string' ? args.description : '', 50), 'agent', was?.since ?? at, true, rec.agentId))
        }
        let isNew = false
        try {
          if (loop === undefined) isNew = noteTask(tool, args, rec) || isNew
          if (FILE_TOOLS.has(tool)) isNew = noteFile(tool, args, rec) || isNew
        } catch {
          // a result in a shape this version does not read
        }
        noteGuardCall({ isMainLoop: loop === undefined, tool, args, rec, raw: result.result })
        if (isNew) {
          pushLive($)
          void publishFiles($).catch(() => undefined)
        }
      }
      return result
    } finally {
      const wasAsking = calls.get(key)?.asking !== undefined
      calls.delete(key)
      // A dialog of this loop with no call matched to it was this call's: dialogs come one at a time.
      for (const [k, c] of calls) if (k.startsWith('ask-') && c.agentId === loop) calls.delete(k)
      if (loop === undefined) calls.delete('restored')
      const t2 = await $.clock.now()
      publishTurns($)
      derive(t2)
      if (wasAsking && me?.status !== 'needs-you') await flush($)
    }
  }).catch(($, e, next) => next(e)) // a failure here never stops the tool

  // On the terminal, the run-in-background pill is drawn under a call only once
  // its command runs: so an approved dialog is closed. Memory only; the refresh writes.
  on('ui.render', { component: 'ToolProgress' }, ($, e, next) => {
    const c = calls.get(e.props.tool_use_id)
    if (c && c.asking !== undefined) {
      c.asking = undefined
      isDirty = true
    }
    return next(e)
  })

  // The main loop's Stop: what is still in flight as the turn ends.
  on('classic.Stop', async ($, e, next) => {
    const r = await next(e)
    if (e.agent_id !== undefined || r.block !== undefined || r.preventContinuation) return r
    if (e.background_tasks !== undefined) {
      const at = await $.clock.now()
      // A task keeps the start the board already knew (its own call, or an earlier Stop); one it never saw starts
      // "no later than now".
      const known = (id: string) => stopTasks?.get(id) ?? tracked.get(id)
      const fresh = new Map<string, Tracked>()
      for (const x of e.background_tasks) {
        const was = known(x.id)
        fresh.set(x.id, task(x.type, taskWhat(x), kindOf(x.type), was?.since ?? at, was?.isExact ?? false, x.type === 'subagent' ? x.id : undefined))
      }
      for (const c of e.session_crons ?? []) {
        const was = known(`cron-${c.id}`)
        if (!c.recurring) fresh.set(`cron-${c.id}`, task('wake-up', short(c.prompt, 50), 'wake-up', was?.since ?? at, was?.isExact ?? false))
      }
      stopTasks = fresh
      stopAt = at
    } else stopTasks = undefined
    stopSeenThisTurn = true
    void refreshGuard(guardIo($)).catch(() => undefined)
    // turn.complete may have come first: settle again.
    if (!isTurnRunning && (phase === 'replied' || phase === 'background')) {
      settleTurnEnd()
      const t = await $.clock.now()
      derive(t)
      pushLive($)
      await flush($)
    }
    return r
  }).catch(($, e, next) => next(e))

  on('classic.SubagentStop', async ($, e, next) => {
    for (const [k, c] of calls) if (c.agentId === e.agent_id) calls.delete(k)
    const a = agents.get(e.agent_id)
    if (a && a.status === 'running') {
      const t = await $.clock.now()
      agents.set(a.id, { ...a, status: 'done', activity: undefined, endedAt: t })
      // A finished background agent leaves the background lists at once, not at its report.
      dropTask(a.id)
      derive(t)
      pushLive($)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    // A subagent's run ends in a turn.complete too: that is not this session's turn.
    if (e.agentId !== undefined) {
      const a = agents.get(e.agentId)
      if (a && a.status === 'running') {
        const status = e.isAborted ? 'stopped' : e.reason === 'error' || e.reason === 'refusal' ? 'failed' : 'done'
        const t = await $.clock.now()
        agents.set(a.id, { ...a, status, activity: undefined, endedAt: t })
        dropTask(a.id)
        derive(t)
        pushLive($)
      }
      return next(e)
    }
    if (!me) return next(e)
    const t = await $.clock.now()
    isTurnRunning = false
    for (const [k, c] of calls) if (c.agentId === undefined) calls.delete(k)
    if (e.isAborted) {
      phase = 'stopped'
      mainActivity = 'You stopped it'
    } else if (e.reason === 'error' || e.reason === 'refusal') {
      phase = 'stopped'
      mainActivity = 'Stopped on an error'
    } else {
      // No Stop seen for this turn yet: what the last one said may be out of date.
      if (!stopSeenThisTurn) stopTasks = undefined
      settleTurnEnd()
    }
    const cur = turnRecs[0]
    if (cur && cur.status === 'running') {
      const said = parseSummary(e.answer ?? '')
      turnRecs[0] = {
        ...cur,
        endedAt: t,
        status: e.isAborted ? 'stopped' : e.reason === 'error' || e.reason === 'refusal' ? 'error' : 'answered',
        model: cur.model ?? ownModel,
        ...said,
      }
      await update($, recapAtom, () => ({ turnId: cur.id }))
      refreshTurn()
      logTurn($, turnRecs[0]!)
    }
    derive(t)
    await flush($)
    pushLive($)
    settleTurnFiles($)
    await refreshGuard(guardIo($)).catch(() => undefined)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    guardSessionEnded(e.reason)
    if (me) {
      const t = await $.clock.now()
      me = { ...me, status: 'closed', activity: undefined, tasks: undefined, changedAt: t, seenAt: t }
      phase = 'closed'
      calls.clear()
      isDirty = true
      // session.end has one short bound for every hook; a write that outlasts it is dropped.
      await flush($)
      // /clear and /resume go on in this process under another id: a fresh card follows.
      if (e.reason === 'clear' || e.reason === 'resume') retiredId = me.id
    }
    return next(e)
  })

  // The guard's trigger: the engine pushes the context size after each turn. Git is read here, once per turn.
  on('session.measure', async ($, e, next) => {
    try {
      await guardMeasured(guardIo($), { tokens: e.context.tokens, window: e.context.window, changed: e.changed })
    } catch {
      // never in the way of the measure
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // The prompt box changed: words of yours switch the Actions menu off (and close it).
  on('prompt.edit', async ($, e, next) => {
    await guardTyped(guardIo($), e.text)
    return next(e)
  }).catch(($, e, next) => next(e))

  // A compaction of this conversation: the one you pressed Enter on, the engine's own late one, or a precompute.
  // Nothing in this mod starts one. A /compact you press Enter on is never changed (a bare one is plain, the words
  // after it are yours); the engine's own late compaction and a precompute are told what to keep (the recipe).
  on('session.compact', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    let told = e
    try {
      const text = await compactionNotes(guardIo($), e)
      if (text !== undefined) told = { ...e, instructions: text }
    } catch {
      // compact with what was asked
    }
    const shown = e.trigger !== 'precompute'
    if (shown) await guardCompacting(guardIo($)).catch(() => undefined)
    let r: Awaited<ReturnType<typeof next>>
    try {
      r = await next(told)
    } catch (err) {
      if (shown) await guardCompactFailed(guardIo($), String((err as { message?: unknown })?.message ?? err)).catch(() => undefined)
      throw err
    }
    if (shown) {
      try {
        if ('skip' in r && r.skip !== undefined) await guardCompactFailed(guardIo($), String(r.skip))
        else await guardCompacted(guardIo($), r, e.trigger, e.messages)
      } catch {
        // the compaction stands
      }
    }
    return r
  }).catch(($, e, next) => next(e))

  // The strip above the prompt: this session as a coloured pill, then one pill
  // per folder whose sessions need you (yellow) or replied (green), and a link
  // to the panel. Shown only when there is an alert; whatever else is drawn
  // there stays, beneath it.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const a = await read($, alerts)
    const l = await read($, liveAtom)
    const running = l.agents.filter(x => x.status === 'running').length
    // This session's own row: only while it works, and only with something to say.
    const hasLive = l.isWorking && ((l.showProgress && l.progress !== null) || running > 0 || l.turnFiles > 0)
    const q = a.quiet ?? { working: 0, waiting: 0, idle: 0 }
    const quietN = q.working + q.waiting + q.idle
    // Shown whenever another session is open: alerts as pills, the rest as dim counts.
    const hasOthers = a.needs.length > 0 || a.replied.length > 0 || quietN > 0
    // This session's background work still running: shown only when there is any.
    // A background job, monitor or agent opens the strip on its own, while a turn runs too (since 0.29.0; before it, a
    // lone shell never did). A one-shot wake-up alone does not: it waits, it does not run. The chip counts what the
    // "Waiting on …" label names, so the two always agree.
    const bgAgents = l.agents.filter(x => x.status === 'running' && x.background === true).length
    // Running background agents beyond the ones the list holds as agents are ones the last Stop did not list: they add
    // to the list's count, so a listed job never hides one (by count, not id, like the larger-of-two this replaced).
    const bgN = l.bg + Math.max(0, bgAgents - (l.bgKinds.agent ?? 0))
    const rows = l.bgRows ?? []
    const hasAlerts = hasOthers || bgAgents > 0 || rows.some(x => x.kind !== 'wake-up')
    // The chip's time: read the refresh clock only when there is work to time, so an idle strip is not redrawn.
    const oldest = rows.length > 0 ? oldestRun(rows, await read($, now)) : undefined
    // The recap after a turn: only when it flagged a check or assumptions wait for you.
    const rc = await read($, recapAtom)
    const review = await read($, reviewAtom)
    const recs = rc && !l.isWorking ? await read($, turnsAtom) : []
    const rec = rc ? recs.find(r => r.id === rc.turnId) : undefined
    const hasRecap = rec !== undefined && (rec.check !== undefined || review.open > 0)
    const g = await read($, guardAtom)
    const hasGuard = g.chip !== 'none' || g.phase !== 'idle'
    if ((!hasAlerts && !hasLive && !hasRecap && !hasGuard) || e.props.hasSurvey) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const liveRow = hasLive ? liveStrip($, e.props.bodyColumns, l, running, { Box, Text, Button }) : null
    const recapEl = hasRecap && rec ? recapStrip(rec, review, { Box, Text, Button }) : null
    const guardEl = hasGuard ? guardRow(guardIo($), e.props.bodyColumns, g, { Box, Text, Button }) : null
    // One empty row between the strip and the context row when they sit directly on each other and the context row
    // opens with a black status chip (compacting, compacted, failed, stopped): the two rows of chips would otherwise
    // touch and read as one slab. The quiet and advice rows open with the plain Actions button and need no gap.
    const spacer = (
      <Box key="sb-spacer">
        <Text>{' '}</Text>
      </Box>
    )
    if (!hasAlerts && !hasRecap) {
      const beneath = await next(e)
      return (
        <Box flexDirection="column">
          {liveRow}
          {guardEl}
          {!isBlank(beneath) && beneath}
        </Box>
      )
    }
    const own = await read($, self)
    // The row's chips all sit on the same true black. A label is dim plain text; a status is the status colour as bold text.
    // (The CHECK flag and the review chip are not statuses: they keep their loud yellow block.)
    const labelChip = (key: string, text: string) => (
      <Text key={key} color={LABEL_FG} backgroundColor={LABEL_BG}>
        {` ${text} `}
      </Text>
    )
    const statusChip = (key: string, color: string, text: string) => (
      <Text key={key} bold color={color} backgroundColor={LABEL_BG}>
        {` ${text} `}
      </Text>
    )
    const named = (g: { name: string; n: number }) => (g.n > 1 ? `${g.name} ×${g.n}` : g.name)
    // At most three needs-you pills and two replied pills; the rest as a count.
    const needsShown = a.needs.slice(0, 3)
    const needsRest = a.needs.slice(3).reduce((sum, g) => sum + g.n, 0)
    const repliedTotal = a.replied.reduce((sum, g) => sum + g.n, 0)
    const pills = [
      ...needsShown.map((g, i) => statusChip(`sb-n-${i}`, 'yellow', `? ${named(g)}`)),
      ...(needsRest > 0 ? [statusChip('sb-n-more', 'yellow', `? +${needsRest}`)] : []),
      ...(a.replied.length <= 2
        ? a.replied.map((g, i) => statusChip(`sb-r-${i}`, 'green', `✓ ${named(g)}`))
        : [statusChip('sb-r-all', 'green', `✓ ${repliedTotal} done`)]),
    ]
    // The quiet sessions: other live sessions that need nothing from you, counted by what they are doing. Each count is a
    // chip in its status colour and glyph (the same as the status chips use), so nothing in the group is bare text.
    const quietItems: RenderElement[] = []
    if (q.working > 0) quietItems.push(statusChip('sb-q-working', COLOR.working, `${ICON.working}${q.working}`))
    if (q.waiting > 0) quietItems.push(statusChip('sb-q-waiting', COLOR.background, `${ICON.background}${q.waiting}`))
    if (q.idle > 0) quietItems.push(statusChip('sb-q-idle', COLOR.open, `${ICON.open}${q.idle}`))
    // Every item of the group touches the next (no gaps), like the current group's pills do.
    const groupItems = [...pills, ...quietItems]
    const bgEl = bgN > 0 && statusChip('sb-bg', COLOR.background, bgChipText(l.bgKinds, bgN, false, oldest))
    // Files another live session edited too: the last chip of the others group; a press opens the files view.
    const ov = a.overlap && a.overlap.files.length > 0 ? a.overlap : undefined
    const overlapChip = (text: string) =>
      ov && (
        <Button key="sb-overlap" plain onPress={() => void openFiles($)}>
          {statusChip('sb-overlap-chip', 'yellow', text)}
        </Button>
      )
    const ovRest = ov ? ov.names.slice(2).reduce((sum, g) => sum + g.n, 0) : 0
    const ovNames = ov ? [...ov.names.slice(0, 2).map(named), ...(ovRest > 0 ? [`+${ovRest}`] : [])].join(', ') : ''
    const ovWhat = ov ? (ov.files.length === 1 ? baseName(ov.files[0]!.path) : `${ov.files.length} files`) : ''
    // A narrow terminal (a split pane): counts instead of folder names, so the row stays short instead of breaking
    // into one-letter stripes. The same two label chips and the same "│" as the wide row, the status as its glyph only.
    if (e.props.bodyColumns < 60) {
      const needN = a.needs.reduce((n, g) => n + g.n, 0)
      const doneN = a.replied.reduce((n, g) => n + g.n, 0)
      const compact = (
        <Box key="sb-strip" flexWrap="wrap">
          {own !== null && labelChip('sb-current', 'current'.padEnd(FIRST_COL))}
          {own !== null && statusChip('sb-self', COLOR[own.status as BoardStatus] ?? 'gray', `${ICON[own.status as BoardStatus] ?? ''}`)}
          {bgN > 0 && statusChip('sb-bg', COLOR.background, bgChipText(l.bgKinds, bgN, true))}
          {own !== null && hasOthers && <Text dimColor>{' │ '}</Text>}
          {hasOthers && (
            <Text key="sb-others">
              {labelChip('sb-others-label', 'others')}
              {needN > 0 && statusChip('sb-n-all', 'yellow', `?${needN}`)}
              {doneN > 0 && statusChip('sb-r-all', 'green', `✓${doneN}`)}
              {quietItems}
            </Text>
          )}
          {overlapChip(`⚠${ov?.files.length ?? 0}`)}
          <Text>{'  '}</Text>
          <Button key="sb-strip-open" plain onPress={() => $.ui.open({ id: PANE, title: 'Sessions', closeOnEscape: true })}>
            <Text color={LINK}>☰ All ›</Text>
          </Button>
        </Box>
      )
      const beneath = await next(e)
      return (
        <Box flexDirection="column">
          {compact}
          {recapEl && <Box key="sb-recap-row" flexWrap="wrap">{recapEl}</Box>}
          {liveRow}
          {guardEl && guardOpensWithChip(g) && !recapEl && !liveRow && spacer}
          {guardEl}
          {!isBlank(beneath) && beneath}
        </Box>
      )
    }
    // One flowing row: the "current" chip with the session's status chip touching it, what to check (its flag
    // touches the chip too), then a "│", the "others" chip with its status chips, then the link. The "│" is the first thing
    // of the others group, so it moves with it when the row is full and the group starts a new row.
    // Chips inside a group touch: the gap that is left is the one between the groups.
    const lead = own !== null || recapEl !== null
    const mine = (
      <Box key="sb-strip" flexWrap="wrap">
        {own !== null && labelChip('sb-current', 'current'.padEnd(FIRST_COL))}
        {own !== null && statusChip('sb-self', COLOR[own.status as BoardStatus] ?? 'gray', `${ICON[own.status as BoardStatus] ?? ''} ${own.text}`)}
        {bgEl}
        {recapEl}
        {lead && hasOthers && <Text>{' '}</Text>}
        {hasOthers && (
          <Text key="sb-others">
            {lead && <Text dimColor>{'│ '}</Text>}
            {labelChip('sb-others-label', 'others')}
            {groupItems}
          </Text>
        )}
        {overlapChip(`⚠ ${ovWhat} · ${ovNames}`)}
        <Text>   </Text>
        <Button key="sb-strip-open" plain onPress={() => $.ui.open({ id: PANE, title: 'Sessions', closeOnEscape: true })}>
          <Text color={LINK}>☰ All ›</Text>
        </Button>
      </Box>
    )
    const beneath = await next(e)
    return (
      <Box flexDirection="column">
        {mine}
        {liveRow}
        {guardEl && guardOpensWithChip(g) && !liveRow && spacer}
        {guardEl}
        {!isBlank(beneath) && beneath}
      </Box>
    )
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const cards = await read($, board)
    const t = await read($, now)
    const width = Math.max(24, e.props.bodyColumns - 4)
    const fv = await read($, filesView)
    const l = await read($, liveAtom)
    const recs = await read($, turnsAtom)
    const tabs = tabBar($, fv.view, recs.length, l.turnFiles, { Box, Text, Button })
    if (fv.view === 'context') {
      const g = await read($, guardAtom)
      return (
        <Box flexDirection="column">
          {tabs}
          {contextPane(guardIo($), g, t, width, { Box, Text, Button })}
        </Box>
      )
    }
    if (fv.view === 'files') {
      const also = new Map(((await read($, alerts)).overlap?.files ?? []).map(f => [f.key, grouped(f.with)]))
      return (
        <Box flexDirection="column">
          {tabs}
          {filesPane($, fv, t, width, also, { Box, Text, Button })}
        </Box>
      )
    }
    if (fv.view === 'turns') {
      const expanded = await read($, expandedAtom)
      return (
        <Box flexDirection="column">
          {tabs}
          {turnsPane($, recs, t, width, expanded, l, await read($, journalAtom), { Box, Text, Button })}
        </Box>
      )
    }
    const ownId = me?.id
    const ownFolder = folderKey(me?.folder ?? '')
    const isEnded = (c: BoardEntry) => c.status === 'closed' || c.status === 'gone'
    const pill = (key: string, color: string, text: string, ink = 'black') => (
      <Text key={key} bold color={ink} backgroundColor={color}>
        {` ${text} `}
      </Text>
    )

    // A card: a coloured edge for its state, your prompt in quotes, what it does now.
    const card = (c: BoardEntry) => {
      const color = COLOR[c.status]
      const ended = isEnded(c)
      const edge = <Text color={color}>▌ </Text>
      return (
        <Box key={`sb-${c.id}`} flexDirection="column" marginTop={1}>
          <Text>
            {edge}
            <Text bold={!ended} color={ended ? undefined : color} dimColor={ended}>
              {ICON[c.status]} {label(c)}
            </Text>
            <Text dimColor>
              {'   '}
              {ago(t - c.changedAt)}
              {c.id === ownId ? ' · you' : ''}
            </Text>
          </Text>
          {c.asked !== '' && (
            <Text>
              {edge}
              <Text italic dimColor={ended}>
                “{short(c.asked, width - 6)}”
              </Text>
            </Text>
          )}
          {c.progress && !ended && (
            <Text>
              {edge}
              {(() => {
                const [filled, empty] = barCells(c.progress.done, c.progress.total, 10)
                return (
                  <Text>
                    <Text color={color}>{'▰'.repeat(filled)}</Text>
                    <Text dimColor>{'▱'.repeat(empty)}</Text>
                    <Text dimColor>{` ${c.progress.done}/${c.progress.total} tasks`}</Text>
                  </Text>
                )
              })()}
            </Text>
          )}
          {/* Waiting on background work: each task with how long it has run (cards from 0.29.0 on carry the times). */}
          {c.activity && !ended && (
            <Text>
              {edge}
              <Text color={c.status === 'needs-you' ? 'yellow' : undefined} dimColor={c.status !== 'needs-you'}>
                → {short(c.status === 'background' && c.bg ? c.bg.map(x => `${x.label} (${ranFor(x, t)})`).join(' · ') : c.activity, width - 6)}
              </Text>
            </Text>
          )}
        </Box>
      )
    }

    const live = cards.filter(c => !isEnded(c))
    const ended = cards.filter(isEnded)
    const showAll = await read($, showEnded)
    const here = live.filter(c => folderKey(c.folder) === ownFolder)
    const elsewhere = live.filter(c => folderKey(c.folder) !== ownFolder)
    // Other folders, grouped, the group with the most urgent session first (cards are sorted).
    const groups = new Map<string, BoardEntry[]>()
    for (const c of elsewhere) {
      const key = folderKey(c.folder)
      groups.set(key, [...(groups.get(key) ?? []), c])
    }
    // Summary counts across every live session, this one included.
    const counts = (['needs-you', 'working', 'replied', 'background'] as const)
      .map(st => [st, live.filter(c => c.status === st).length] as const)
      .filter(([, n]) => n > 0)

    return (
      <Box flexDirection="column">
        {tabs}
        {counts.length > 0 && (
          <Text>
            {counts.map(([st, n], i) => (
              <Text key={`sb-count-${st}`}>
                {i > 0 ? ' ' : ''}
                {pill(`sb-count-pill-${st}`, COLOR[st], `${ICON[st]}${n}`)}
              </Text>
            ))}
          </Text>
        )}
        {thisSession($, l, t, width, { Box, Text, Button })}
        <Box marginTop={1}>
          {pill('sb-here', 'blue', 'THIS FOLDER')}
          <Text dimColor>
            {'  '}
            {short(me?.project ?? '', width - 20)} · {here.length}
          </Text>
        </Box>
        {here.map(card)}
        <Box marginTop={1}>{pill('sb-elsewhere', 'gray', 'OTHER FOLDERS', 'white')}</Box>
        {groups.size === 0 && <Text dimColor>No sessions in other folders.</Text>}
        {[...groups.values()].map(list => (
          <Box key={`sb-group-${list[0]!.id}`} flexDirection="column" marginTop={1}>
            <Text bold>{short(folderLabel(list[0]!.folder, list[0]!.project, cards), width)}</Text>
            {list.map(card)}
          </Box>
        ))}
        {ended.length > 0 && (
          <Box marginTop={1}>
            <Button key="sb-toggle-ended" plain onPress={() => update($, showEnded, v => !v)}>
              <Text dimColor>
                {showAll ? '▾' : '▸'} Ended {ended.length}
              </Text>
            </Button>
          </Box>
        )}
        {showAll && ended.map(card)}
      </Box>
    )
  })
}
