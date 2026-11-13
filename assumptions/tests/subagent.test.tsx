import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  hasSurvey: false,
  isCollapsed: false,
  isWorking: true,
  maxRows: 12,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 12 },
  view: {},
}

test("a subagent's turn ending mid-turn leaves the main turn working: the correction still reaches Claude mid-turn", async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  const submitted: string[] = []
  const appended: string[] = []
  on('prompt.submit', (_$, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  // The rig keeps the row itself: a hook here watches and relays.
  on('session.append', (_$, e, next) => {
    appended.push(JSON.stringify(e.message))
    return next(e)
  })
  on('ui.toast', () => ({ value: undefined }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine-own" />
  })

  // The main turn starts; inside it a subagent starts and reports back.
  await $.turn.start({ text: 'Build it', turnId: 't-main' })
  await $.turn.start({ text: 'Look something up', turnId: 't-sub', agentId: 'agent-1' })
  await $.turn.complete({ reason: 'answer', answer: 'Found it.', durationMs: 1, isAborted: false, turnId: 't-sub', agentId: 'agent-1' })

  await $.tool.call({ tool: 'mcp__assumptions__log_assumption', assumption: 'Output goes in the docs folder', why: 'not stated' })
  const fixOnCard = async (text: string) => {
    let band = await $.ui.mount({ plugin: 'assumptions', surface: 'terminal', component: 'AbovePrompt', props: BAND })
    await band.press({ key: 'as-card-fix' })
    await band.unmount()
    band = await $.ui.mount({ plugin: 'assumptions', surface: 'terminal', component: 'AbovePrompt', props: BAND })
    await band.input({ key: 'as-card-fix-input', text })
    await band.unmount()
  }

  // Still mid-turn: the correction is appended for Claude's next step, not queued as a new prompt.
  await fixOnCard('Put it in docs/generated')
  expect(appended.length).toBe(1)
  expect(appended[0]).toContain('Correction to assumption A1')
  expect(submitted).toEqual([])

  // The main turn ends: now a correction is a prompt of its own.
  await $.turn.complete({ reason: 'answer', answer: 'Done.', durationMs: 1, isAborted: false, turnId: 't-main' })
  await $.tool.call({ tool: 'mcp__assumptions__log_assumption', assumption: 'Use British spelling', why: 'not stated' })
  await fixOnCard('Use American spelling')
  expect(appended.length).toBe(1)
  expect(submitted.length).toBe(1)
  expect(submitted[0]).toContain('Correction to assumption A2')
})
