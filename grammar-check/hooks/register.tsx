import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelCompleteResult, Register, RenderElement } from 'claude-code'

import type { GrammarCard } from '../types'
import { EFFORT, MAX_TOKENS, MODEL, SYSTEM, TIMEOUT_MS, eligible, frame, label, parseCheck, review as reviewGrammar, rows } from './grammar'
import type { Check, Seg } from './grammar'

// The `==` grammar check (and /grammar): one small Haiku call that checks only your
// grammar, and it can be switched off in /config. The prompt is never sent to Claude,
// so the correction never enters the conversation.
// This was part of the prompt-enhancer mod until 0.16.1; it became a mod of its own on
// 2026-11-13 (the owner's call), and prompt-enhancer now ships only its two skills.

const grammar = atom({ plugin: 'grammar-check', key: 'grammar' } as const, null)

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

/** How the check ended when the model gave no text. */
const whyFailed = (r: Exclude<ModelCompleteResult, { isAnswered: true }>) =>
  r.reason === 'api-error'
    ? `Could not check: ${r.error}${r.status ? ` (${r.status})` : ''}.`
    : r.reason === 'empty-reply'
      ? 'Could not check: the model sent no text.'
      : 'Could not check: it took too long.'

/** How each kind of stretch is drawn in the one-line diff. */
const SEG_STYLE: Record<Seg['kind'], { color?: string; bold?: boolean; strikethrough?: boolean; underline?: boolean }> = {
  same: {},
  del: { color: 'red', strikethrough: true },
  ins: { color: 'green', bold: true },
  held: { color: 'yellow', underline: true },
}

/** Which check is current: a result from an older one is dropped. */
let seq = 0
let running: AbortController | null = null

/**
 * One check, in the background: ask the model, read the answer (one retry when it is not the
 * agreed JSON), review it, put the corrected text in the box when that is free, then show the card.
 */
async function check($: EngineInterface, text: string, typed: string[], mine: number, signal: AbortSignal) {
  const show = (card: GrammarCard) => (mine === seq ? update($, grammar, () => card) : undefined)
  try {
    let result: Check | null = null
    for (let attempt = 0; attempt < 2 && result === null; attempt++) {
      const r = await $.model.complete(
        { model: MODEL, system: SYSTEM, prompt: frame(text), effort: EFFORT, maxTokens: MAX_TOKENS, timeoutMs: TIMEOUT_MS },
        { signal },
      )
      if (mine !== seq) return
      if (!r.isAnswered) return void (await show({ status: 'failed', why: whyFailed(r) }))
      result = parseCheck(r.text)
    }
    if (result === null) return void (await show({ status: 'failed', why: 'Could not read the check result. Try again.' }))
    const reviewed = reviewGrammar(text, result)
    if (reviewed.applied > 0) {
      const box = await $.prompt.read()
      if (mine !== seq) return
      const isFree = box.text.trim() === '' || typed.includes(box.text.trim())
      const filled = isFree ? await $.prompt.fill({ text: reviewed.text, mode: 'replace' }).catch(() => undefined) : undefined
      $.ui.toast(filled?.isFilled ? 'Corrected text is in the prompt box: check it, then Enter' : 'Grammar check ready: use "Put in box" on the card')
    }
    await show({ status: 'done', review: reviewed })
  } catch {
    await Promise.resolve(show({ status: 'failed', why: 'Could not check: something went wrong.' })).catch(() => undefined)
  }
}

/** Starts a check. Returns why it did not start, or null when it is under way. */
async function begin($: EngineInterface, text: string, typed: string): Promise<string | null> {
  const ok = eligible(text)
  if (!ok.ok) return ok.why
  const mine = ++seq
  running?.abort()
  running = new AbortController()
  await update($, grammar, () => ({ status: 'checking' as const, original: text }))
  void check($, text, [text, `== ${text}`, `/grammar ${text}`, typed.trim()], mine, running.signal)
  return null
}

/** Closes the card, and ignores a check that is still running. */
const dismiss = ($: EngineInterface) => {
  seq++
  running?.abort()
  return update($, grammar, () => null)
}

