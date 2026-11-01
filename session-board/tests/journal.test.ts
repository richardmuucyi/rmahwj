// The markdown day journal (hooks/journal.ts): pure functions, no engine.
import { expect, test } from 'claude-code/testing'

import { editedOutsideNotes, isStale, journalPath, journalRoot, keptNotes, parseLog, renderJournal, tickedChecks } from '../hooks/journal'
import type { JournalLine } from '../hooks/journal'

const DAY = '2026-10-12'

test('journalPath: year and month folders, the full date as the file name', () => {
  expect(journalPath('/home/me/.claude/session-board/journal', DAY)).toBe('/home/me/.claude/session-board/journal/2026/10/2026-10-12.md')
  expect(journalPath('C:/notes/', DAY)).toBe('C:/notes/2026/10/2026-10-12.md')
})

test('journalRoot: the default under the board, a ~ setting, a Windows setting', () => {
  expect(journalRoot(undefined, '/home/me', '/home/me/.claude/session-board')).toBe('/home/me/.claude/session-board/journal')
  expect(journalRoot('  ', '/home/me', '/b')).toBe('/b/journal')
  expect(journalRoot('~/Journal', '/home/me', '/b')).toBe('/home/me/Journal')
  expect(journalRoot('D:\\Notes\\Journal\\', 'D:\\home', '/b')).toBe('D:/Notes/Journal')
  expect(journalRoot('~\\Journal', 'D:\\home\\', '/b')).toBe('D:/home/Journal')
  // a relative folder, or "~name" (not the home folder), starts at home: the session's own folder changes
  expect(journalRoot('Journal', '/home/me', '/b')).toBe('/home/me/Journal')
  expect(journalRoot('~other/x', '/home/me', '/b')).toBe('/home/me/~other/x')
  expect(journalRoot('/srv/j', '/home/me', '/b')).toBe('/srv/j')
})

test('parseLog: a broken line is skipped, the rest are read', () => {
  const lines = parseLog('{"at":"09:00","did":"A"}\n{"at":"09:0\n\n[1]\n{"at":"10:00","did":"B"}\n')
  expect(lines.map(l => l.did)).toEqual(['A', 'B'])
})

test('keptNotes: everything under "## My notes" to the end, CRLF too', () => {
  expect(keptNotes('# x\n\n## Lessons learned\n\n- a\n\n## My notes\r\n\r\nFelt slow.\r\n\r\n## Later\r\nmore\r\n')).toBe('Felt slow.\n\n## Later\nmore')
  expect(keptNotes('# x\n## Reflections\n')).toBe('')
})

const at = (time: string, rest: Partial<JournalLine> = {}): JournalLine => ({ at: time, project: 'vault', did: `did ${time}`, mins: 2, files: 1, assumed: 0, status: 'answered', ...rest })

test('renderJournal: projects by time spent, parts of the day, folded runs, checks by the clock, reflections, lessons, notes', () => {
  const sessions = new Map<string, JournalLine[]>([
    ['s1', [at('09:00'), at('09:05', { did: null, mins: 3, files: 2 }), at('09:10', { did: null, mins: 1, files: 0 }), at('14:00', { check: 'the login test', mins: 20, lesson: 'Mocks run in import order.' })]],
    ['s2', [at('08:00', { project: 'iams', status: 'stopped', check: 'deploy script' }), at('23:30', { project: 'iams', status: 'error', assumed: 2 })]],
    // a second session of the same project, its turns interleaved with the first one's
    ['s3', [at('08:50'), at('09:20')]],
  ])
  const page = renderJournal(DAY, sessions, 'Felt slow after lunch.')
  expect(page).toMatch(/^---\ndate: 2026-10-12\ntype: work-journal\nturns: 8\nminutes: 34\nchecksum: [0-9a-f]{8}\n---\n/)
  expect(page).toContain('# Work journal: Monday, 12 October 2026')
  expect(page).toContain('**8 turns · 2 projects · 34 min of Claude work · 2 to check**')
  // the busiest project first; its two sessions read as one clock-ordered list
  expect(page.indexOf('### vault · 30 min')).toBeLessThan(page.indexOf('### iams · 4 min'))
  const vault = page.slice(page.indexOf('### vault'), page.indexOf('### iams'))
  expect(vault).toBe([
    '### vault · 30 min', '', '**Morning**', '',
    '- 08:50 did 08:50 · 2 min · 1 file',
    '- 09:00 did 09:00 · 2 min · 1 file',
    '- 09:05–09:10 *2 turns with no summary* · 4 min · 2 files',
    '- 09:20 did 09:20 · 2 min · 1 file', '', '**Afternoon**', '',
    '- 14:00 did 14:00 · 20 min · 1 file', '', '',
  ].join('\n'))
  expect(page).toContain('- 08:00 did 08:00 *(stopped)* · 2 min · 1 file')
  expect(page).toContain('**Evening**\n\n- 23:30 did 23:30 *(ended on an error)* · 2 min · 1 file')
  // checks by the clock, across projects
  expect(page).toContain('## To check\n\n- [ ] deploy script · *iams, 08:00*\n- [ ] the login test · *vault, 14:00*\n')
  expect(page).toContain('- Most time went to vault: 30 min of 34 min.')
  expect(page).toContain('- The longest turn took 20 min (vault, 14:00): did 14:00.')
  expect(page).toContain('- 1 turn stopped and 1 turn ended on an error before the end.')
  expect(page).toContain('- Claude logged 2 assumptions to confirm.')
  expect(page).toContain('- 2 turns left no summary.')
  expect(page).toContain('## Lessons learned\n\n- Mocks run in import order. · *vault, 14:00*\n')
  expect(page.endsWith('## My notes\n\nFelt slow after lunch.\n')).toBe(true)
  // the same input gives the same page: a rebuild with nothing new writes nothing
  expect(renderJournal(DAY, sessions, keptNotes(page))).toBe(page)
})

