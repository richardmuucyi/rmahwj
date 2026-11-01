/**
 * open: started (or resumed), nothing asked in it since (never counted)
 * working: a main-loop turn is running
 * needs-you: a permission dialog or a question box is open (a fact from classic.PermissionRequest
 *   with no hook deciding it, or an AskUserQuestion call in flight)
 * background: the turn ended, but the session holds background work in flight (shells, subagents,
 *   monitors, a one-shot wake-up) that will start its next turn by itself. Not your turn.
 * replied: the turn ended with an answer and nothing is in flight, your turn
 * stopped: interrupted or an error
 * gone: no heartbeat (closed, crashed or asleep) · closed: the session ended
 */
export type BoardStatus = 'open' | 'working' | 'needs-you' | 'background' | 'replied' | 'stopped' | 'gone' | 'closed'

/** What kind of background work a task is: a background shell is a job. */
export type TaskKind = 'job' | 'agent' | 'monitor' | 'wake-up' | 'task'

/** One piece of background work on a card: the engine's own id (its report names it), and when it started. `isExact`
 *  is false where the start is only when a Stop first listed it, so it may have started earlier ("≥"). */
export type CardTask = { id: string; label: string; what: string; kind: TaskKind; since: number; isExact: boolean }

/** One row of the panel's BACKGROUND section, oldest first. */
export type BgRow = { id: string; kind: TaskKind; what: string; since: number; isExact: boolean }

/** One session's card, as each session writes it to the shared folder. */
export type BoardEntry = {
  /** Card format; 2 adds `background` and `tasks`, 3 adds `progress`, 4 adds `bg`, 5 adds `edits`. */
  v?: number
  id: string
  /** The project folder, full path. */
  folder: string
  /** The project folder's name. */
  project: string
  /** Your latest prompt in that session, shortened. */
  asked: string
  status: BoardStatus
  /** What it is doing now, or what it needs from you. Facts from tool calls only. */
  activity?: string
  /** The background work in flight when the last turn ended, one short label each. */
  tasks?: string[]
  /** The background work in flight now, in any state, with ids and start times: the panel shows how long each has run,
   *  and a reload restores them from it. Older versions ignore it. */
  bg?: CardTask[]
  /** The session's task list: items done of all items (Claude's own task list). */
  progress?: { done: number; total: number }
  /** The files Claude edited in this session (its own Write/Edit calls, subagents too), as folderKey spellings, newest
   *  last, the 200 newest: two sessions that list one file both edited it. */
  edits?: string[]
  /** Epoch ms of the last status change. */
  changedAt: number
  /** Epoch ms of the last heartbeat. */
  seenAt: number
}

/** One subagent of this session, from its spawn, its steps and its tool calls. */
export type AgentRow = {
  id: string
  /** The agent type (`Explore`, `general-purpose`, a plugin's agent). */
  type: string
  /** The Agent call's short description of the task. */
  description: string
  /** The model it runs on: resolved at spawn, then as each of its steps names it. */
  model?: string
  status: 'running' | 'done' | 'failed' | 'stopped'
  /** Spawned to run in the background (the turn does not wait for it). */
  background?: boolean
  /** What it is doing now, from its own latest tool call. */
  activity?: string
  startedAt: number
  endedAt?: number
}

export type FileKind = 'added' | 'modified' | 'deleted' | 'renamed'

/** One changed file, as the files view lists it. */
export type FileRow = {
  key: string
  /** Relative to the session's folder where inside it. */
  path: string
  kind: FileKind
  /** Lines added and removed, where known. */
  plus?: number
  minus?: number
  /** A rename's old path. */
  from?: string
  /** Where the fact comes from: Claude's own Write/Edit calls, or git status. */
  by: 'claude' | 'git'
}

export type ToolKind = 'read' | 'edit' | 'shell' | 'test' | 'other'

/** One turn of this session, as the Turns tab shows it. */
export type TurnRecord = {
  id: string
  startedAt: number
  endedAt?: number
  status: 'running' | 'answered' | 'stopped' | 'error'
  model?: string
  /** Claude's own one-line summary ("Turn: …"), and what it asks you to verify ("· check: …"). */
  summary?: string
  check?: string
  /** What the turn taught ("· lesson: …"), for the day journal; asked for only with the journal setting on. */
  lesson?: string
  files: { added: number; modified: number; deleted: number; renamed: number; top: FileRow[] }
  tools: Partial<Record<ToolKind, number>>
  toolTotal: number
  agents: { id: string; type: string; model?: string; status: AgentRow['status']; startedAt: number; endedAt?: number }[]
  assumptions: { text: string; impact?: 'high' | 'low' }[]
  /** True once its line is in the journal log (journal setting on). */
  logged?: boolean
}

