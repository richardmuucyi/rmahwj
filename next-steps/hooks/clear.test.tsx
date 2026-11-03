import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'next-steps',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 20,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

// Over the mod's 80-character minimum, so the mod asks for next steps.
const ANSWER =
  'An answer long enough (over the 80-character minimum) that the mod asks for next steps after it.'

test('/clear hides the next steps, on every surface', async ($, on) => {
  // Nothing sits beneath the plugin: each hook here stands for the engine.
  on('command.list', () => ({ value: [] }))
  on('model.fork', () => ({
    value: {
      isAnswered: true,
      text: '[{"label": "run the tests", "prompt": "run the tests"}]',
      usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
  }))
  on('prompt.suggest', () => ({ isShown: true }))
  on('turn.complete', () => ({ text: ANSWER }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  // The engine's own drawing beneath the band.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    await $.turn.complete({
      reason: 'answer',
      answer: ANSWER,
      durationMs: 1,
      isAborted: false,
      turnId: `t-${surface}`,
    })

    const before = await $.ui.mount({ ...BAND, surface })
    expect((await before.find({ key: 'next-0' }))?.text).toBe('run the tests')
    await before.unmount()

    // What a /clear raises: the conversation ends, and no turn starts.
    await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })

    const after = await $.ui.mount({ ...BAND, surface })
    expect(await after.find({ key: 'next-0' })).toBeUndefined()
    await after.unmount()
  }
})