test('renderJournal: a quiet day says so instead of leaving sections empty', () => {
  const page = renderJournal(DAY, new Map([['s1', [at('09:00', { mins: 1, files: 0 })]]]))
  expect(page).toContain('Nothing was flagged to check.')
  expect(page).toContain('- All the work was on vault.')
  expect(page).toContain('No lessons were noted today.')
  expect(page).toContain('- 09:00 did 09:00 · 1 min\n')
  expect(page.endsWith('## My notes\n\n')).toBe(true)
})

test('renderJournal: "answered" is not "done": a turn that left work going says so; a "none" check is no to-do', () => {
  const page = renderJournal(DAY, new Map([['s1', [
    at('09:00', { did: 'Started the 48-run sweep', check: 'none' }),
    at('09:30', { did: 'Waiting on the final suite run', check: 'Nothing.' }),
    at('10:00', { did: 'Fixed the parser', check: 'the parser output' }),
  ]]]))
  expect(page).toContain('- 09:00 Started the 48-run sweep *(left running)* · 2 min · 1 file')
  expect(page).toContain('- 09:30 Waiting on the final suite run *(left running)* · 2 min · 1 file')
  expect(page).toContain('- 10:00 Fixed the parser · 2 min · 1 file')
  expect(page).toContain('## To check\n\n- [ ] the parser output · *vault, 10:00*\n\n## Reflections')
  expect(page).toContain('· 1 to check**')
})

test('editedOutsideNotes: notes are free to edit; any other edit, or a lost heading, is seen', () => {
  const page = renderJournal(DAY, new Map([['s1', [at('09:00')]]]), 'mine')
  expect(editedOutsideNotes('')).toBe(false)
  expect(editedOutsideNotes(page)).toBe(false)
  expect(editedOutsideNotes(`${page}more of mine\n`)).toBe(false)
  expect(editedOutsideNotes(page.replace(/\n/g, '\r\n'))).toBe(false)
  expect(editedOutsideNotes(page.replace('## Reflections\n', '## Reflections\n\nA long day, but a good one.\n'))).toBe(true)
  expect(editedOutsideNotes(page.replace('## My notes', '## Notes'))).toBe(true)
  // a page with no checksum (written by hand, or by an older version) counts as edited
  expect(editedOutsideNotes(page.replace(/^checksum: .*\n/m, ''))).toBe(true)
  // the heading in another case still holds the notes, and is no edit
  const renamed = page.replace('## My notes', '## my Notes')
  expect(editedOutsideNotes(renamed)).toBe(false)
  expect(keptNotes(renamed)).toBe('mine')
})

test('isStale: no page, a different turn count or a cut page; your own edits alone are not stale', () => {
  const page = renderJournal(DAY, new Map([['s1', [at('09:00'), at('09:30')]]]), 'mine')
  expect(isStale('', 2)).toBe(true)
  expect(isStale(page, 2)).toBe(false)
  expect(isStale(page, 3)).toBe(true)
  expect(isStale(page, 1)).toBe(true)
  expect(isStale(page.slice(0, 120), 2)).toBe(true)
  expect(isStale(page.replace('## Reflections\n', '## Reflections\n\nA good day.\n'), 2)).toBe(false)
  expect(isStale(page.replace(/^turns: .*\n/m, ''), 2)).toBe(true)
})

test('ticks: a ticked check stays ticked on the next rebuild, and ticking is no edit; "wait for …" is no check', () => {
  const sessions = new Map([['s1', [
    at('09:00', { check: 'the login test' }),
    at('09:30', { check: 'the deploy URL' }),
    at('09:40', { check: 'wait for the review' }),
    at('09:50', { check: 'nothing yet; results pending' }),
  ]]])
  const page = renderJournal(DAY, sessions)
  expect(page).toContain('## To check\n\n- [ ] the login test · *vault, 09:00*\n- [ ] the deploy URL · *vault, 09:30*\n\n## Reflections')
  const ticked = page.replace('- [ ] the deploy URL', '- [X] the deploy URL')
  expect(editedOutsideNotes(ticked)).toBe(false)
  expect([...tickedChecks(ticked)]).toEqual(['the deploy URL · *vault, 09:30*'])
  const rebuilt = renderJournal(DAY, sessions, keptNotes(ticked), tickedChecks(ticked))
  expect(rebuilt).toContain('- [ ] the login test · *vault, 09:00*\n- [x] the deploy URL · *vault, 09:30*')
  expect(editedOutsideNotes(rebuilt)).toBe(false)
  // a tick written into the notes is not a check
  expect(tickedChecks(`${page}- [x] my own to-do\n`).size).toBe(0)
})