/** One compaction the guard knows of, newest first in the Context tab. */
export type GuardCompaction = {
  at: number
  before: number
  after?: number
  /** Who compacted, as the engine names the trigger: manual (you pressed Enter on a /compact), auto (the engine at its limit) or plugin. */
  via: string
  /** How many of the file names, ports, post ids, study numbers and hashes the old context held the new summary kept. */
  recall?: { found: number; total: number; missing: string[] }
}

/** The context guard, as the strip's chip and the Context tab draw it. Chip and decision rules: hooks/guard.ts. */
export type GuardView = {
  chip: 'none' | 'dim' | 'advise' | 'stopped'
  grade?: 'good' | 'ok'
  /** Why the chip is dim or stopped: growth, cooldown, no-shrink. */
  reason?: string
  /** Dollars saved per later request if it compacted now. */
  saving: number
  /** Tokens in the context at the last measure. */
  ctx: number
  window: number
  mode: 'off' | 'advise'
  phase: 'idle' | 'compacting' | 'done' | 'failed'
  done?: { before: number; after: number; saving: number; recall?: number }
  failed?: string
  jobs: number
  /** The context at each turn end (the last 60), for the sparkline. */
  series: number[]
  history: GuardCompaction[]
  adviseAt: number
  floor: number
  /** True when ~/.claude/session-board/compact-instructions.md holds your own text. */
  hasFile: boolean
  /** Today's pilot log, every session's files: decisions logged, how many had the buttons on offer, the saving per request summed over those. Undefined until read. */
  today?: { logged: number; advised: number; saving: number }
  /** The picker in the Context tab is open. */
  pickOpen: boolean
  /** Which picker rows are ticked. */
  picks: Record<'notes' | 'lean' | 'tasks' | 'files' | 'jobs' | 'assumptions', boolean>
  /** What the board offers to keep: open items of the session's task list, its uncommitted files, running jobs, open assumptions (a count). */
  facts: { tasks: string[]; files: string[]; jobs: string[]; assumptions: number; high: number }
  /** The command the picker would type into the prompt box. */
  command: string
  /** The prompt box holds words of yours, so the Actions menu is drawn off. */
  boxHolds: boolean
  /** The Actions menu under the chip is open: Compact…, Plain compact and Clear, each of which only types. */
  menuOpen: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'session-board': {
      board: BoardEntry[]
      now: number
      /** The strip above the prompt: other sessions that need you or replied, one entry per folder. */
      alerts: {
        needs: { name: string; n: number }[]
        replied: { name: string; n: number }[]
        /** Other live sessions that are not alerts: counts only, for the strip's tail. */
        quiet?: { working: number; waiting: number; idle: number }
        /** Files this session and another live one both edited, still uncommitted where git tracks them. `path` as the
         *  files view shows it; `with` the other sessions' folder labels, one per session. `names` groups every session
         *  across the files by label ("vault ×2"), which `with` alone cannot do: two sessions may share a label. */
        overlap?: { files: { key: string; path: string; with: string[] }[]; names: { name: string; n: number }[] }
      }
      /** This session's own state, for the strip's pill. */
      self: { status: string; text: string } | null
      /** Whether the panel lists ended sessions too. */
      showEnded: boolean
      /** This session's live detail: model, task progress, subagents, files changed this turn. */
      live: {
        isWorking: boolean
        model?: string
        progress: { done: number; total: number; now?: string } | null
        /** Whether the bar is worth showing: items left, or the list changed this turn. */
        showProgress: boolean
        agents: AgentRow[]
        turnFiles: number
        /** This session's background work still running, while a turn runs too: the count the "Waiting on …" label names. */
        bg: number
        /** The same, by kind, for the ◈ chip: background jobs (shells), agents, monitors, wake-ups, other tasks. */
        bgKinds: Partial<Record<TaskKind, number>>
        /** The same, one row each with its start, oldest first: the panel's BACKGROUND section and the chip's time. */
        bgRows: BgRow[]
      }
      /** Turns logged today across all sessions; null when the journal setting is off. */
      journal: { today: number } | null
      /** This session's turns, newest first (the last 20). */
      turns: TurnRecord[]
      /** The turn whose full card is open in the Turns tab's history. */
      expanded: string | null
      /** Assumptions still open in this session, as the assumptions mod reports them. */
      review: { open: number; high: number }
      /** The recap row after a turn: shown when it flagged a check or assumptions wait for review. */
      recap: { turnId: string } | null
      /** The context guard: the chip above the prompt and the Context tab. */
      guard: GuardView
      /** The panel's tab, and the files view. */
      files: {
        view: 'board' | 'turns' | 'files' | 'context'
        scope: 'turn' | 'session'
        list: FileRow[]
        /** null: not a git folder (only Claude's own edits are listed); undefined: not checked yet. */
        isGit?: boolean | null
        checkedAt?: number
        isLoading: boolean
        /** Folders whose fold state the person flipped from its default. */
        toggled?: string[]
        /** The file whose diff is shown, and its lines. */
        open: { key: string; lines: string[]; more: number; note?: string } | null
      }
    }
  }
}
