/** One usage limit window as the session reports it. */
export type Limit = {
  pct: number
  resetsAt?: string
  /** An estimate, drawn with a "~". */
  approx?: boolean
  /** Tokens held, drawn after the percent (the context meter only). */
  tokens?: number
}

/** The repository the session sits in, as `git status` and the last fetch left it. */
export type Git = {
  /** The branch's name; for a detached HEAD, the commit's short hash. Empty: git did not say. */
  branch: string
  /** HEAD is on a commit, not on a branch. */
  detached?: boolean
  /** The branch tracks a remote branch: ahead and behind mean something. */
  upstream: boolean
  /** Commits here that the remote branch lacks. */
  ahead: number
  /** Commits on the remote branch that are not here, as of the last fetch. */
  behind: number
  /** Tracked files staged or modified; a conflicted file is counted in `conflicts`, not here. */
  changed: number
  /** Files with an unresolved merge conflict. */
  conflicts: number
  /** Files git neither tracks nor ignores; a folder of them counts as one. */
  untracked: number
  /** The last fetch failed: `behind` is old news, drawn as a question mark. */
  stale?: boolean
}

/**
 * Where the session runs, against its root (where it started, or where `/cd` took it), as names. `root` is the root's
 * last name, or, outside the root, the current folder's own last name. `here` is the current folder's last name, only
 * under the root.
 */
export type Folder = { place: 'root' | 'under' | 'outside'; root: string; here?: string }

/** Everything the two rows draw. */
export type Gauge = {
  /** The main loop's model and effort, as its latest request named them. */
  model?: string
  effort?: string
  /**
   * What the person had selected (/model, /effort, env and settings) when the latest main request went out. A model or
   * effort the request did not send is drawn on its chip in the theme's warning colour. `effort` is absent when none was
   * set or the request sent none.
   */
  selected?: { model?: string; effort?: string }
  /**
   * The selection as the latest refresh (every 15 s, at session start, after each turn) read it. When it differs from
   * `selected`, the person picked again since the last request, and the chips show the new pick in their plain colours.
   */
  pick?: { model?: string; effort?: string }
  /**
   * The engine has no figure from a compaction until the next response: `estimated` marks the stand-in, the
   * compaction's own `tokensAfter` plus the overhead from the context breakdown. The engine's real figure replaces it.
   */
  context?: { pct: number; tokens?: number; window: number; estimated?: boolean }
  /**
   * The token count at which auto-compaction runs, read from a summary breakdown once per main turn and at a compaction.
   * The context bar fills toward it. Absent: auto-compaction is off, or no breakdown has said yet.
   */
  compactAt?: number
  fiveHour?: Limit
  weekly?: Limit
  /**
   * A main turn ended with neither window reported: an API key, a cloud provider or a gateway, which has no plan. The two
   * limit meters are not drawn while it holds and no window has turned up since.
   */
  noPlan?: boolean
  /** US dollars so far, API-price equivalent. */
  cost?: number
  startedAt: number
  now: number
  /** Output tokens per second of the latest main-loop reply. */
  tps?: number
  /** The main chat's input over the session (uncached + cache-written + cache-read), and the cache-read part of it. Subagents' requests are not in them. */
  tokensIn: number
  cacheRead: number
  /** A main-loop request has gone out: before it, cost and speed stay hidden. */
  ran?: boolean
  /**
   * When the request that last wrote or read the main conversation's prompt cache was sent (`$.clock.now()`
   * milliseconds). An entry lives from the start of that request. Absent: nothing cached yet, or the entry was
   * dropped by a /clear, a compaction or a switch of model.
   */
  cacheAt?: number
  /** The model that request named: a cache belongs to one model. */
  cacheModel?: string
  /** The lifetime the person chose in env or settings; absent: the plan decides (an hour on a subscription within its usage, else five minutes). */
  ttlChoice?: '5m' | '1h'
  /** Absent: not a repository, or git has not answered yet. */
  git?: Git
  /** Absent: the engine has not said where the session runs yet. */
  folder?: Folder
}

declare module 'claude-code' {
  interface PluginState {
    'usage-gauge': {
      gauge: Gauge
    }
  }
}
