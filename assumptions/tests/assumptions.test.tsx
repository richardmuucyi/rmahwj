import { expect, mock, test } from 'claude-code/testing'

const PANE_PROPS = {
  title: 'Assumptions',
  isFocused: true,
  bodyColumns: 80,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
}
const BAND = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 12,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 12 },
  view: {},
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`card: high impact first, answer in place, skip, fix, then gone (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const sent: string[] = []
    const closed: string[] = []
    on('prompt.submit', (_$, e) => {
      sent.push(e.text)
      return { text: e.text }
    })
    // The band is one row per plugin. This hook is the test's own row, drawn whatever the mod draws:
    // the mod answers only its own row, so it can neither hide this one nor needs to keep it.
    on('ui.render', ($, e) => {
      const { Box } = $.ui.resolve(e)
      return <Box key="engine-own" />
    })
    on('ui.close', (_$, e) => {
      closed.push(e.id)
      return { value: undefined }
    })

    const log = (assumption: string, impact?: 'high') =>
      $.tool.call({ tool: 'mcp__assumptions__log_assumption', assumption, why: 'not stated', impact })
    expect(JSON.stringify(await log('Use British spelling'))).toContain('A1')
    expect(JSON.stringify(await log('Output goes in the docs folder'))).toContain('A2')
    await clock.advance(12_000)
    expect(JSON.stringify(await log('Delete the old build folder first', 'high'))).toContain('A3')

    const card = async () => {
      const band = await $.ui.mount({ plugin: 'assumptions', surface, component: 'AbovePrompt', props: BAND })
      const text = (await band.find({ key: 'as-card' }))?.text.replace(/\s+/g, ' ').trim() ?? ''
      return { band, text }
    }

    // High impact jumps the queue, with its own label.
    let c = await card()
    expect(c.text).toContain('⚠ ASSUMPTION 1/3')
    expect(c.text).toContain('high impact')
    expect(c.text).toContain('Delete the old build folder first')
    // The other row stands beside the card, once: the mod's row holds the card alone.
    expect((await c.band.findAll({ key: 'engine-own' })).length).toBe(1)
    await c.band.press({ key: 'as-card-right' })
    await c.band.unmount()

    // Then the oldest low-impact one; Skip sends it to the back.
    c = await card()
    expect(c.text).toContain('ASSUMPTION 1/2')
    expect(c.text).toContain('Use British spelling')
    await c.band.press({ key: 'as-card-skip' })
    await c.band.unmount()
    c = await card()
    expect(c.text).toContain('Output goes in the docs folder')

    // Fix in place: the card turns into the field, the correction goes to Claude.
    await c.band.press({ key: 'as-card-fix' })
    await c.band.unmount()
    c = await card()
    expect(c.text).toContain('FIXING')
    await c.band.input({ key: 'as-card-fix-input', text: 'Put it in docs/generated' })
    expect(sent[0]).toContain('Correction to assumption A2')
    await c.band.unmount()

    // The skipped one is back; Right on it empties the queue: the card is gone.
    c = await card()
    expect(c.text).toContain('Use British spelling')
    await c.band.press({ key: 'as-card-right' })
    await c.band.unmount()
    await clock.advance(2_000)
    expect(closed).toEqual(['assumptions'])
    c = await card()
    expect(c.text).toBe('')
    expect(await c.band.find({ key: 'as-card' })).toBeUndefined()
    expect((await c.band.findAll({ key: 'engine-own' })).length).toBe(1)
    await c.band.unmount()

    // The panel: reviewed ones fold away; Clear keeps numbering going.
    const pane = await $.ui.mount({
      plugin: 'assumptions', surface, component: 'Pane', requestId: 'assumptions', props: PANE_PROPS,
    })
    expect(await pane.find({ type: 'Text', text: /TO REVIEW 0/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /A1 +Use British/ })).toBeUndefined()
    await pane.press({ key: 'as-toggle-reviewed' })
    expect(await pane.find({ type: 'Text', text: /A1 +Use British/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /→ Put it in docs\/generated/ })).toBeDefined()
    await pane.press({ key: 'as-clear' })
    expect(JSON.stringify(await log('Keep the old file'))).toContain('A4')
  })
}
