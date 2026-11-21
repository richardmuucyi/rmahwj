import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Assumption, PastCorrection, SessionStats } from '../types'

const PANE = 'assumptions'
const TOOL = 'mcp__assumptions__log_assumption'

const list = atom({ plugin: 'assumptions', key: 'list' } as const, [])
const editing = atom({ plugin: 'assumptions', key: 'editing' } as const, null)
const isWorking = atom({ plugin: 'assumptions', key: 'isWorking' } as const, false)
const nextId = atom({ plugin: 'assumptions', key: 'nextId' } as const, 1)
const showReviewed = atom({ plugin: 'assumptions', key: 'showReviewed' } as const, false)
const steps = atom({ plugin: 'assumptions', key: 'steps' } as const, 0)
// Assumptions removed by Clear history: gone from view, still counted in this session's stats.
const cleared = atom({ plugin: 'assumptions', key: 'cleared' } as const, [])

// Set by session.start: this repo's corrections file, and the corrections read back from earlier sessions.
let sessionId = ''
let repo = ''
let file = ''
let past: PastCorrection[] = []
// The person's latest prompt, so each assumption records which task it was made for.
let task = ''
const PAST_SHOWN = 10
const PAST_KEPT = 100
// Per-session counts for a later usefulness review: never the assumption text.
let statsFile = ''
const STATS_KEPT = 1_000

// After the last open assumption is reviewed, the panel closes after this pause.
const CLOSE_DELAY_MS = 2_000

const GUIDANCE = `## Logging assumptions
While you work, whenever you make a non-trivial assumption the user has not confirmed (about requirements, scope, file or folder locations, formats, naming, defaults, data, or which option they want), call the tool \`${TOOL}\` at once with that assumption in one short sentence, and a few words on why. Then keep working; do not stop to ask. The user reviews the assumptions as they come.
- Set impact to "high" when a wrong guess would be costly to undo (deleting or overwriting data, architecture, money, anything sent to other people); otherwise leave it out.
- Log one assumption per call, when you make it, not in a batch at the end.
- Log the assumption before the tool call that acts on it. Do not log a choice you have already carried out.
- Skip trivial or obvious choices, and anything the user already stated. Do not log a default the user would not question, such as following the repo's existing style.
- If a message arrives that says "Correction to assumption A<n>", follow it: revise the work that depended on that assumption, and say briefly what you changed.`

function short(text: string, n = 60): string {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > n ? `${one.slice(0, n - 1)}…` : one
}

function sentence(text: string): string {
  return text.replace(/[.\s]+$/, '')
}

function guidance(): string {
  if (past.length === 0) return GUIDANCE
  const lines = past.map(
    p => `- Assumed: ${sentence(p.text)}. Correct: ${sentence(p.correction)} (${new Date(p.at).toISOString().slice(0, 10)}${p.task === undefined ? '' : `, task: "${p.task}"`})`,
  )
  return `${GUIDANCE}\n\n## Past corrections in this repo\nThe user corrected these assumptions in earlier sessions. Each fix belonged to the task it was made in, not to the repo as a whole. Apply one only when the current task is the same kind of work; otherwise ignore it:\n${lines.join('\n')}`
}

function verdicts(items: Assumption[]): string | undefined {
  const lines = items.flatMap(a => {
    if (a.status === 'right') return [`- A${a.id} right: ${a.text}`]
    if (a.status !== 'wrong') return []
    return [
      a.correction === undefined
        ? `- A${a.id} wrong (correction sent in chat): ${a.text}`
        : `- A${a.id} wrong: ${sentence(a.text)}. Correct: ${a.correction}`,
    ]
  })
  if (lines.length === 0) return undefined
  return `## Assumption verdicts this session\nThe user reviewed these assumptions. Treat them as settled; do not reopen them:\n${lines.join('\n')}`
}

function readPast(text: string, session: string): PastCorrection[] {
  return text
    .split('\n')
    .flatMap(line => {
      try {
        const p = JSON.parse(line) as PastCorrection
        return typeof p.text === 'string' && typeof p.correction === 'string' && typeof p.at === 'number' ? [p] : []
      } catch {
        return []
      }
    })
    .filter(p => p.session !== session)
    .slice(-PAST_SHOWN)
}