export const register: Register = (on, options) => {
  const grammarOn = options.grammar !== 'off'

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'grammar',
      description: 'Check only the grammar of your text with one small Haiku call (same as ==). Nothing is sent to Claude',
      argumentHint: '<your text>',
    })
    return next(e)
  })

  // "== …": the grammar check. Every other prompt goes to Claude untouched.
  on('prompt.submit', async ($, e, next) => {
    const isYours =
      e.origin.kind === 'composer' || (e.origin.kind === 'plugin' && e.origin.name === 'grammar-check')
    if (!isYours) return next(e)
    const text = e.text.trimStart()
    // "== …": check the grammar only. The prompt is consumed here and never reaches Claude.
    if (grammarOn && /^==(\s|$)/.test(text)) {
      const request = text.slice(2).trim()
      if (request === '') return { drop: 'Type your text after ==, for example: == i dont know why it fail' }
      const why = await begin($, request, e.text)
      return { drop: why ?? 'Checking your grammar. Nothing is sent to Claude.' }
    }
    return next(e)
  }).catch(($, e, next) => next(e)) // never block your prompt

  on('command.run', { command: 'grammar' }, async ($, e) => {
    if (!grammarOn) return { text: 'The grammar check is off. Turn it on in /config (Grammar check).' }
    const text = e.args.trim()
    if (text === '') return { text: 'Usage: /grammar <your text>, or start a prompt with ==' }
    const why = await begin($, text, `/grammar ${text}`)
    return { text: why ?? 'Checking your grammar. Nothing is sent to Claude.' }
  })

  // The grammar card: the one-line diff, a row per kind of fix, what was held back, and the actions.
  // It never says the text is fine: "No fixes found" only says this check found none.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const g = await read($, grammar)
    if (g === null || e.props.hasSurvey) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const done = g.status === 'done' ? g.review : null
    const count = done?.applied ?? 0
    const held = done?.held ?? 0
    const headline =
      done === null
        ? g.status === 'checking'
          ? 'checking…'
          : 'could not check'
        : count === 0
          ? 'No fixes found'
          : count === 1
            ? '1 fix found'
            : `${count} fixes found`
    const accent = g.status === 'failed' || held > 0 ? 'yellow' : 'green'

    const body: RenderElement[] = []
    if (g.status === 'failed') {
      body.push(
        <Text key="pe-g-why" color="yellow" wrap="wrap">
          {g.why}
        </Text>,
      )
    }
    if (done !== null) {
      // the whole text with the changes marked, while it is short enough to read in one glance
      if (done.original.length <= 500 && done.segments.some(s => s.kind !== 'same')) {
        body.push(
          <Text key="pe-g-line" wrap="wrap">
            {done.segments.map((s, i) => (
              <Text key={`pe-g-s${i}`} {...SEG_STYLE[s.kind]}>
                {`${s.text} `}
              </Text>
            ))}
          </Text>,
        )
      }
      const list = rows(done)
      list.slice(0, 8).forEach((row, i) => {
        body.push(
          row.applied ? (
            <Box key={`pe-g-row-${i}`} flexDirection="column">
              <Text wrap="wrap">
                <Text bold color={accent}>
                  {label(row.category).padEnd(15)}
                </Text>
                <Text>{`${row.del || '—'} → ${row.ins || '—'}`}</Text>
                {row.count > 1 && <Text dimColor>{` ×${row.count}`}</Text>}
              </Text>
              {row.why !== '' && (
                <Text dimColor wrap="wrap">
                  {`  ${row.why}`}
                </Text>
              )}
            </Box>
          ) : (
            <Box key={`pe-g-row-${i}`} flexDirection="column">
              <Text color="yellow" wrap="wrap">
                {`⚠ not applied  ${row.del} → ${row.ins || '(removed)'}`}
              </Text>
              <Text dimColor wrap="wrap">
                {'  It takes words out. Check it yourself.'}
              </Text>
            </Box>
          ),
        )
      })
      if (list.length > 8) {
        body.push(
          <Text key="pe-g-more" dimColor>
            {`+${list.length - 8} more`}
          </Text>,
        )
      }
      done.tips.slice(0, 3).forEach((t, i) => {
        body.push(
          <Text key={`pe-g-tip-${i}`} dimColor wrap="wrap">
            {`tip  ${t.before} → ${t.after} (not applied)`}
          </Text>,
        )
      })
    }

    const buttons: RenderElement[] = []
    if (done !== null && done.applied > 0) {
      buttons.push(
        <Button
          key="pe-g-box"
          label="✎ Put in box"
          variant="primary"
          onPress={() => $.prompt.fill({ text: done.text, mode: 'replace' }).catch(() => undefined)}
        />,
      )
      buttons.push(<Text key="pe-g-gap">  </Text>)
    }
    buttons.push(<Button key="pe-g-dismiss" label="Dismiss" role="dismiss" onPress={() => dismiss($)} />)

    const mine = (
      <Box key="pe-grammar" flexDirection="column" borderStyle="round" borderColor={accent} paddingX={1}>
        <Box>
          <Text bold color="black" backgroundColor={accent}>
            {' ✎ GRAMMAR '}
          </Text>
          <Text bold>{`  ${headline}${held > 0 ? ` · ${held} not applied` : ''}`}</Text>
          <Text dimColor>{'  your text was not sent to Claude'}</Text>
        </Box>
        {body}
        <Box key="pe-g-actions" marginTop={1}>
          {buttons}
        </Box>
      </Box>
    )
    const beneath = await next(e)
    return (
      <Box flexDirection="column">
        {mine}
        {!isBlank(beneath) && beneath}
      </Box>
    )
  }).catch(($, e, next) => next(e))
}
