import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'next-steps',
  surface: 'terminal',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 20,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

// Over the mod's 80-character minimum, so only the agentId can be what stops the fork.
const ANSWER =
  'An answer long enough (over the 80-character minimum) that the mod asks for next steps after it.'

test("a subagent's finished turn starts no fork and offers nothing; the main turn's does", async ($, on) => {
  let forks = 0
  on('command.list', () => ({ value: [] }))
  on('model.fork', () => {
    forks += 1
    return {
      value: {
        isAnswered: true,
        text: '[{"label": "run the tests", "prompt": "run the tests"}]',
        usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    }
  })
  on('prompt.suggest', () => ({ isShown: true }))
  on('turn.complete', () => ({ text: ANSWER }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

  // A subagent reports back: the same event, carrying its id.
  await $.turn.complete({ reason: 'answer', answer: ANSWER, durationMs: 1, isAborted: false, turnId: 't-sub', agentId: 'agent-1' })
  const afterSub = await $.ui.mount(BAND)
  expect(await afterSub.find({ key: 'next-0' })).toBeUndefined()
  await afterSub.unmount()
  expect(forks).toBe(0)

  // The main loop's answer: no agentId, one fork, the offer drawn.
  await $.turn.complete({ reason: 'answer', answer: ANSWER, durationMs: 1, isAborted: false, turnId: 't-main' })
  const afterMain = await $.ui.mount(BAND)
  expect((await afterMain.find({ key: 'next-0' }))?.text).toBe('run the tests')
  await afterMain.unmount()
  expect(forks).toBe(1)
})