function builtOn(a: Assumption, total: number): string {
  const k = a.stepAt === undefined ? 0 : total - a.stepAt
  return k > 0 ? `built on ${k} step${k === 1 ? '' : 's'}` : ''
}

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  return m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`
}

/** Review order: high impact first, then oldest first. */
function queue(items: Assumption[]): Assumption[] {
  return items
    .filter(a => a.status === 'open')
    .sort((x, y) => Number(y.impact === 'high') - Number(x.impact === 'high') || x.id - y.id)
}

/** The open ones Skip all would close: high-impact ones are never skipped in bulk. */
function skippable(items: Assumption[]): Assumption[] {
  return queue(items).filter(a => a.impact !== 'high')
}

/** Skip all shows only when it would close two or more. */
const SKIP_ALL_MIN = 2

/** Dismiss every open low-impact assumption; the high-impact ones stay on the card. */
async function skipAll($: EngineInterface): Promise<void> {
  await update($, list, all => all.map(a => (a.status === 'open' && a.impact !== 'high' ? { ...a, status: 'dismissed' as const } : a)))
  await closeIfDone($)
}

function stats(items: Assumption[], at: number, session: string): SessionStats {
  const n = (s: Assumption['status']) => items.filter(a => a.status === s).length
  return {
    at,
    session,
    repo,
    logged: items.length,
    right: n('right'),
    wrong: n('wrong'),
    skipped: n('dismissed'),
    open: n('open'),
    high: items.filter(a => a.impact === 'high').length,
  }
}

/** Replace this session's line in the stats file, keeping every other session's. */
async function writeStats($: EngineInterface, line: SessionStats): Promise<void> {
  const old = await $.fs.read(statsFile).catch(() => '')
  const others = old.split('\n').filter(l => {
    if (l.trim() === '') return false
    try {
      return (JSON.parse(l) as SessionStats).session !== line.session
    } catch {
      return false
    }
  })
  await $.fs.write(statsFile, `${[...others, JSON.stringify(line)].slice(-STATS_KEPT).join('\n')}\n`)
}

/** A correction typed into the prompt: the exact pre-filled form, or one whose quoted part was edited or dropped. */
function typedCorrection(text: string): { id: number; fix: string } | undefined {
  const m =
    /^Correction to assumption A(\d+) \(".*"\): ([\s\S]+)$/.exec(text) ??
    /^Correction to assumption A(\d+)\b[^\S\n]*(?:\(.*\))?[^\S\n]*:\s*([\s\S]+)$/.exec(text)
  const fix = m?.[2]?.trim() ?? ''
  return m === null || fix === '' ? undefined : { id: Number(m[1]), fix }
}

/** Mark one assumption reviewed; close the panel shortly after the last one. */
async function mark($: EngineInterface, id: number, status: Assumption['status'], correction?: string): Promise<void> {
  await update($, list, all => all.map(a => (a.id === id ? { ...a, status, correction } : a)))
  await closeIfDone($)
}

/** Close the panel once nothing is left open: a short pause first so the last ✓ or ✗ is seen. */
async function closeIfDone($: EngineInterface): Promise<void> {
  if (queue(await read($, list)).length > 0) return
  $.clock.after(CLOSE_DELAY_MS, () => {
    void (async () => {
      const still = queue(await read($, list)).length
      if (still === 0 && (await read($, editing)) === null) await $.ui.close({ id: PANE })
    })()
  })
}

/** Mark it wrong with the person's correction, and keep it in this repo's file for later sessions. */
async function persist($: EngineInterface, a: Assumption, correction: string): Promise<void> {
  await mark($, a.id, 'wrong', correction)
  if (file === '') return
  try {
    const line: PastCorrection = { at: await $.clock.now(), session: sessionId, repo, id: a.id, text: a.text, why: a.why, task: a.task, correction }
    const old = await $.fs.read(file).catch(() => '')
    const lines = [...old.split('\n').filter(l => l.trim() !== ''), JSON.stringify(line)].slice(-PAST_KEPT)
    await $.fs.write(file, `${lines.join('\n')}\n`)
  } catch {
    // The correction is already recorded and sent; only its memory for later sessions is lost.
  }
}

/** Send a correction to Claude: into the running turn if one runs, else as a new prompt. */
async function sendCorrection($: EngineInterface, a: Assumption, value: string): Promise<void> {
  const fix = value.trim()
  if (fix === '') return
  await update($, editing, () => null)
  await persist($, a, fix)
  const text = `Correction to assumption A${a.id} ("${a.text}"): ${fix}\nPlease adjust the work that depended on it.`
  if (await read($, isWorking)) {
    // Mid-turn: Claude reads it at its next step.
    await $.session.append({ message: { type: 'user', content: [{ type: 'text', text }] } })
    $.ui.toast(`Correction to A${a.id} sent to Claude`)
  } else {
    await $.prompt.submit({ text, asUser: true })
  }
}

/** Start a correction: a field where the surface has one, else the prompt box pre-filled. */
async function startFix($: EngineInterface, a: Assumption, hasInput: boolean): Promise<void> {
  if (hasInput) {
    await update($, editing, () => a.id)
    return
  }
  await mark($, a.id, 'wrong')
  await $.prompt.fill({ text: `Correction to assumption A${a.id} ("${a.text}"): `, mode: 'replace' })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'log_assumption',
      description:
        'Record one assumption you are making while working, so the user can confirm or correct it. Call it the moment you make a non-trivial assumption the user has not confirmed, then carry on.',
      inputSchema: {
        type: 'object',
        properties: {
          assumption: { type: 'string', description: 'The assumption, in one short sentence.' },
          why: { type: 'string', description: 'Optional: a few words on why you assumed it.' },
          impact: {
            type: 'string',
            enum: ['high', 'low'],
            description: '"high" when a wrong guess would be costly to undo; omit otherwise.',
          },
        },
        required: ['assumption'],
      },
      isDeferred: false,
    })
    await $.command.register({
      name: 'assumptions',
      description: 'Show the assumptions Claude made in this session',
    })
    const home = ((await $.env.get('USERPROFILE').catch(() => undefined)) || (await $.env.get('HOME').catch(() => undefined)) || '').replace(/[\\/]$/, '')
    sessionId = await $.session.id().catch(() => '')
    const root = await $.session.root().catch(() => '')
    if (home !== '' && root !== '') {
      const top = await $.process
        .run(['git', 'rev-parse', '--show-toplevel'], { cwd: root })
        .then(r => (r.exitCode === 0 ? r.stdout.trim() : ''), () => '')
      repo = (top || root).replace(/\\/g, '/')
      file = `${home}/.claude/assumptions/${repo.replace(/[^A-Za-z0-9]/g, '-')}.jsonl`
      statsFile = `${home}/.claude/assumptions/stats.jsonl`
      // Read once per start: the guidance section must stay the same for the whole thread.
      past = readPast(await $.fs.read(file).catch(() => ''), sessionId)
    }
    // How many are still open, for session-board's recap chip: a mod cannot
    // read another mod's state, so it goes in a small file beside the board's
    // cards. Written only when the count changes; nothing reaches the model.
    // The same tick keeps this session's line in the stats file, written only when a count changes.
    if (home !== '') {
      let last = ''
      let lastStats = ''
      $.clock.every(2_000, () => {
        void (async () => {
          const all = await read($, list)
          const open = all.filter(a => a.status === 'open')
          const text = JSON.stringify({ open: open.length, high: open.filter(a => a.impact === 'high').length })
          // The id changes on /clear: the count follows the session it belongs to.
          const id = await $.session.id()
          const path = `${home}/.claude/session-board/${id}.assume`
          if (`${path}|${text}` !== last) {
            last = `${path}|${text}`
            await $.fs.write(path, text)
          }
          const counted = [...(await read($, cleared)), ...all]
          if (statsFile === '' || counted.length === 0) return
          const counts = stats(counted, 0, id)
          const key = JSON.stringify(counts)
          if (key === lastStats) return
          lastStats = key
          await writeStats($, { ...counts, at: await $.clock.now() })
        })().catch(() => undefined)
      })
    }
    return next(e)
  })

  // Tell the model to log its assumptions. The verdicts carry the user's reviews past a compaction.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const settled = verdicts(await read($, list))
    return {
      sections: [
        ...composed.sections,
        { id: 'assumptions:guidance', text: guidance(), scope: 'session' as const },
        ...(settled === undefined ? [] : [{ id: 'assumptions:verdicts', text: settled, scope: 'session' as const }]),
      ],
    }
  })

  // Count the work done after each assumption; the assumption tool itself is not a step.
  on('tool.call', async ($, e, next) => {
    if (e.tool === TOOL) return next(e)
    const result = await next(e)
    await update($, steps, n => n + 1)
    return result
  })

  // A correction typed by hand into the prompt that Fix pre-filled (surfaces with no text field).
  on('prompt.submit', async ($, e, next) => {
    const typed = typedCorrection(e.text)
    const a = typed === undefined ? undefined : (await read($, list)).find(x => x.id === typed.id)
    if (a !== undefined && typed !== undefined) await persist($, a, typed.fix)
    else if (!e.text.startsWith('Correction to assumption A') && !e.text.startsWith('/')) task = short(e.text)
    return next(e)
  })

  // The tool itself: store the assumption and answer at once.
  on('tool.call', { tool: TOOL }, async ($, e) => {
    // Arguments sit beside `tool` on the event (older callers nest them under `input`).
    const raw = e as unknown as Record<string, unknown>
    const input = (
      typeof raw.assumption === 'string' ? raw : ((raw.input as Record<string, unknown> | undefined) ?? {})
    ) as { assumption?: unknown; why?: unknown; impact?: unknown }
    const text = typeof input.assumption === 'string' ? input.assumption.trim() : ''
    if (text === '') return { deny: 'assumption is required' }
    const why = typeof input.why === 'string' && input.why.trim() !== '' ? input.why.trim() : undefined
    const impact = input.impact === 'high' ? ('high' as const) : ('low' as const)

    let id = 0
    await update($, nextId, n => {
      id = n
      return n + 1
    })
    const one: Assumption = { id, text, why, impact, status: 'open', at: await $.clock.now(), stepAt: await read($, steps), task: task === '' ? undefined : task }
    await update($, list, items => [...items, one])
    return { result: `Logged as A${id}. Carry on; the user will send a correction if it is wrong.` }
  })

  // Subagents' turns start and end inside the main turn: only the main loop says whether Claude is working.
  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    await update($, isWorking, () => true)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    await update($, isWorking, () => false)
    return next(e)
  })

  on('command.run', { command: 'assumptions' }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: 'Assumptions', closeOnEscape: true })
    const items = await read($, list)
    if (items.length === 0) return { text: 'No assumptions logged yet in this session.' }
    return {
      text: opened.isPlaced ? `Assumptions panel opened (${items.length} logged).` : 'Widen the window to see the assumptions panel.',
    }
  })

  // The card above the prompt: one assumption at a time, answered in place.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const items = await read($, list)
    const open = queue(items)
    if (open.length === 0 || e.props.hasSurvey) return next(e)
    const els = $.ui.resolve(e)
    const { Box, Button, Text } = els
    // The mobile app draws no text field, whatever the element table holds: there, Fix pre-fills the prompt.
    const Input = e.surface !== 'mobile' && 'Input' in els ? els.Input : undefined
    const cur = open[0]!
    const hot = cur.impact === 'high'
    const edit = await read($, editing)
    const t = await $.clock.now()
    const isFixing = edit === cur.id && Input !== undefined
    const accent = hot ? 'yellow' : 'gray'
    const built = builtOn(cur, await read($, steps))

    const header = (
      <Box key="as-card-head">
        <Text bold color="black" backgroundColor={accent}>
          {` ${hot ? '⚠ ' : ''}${isFixing ? 'FIXING' : 'ASSUMPTION'} 1/${open.length} `}
        </Text>
        <Text dimColor>
          {'  '}
          {hot ? 'high impact · ' : ''}
          {cur.at !== undefined ? ago(t - cur.at) : `A${cur.id}`}
          {built !== '' && ` · ${built}`}
        </Text>
      </Box>
    )

    const body = isFixing ? (
      <Box key="as-card-fixing" flexDirection="column">
        <Text dimColor>{cur.text}</Text>
        <Input
          key="as-card-fix-input"
          label="It should be: "
          placeholder="tell Claude what's right"
          submitLabel="send"
          autoFocus
          onSubmit={(value: string) => sendCorrection($, cur, value)}
        />
        <Box>
          <Button key="as-card-cancel" label="Cancel" onPress={() => update($, editing, () => null)} />
        </Box>
      </Box>
    ) : (() => {
      const skipN = skippable(items).length
      const actions = (
        <Box key="as-card-acts" flexShrink={0}>
          <Button key="as-card-right" label="✓ Right" hotkey="y" variant="primary" onPress={() => mark($, cur.id, 'right')} />
          <Text>  </Text>
          <Button key="as-card-fix" label="✗ Fix" hotkey="n" onPress={() => startFix($, cur, Input !== undefined)} />
          <Text>  </Text>
          <Button key="as-card-skip" label="Skip" hotkey="s" onPress={() => mark($, cur.id, 'dismissed')} />
          {skipN >= SKIP_ALL_MIN && <Text>  </Text>}
          {skipN >= SKIP_ALL_MIN && (
            <Button key="as-card-skip-all" label={`Skip all ${skipN}`} hotkey="a" onPress={() => skipAll($)} />
          )}
          <Text>    </Text>
          <Button
            key="as-open"
            plain
            onPress={() => $.ui.open({ id: PANE, title: 'Assumptions', closeOnEscape: true })}
          >
            <Text color="blue">all {open.length} ›</Text>
          </Button>
        </Box>
      )
      // Low impact: one compact line, no reason shown. The text wraps rather than being cut, so it can still be judged.
      if (!hot) {
        return (
          <Box key="as-card-body">
            <Box key="as-card-text" flexShrink={1} marginRight={2}>
              <Text bold wrap="wrap">{cur.text}</Text>
            </Box>
            {actions}
          </Box>
        )
      }
      return (
        <Box key="as-card-body" flexDirection="column">
          <Text bold>{cur.text}</Text>
          {cur.why !== undefined && (
            <Text dimColor italic>
              why: {cur.why}
            </Text>
          )}
          <Box marginTop={1}>{actions}</Box>
        </Box>
      )
    })()

    // The band is one row per plugin, and this hook answers only this mod's row: other mods' strips are rows of
    // their own. What `next(e)` holds for this row is the engine's own drawing, a node a hook cannot look into,
    // so the card stands in its place.
    return (
      <Box key="as-card" flexDirection="column" borderStyle="round" borderColor={accent} paddingX={1}>
        {header}
        {body}
      </Box>
    )
  })

  // The panel: a timeline of every assumption, to review in bulk or look back.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Button, Text } = els
    // The mobile app draws no text field, whatever the element table holds: there, Fix pre-fills the prompt.
    const Input = e.surface !== 'mobile' && 'Input' in els ? els.Input : undefined
    const items = await read($, list)
    const edit = await read($, editing)

    if (items.length === 0) {
      return (
        <Box flexDirection="column">
          <Text dimColor>No assumptions logged yet.</Text>
          <Text dimColor>Claude adds one here each time it assumes something while working.</Text>
        </Box>
      )
    }

    const open = queue(items)
    const reviewed = items.filter(a => a.status !== 'open').reverse()
    const showAll = await read($, showReviewed)
    const total = await read($, steps)

    const openRow = (a: Assumption) => {
      const hot = a.impact === 'high'
      return (
        <Box key={`as-row-${a.id}`} flexDirection="column" marginTop={1}>
          <Text>
            <Text color={hot ? 'yellow' : undefined}>● </Text>
            <Text bold>
              A{a.id}  {a.text}
            </Text>
            {hot && <Text color="yellow">   ⚠ high</Text>}
            {builtOn(a, total) !== '' && <Text dimColor>   · {builtOn(a, total)}</Text>}
          </Text>
          {a.why !== undefined && (
            <Text>
              <Text dimColor>│   </Text>
              <Text dimColor italic>
                why: {a.why}
              </Text>
            </Text>
          )}
          {edit === a.id && Input !== undefined ? (
            <Box key={`as-fixing-${a.id}`} flexDirection="column">
              <Input
                key={`as-fix-${a.id}`}
                label="│   It should be: "
                placeholder="tell Claude what's right, then Enter"
                submitLabel="send"
                autoFocus
                onSubmit={(value: string) => sendCorrection($, a, value)}
              />
              <Box>
                <Text dimColor>│   </Text>
                <Button key={`as-cancel-${a.id}`} label="Cancel" onPress={() => update($, editing, () => null)} />
              </Box>
            </Box>
          ) : (
            <Box key={`as-acts-${a.id}`}>
              <Text dimColor>│   </Text>
              <Button key={`as-right-${a.id}`} label="✓ Right" variant="primary" onPress={() => mark($, a.id, 'right')} />
              <Text>  </Text>
              <Button key={`as-wrong-${a.id}`} label="✗ Fix…" onPress={() => startFix($, a, Input !== undefined)} />
            </Box>
          )}
        </Box>
      )
    }

    const reviewedRow = (a: Assumption) => {
      const color = a.status === 'right' ? 'green' : a.status === 'wrong' ? 'red' : 'gray'
      const tag = a.status === 'right' ? '   ✓ right' : a.status === 'wrong' ? '   ✗ fixed' : '   – skipped'
      return (
      <Box key={`as-row-${a.id}`} flexDirection="column">
        <Text>
          <Text color={color}>● </Text>
          <Text dimColor>
            A{a.id}  {a.text}
          </Text>
          <Text color={color} dimColor={a.status === 'dismissed'}>{tag}</Text>
        </Text>
        {a.status === 'dismissed' && (
          <Box key={`as-reopen-row-${a.id}`}>
            <Text dimColor>│   </Text>
            <Button
              key={`as-reopen-${a.id}`}
              label="Reopen"
              onPress={() => update($, list, all => all.map(x => (x.id === a.id ? { ...x, status: 'open' as const } : x)))}
            />
          </Box>
        )}
        {a.correction !== undefined && (
          <Text>
            <Text dimColor>│   </Text>
            <Text color="green">→ {a.correction}</Text>
          </Text>
        )}
      </Box>
      )
    }
    const skipN = skippable(items).length

    return (
      <Box flexDirection="column">
        <Text>
          <Text bold color="black" backgroundColor={open.length > 0 ? 'yellow' : 'gray'}>
            {` TO REVIEW ${open.length} `}
          </Text>
        </Text>
        {open.length === 0 && <Text dimColor>All reviewed.</Text>}
        {open.map(openRow)}
        {reviewed.length > 0 && (
          <Box marginTop={1}>
            <Button key="as-toggle-reviewed" plain onPress={() => update($, showReviewed, v => !v)}>
              <Text bold color="white" backgroundColor="gray">
                {` REVIEWED ${reviewed.length} `}
              </Text>
              <Text dimColor> {showAll ? '▾ hide' : '▸ show'}</Text>
            </Button>
          </Box>
        )}
        {showAll && reviewed.map(reviewedRow)}
        <Box marginTop={1}>
          <Text dimColor>⋯  </Text>
          {open.length > 0 && (
            <Button
              key="as-all-right"
              plain
              onPress={async () => {
                await update($, list, all => all.map(a => (a.status === 'open' ? { ...a, status: 'right' as const } : a)))
                await closeIfDone($)
              }}
            >
              <Text dimColor>Mark all right</Text>
            </Button>
          )}
          {skipN >= SKIP_ALL_MIN && <Text dimColor>   ·   </Text>}
          {skipN >= SKIP_ALL_MIN && (
            <Button key="as-skip-all" plain onPress={() => skipAll($)}>
              <Text dimColor>Skip all {skipN}</Text>
            </Button>
          )}
          {open.length > 0 && <Text dimColor>   ·   </Text>}
          <Button
            key="as-clear"
            plain
            onPress={async () => {
              const gone = await read($, list)
              await update($, cleared, old => [...old, ...gone])
              await update($, list, () => [])
              await update($, editing, () => null)
            }}
          >
            <Text dimColor>Clear history</Text>
          </Button>
        </Box>
      </Box>
    )
  })
}
