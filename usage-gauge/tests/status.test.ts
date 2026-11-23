import { expect, test } from 'claude-code/testing'

import { NARROW_BELOW, SPEED_FROM, cap, clip, layoutOf, parseStatus, showOf, slotsOf } from '../hooks/git'
import type { Git } from '../types'

// The parts of the git slots that need no engine: what `git status --porcelain=v2 --branch` says as counts, the counts
// as slots, the options, and the thresholds. The drawn gauge is in git.test.tsx and width.test.tsx.

const OID = '# branch.oid ' + 'a'.repeat(40)
const H = 'a'.repeat(40)

test('a clean branch that tracks a remote one: no files, ahead and behind from # branch.ab', () => {
  const text = [OID, '# branch.head main', '# branch.upstream origin/main', '# branch.ab +3 -2', ''].join('\n')
  expect(parseStatus(text)).toEqual({ branch: 'main', upstream: true, ahead: 3, behind: 2, changed: 0, conflicts: 0, untracked: 0 })
})

test('every kind of line: changed (1), renamed or copied (2), conflicted (u), untracked (?); ignored (!) and headers are not files', () => {
  const text = [
    OID,
    '# branch.head main',
    '# branch.upstream origin/main',
    '# branch.ab +0 -0',
    `1 .M N... 100644 100644 100644 ${H} ${H} edited.md`,
    `1 A. N... 000000 100644 100644 ${'0'.repeat(40)} ${H} added.md`,
    `1 .D N... 100644 100644 000000 ${H} ${H} deleted.md`,
    `2 R. N... 100644 100644 100644 ${H} ${H} R100 new name.md\told name.md`,
    `u UU N... 100644 100644 100644 100644 ${H} ${H} ${H} both.md`,
    '? scratch/',
    '? notes.md',
    '! build/',
    '',
  ].join('\n')
  expect(parseStatus(text)).toEqual({ branch: 'main', upstream: true, ahead: 0, behind: 0, changed: 4, conflicts: 1, untracked: 2 })
})

test('no # branch.ab line means the branch tracks nothing (a new branch, or a detached HEAD)', () => {
  expect(parseStatus([OID, '# branch.head feature-x', '? a.md', ''].join('\n'))).toEqual({
    branch: 'feature-x', upstream: false, ahead: 0, behind: 0, changed: 0, conflicts: 0, untracked: 1,
  })
  expect(parseStatus([OID, '# branch.head (detached)', ''].join('\n'))?.upstream).toBe(false)
})

test('a repository with no commit yet still prints its headers, so it is a repository', () => {
  expect(parseStatus(['# branch.oid (initial)', '# branch.head main', '? a.md', ''].join('\n'))).toEqual({
    branch: 'main', upstream: false, ahead: 0, behind: 0, changed: 0, conflicts: 0, untracked: 1,
  })
})

test('windows line endings read the same', () => {
  const text = [OID, '# branch.head main', '# branch.upstream origin/main', '# branch.ab +1 -0', `1 .M N... 100644 100644 100644 ${H} ${H} a.md`, ''].join('\r\n')
  expect(parseStatus(text)).toEqual({ branch: 'main', upstream: true, ahead: 1, behind: 0, changed: 1, conflicts: 0, untracked: 0 })
})

test('the branch is the name after # branch.head, slashes and all', () => {
  expect(parseStatus([OID, '# branch.head feature/PROJ-12-login-form', ''].join('\n'))?.branch).toBe('feature/PROJ-12-login-form')
})

test('a detached HEAD has no name: the commit\'s first seven characters stand in, and it says so', () => {
  const detached = parseStatus(['# branch.oid 2d41555abcdef0123456789abcdef0123456789a', '# branch.head (detached)', ''].join('\n'))
  expect(detached?.branch).toBe('2d41555')
  expect(detached?.detached).toBe(true)
  // A branch is not detached: the key is absent.
  expect(parseStatus([OID, '# branch.head main', ''].join('\n'))).not.toHaveProperty('detached')
  // No commit to name (a fresh repository, detached by hand): an empty name, drawn as none.
  expect(parseStatus(['# branch.oid (initial)', '# branch.head (detached)', ''].join('\n'))?.branch).toBe('')
})

test('a branch name is cut short with … to the room it has, counted in characters, and is nothing when there is none', () => {
  expect(clip('main', 16)).toBe('main')
  expect(clip('main', 4)).toBe('main')
  expect(clip('feature/very-long-branch-name', 16)).toBe('feature/very-lo…')
  expect([...clip('feature/very-long-branch-name', 16)]).toHaveLength(16)
  expect(clip('feature', 4)).toBe('fea…')
  expect(clip('feature', 1)).toBe('…')
  expect(clip('main', 0)).toBe('')
  // An emoji is one character, not two code units.
  expect(clip('fix-🔥-bug', 6)).toBe('fix-🔥…')
})

test('text that is not git status output is not a repository state', () => {
  expect(parseStatus('')).toBeUndefined()
  expect(parseStatus('fatal: not a git repository (or any of the parent directories): .git\n')).toBeUndefined()
})

test('a count is at most three characters', () => {
  expect([0, 9, 99, 100, 12345].map(cap)).toEqual(['0', '9', '99', '99+', '99+'])
})

const G: Git = { branch: 'main', upstream: true, ahead: 0, behind: 0, changed: 0, conflicts: 0, untracked: 0 }
const texts = (g: Git, withUntracked = true) => slotsOf(g, withUntracked).map(s => s.text)

test('slots: three fixed places, ↓ then ± then ↑, with the untracked slot between ± and ↑ only when asked for and non-zero', () => {
  expect(texts(G)).toEqual(['↓0', '±0', '↑0'])
  expect(texts({ ...G, behind: 2, changed: 3, ahead: 1 })).toEqual(['↓2', '±3', '↑1'])
  expect(texts({ ...G, untracked: 5 })).toEqual(['↓0', '±0', '?5', '↑0'])
  expect(texts({ ...G, untracked: 5 }, false)).toEqual(['↓0', '±0', '↑0'])
})

test('slots: a conflicted file is a changed file, so ± holds both', () => {
  expect(texts({ ...G, changed: 2, conflicts: 1 })).toEqual(['↓0', '±3', '↑0'])
})

test('slots: the remote\'s news is never read as "none" when it is old or missing', () => {
  expect(texts({ ...G, behind: 4, stale: true })).toEqual(['↓?', '±0', '↑0'])
  expect(texts({ ...G, upstream: false })).toEqual(['↓–', '±0', '↑–'])
  // No upstream: ahead and behind from git mean nothing, whatever they hold.
  expect(texts({ ...G, upstream: false, ahead: 7, behind: 7 })).toEqual(['↓–', '±0', '↑–'])
  // A ↓ that is a question mark does not make the branch diverged: ↑ keeps its plain colour.
  expect(slotsOf({ ...G, ahead: 1, behind: 3, stale: true }, true).map(s => `${s.text}:${s.color ?? (s.dim ? 'dim' : 'plain')}`)).toEqual(['↓?:dim', '±0:dim', '↑1:plain'])
})

test('slots: warning for news on the remote, error for a diverged branch or a conflict, dim zeros, plain counts', () => {
  const paint = (g: Git) => slotsOf(g, true).map(s => `${s.text}:${s.color ?? (s.dim ? 'dim' : 'plain')}`)
  expect(paint({ ...G, behind: 1 })).toEqual(['↓1:warning', '±0:dim', '↑0:dim'])
  expect(paint({ ...G, ahead: 1, changed: 1 })).toEqual(['↓0:dim', '±1:plain', '↑1:plain'])
  expect(paint({ ...G, ahead: 1, behind: 1 })).toEqual(['↓1:error', '±0:dim', '↑1:error'])
  expect(paint({ ...G, conflicts: 1 })).toEqual(['↓0:dim', '±1:error', '↑0:dim'])
  expect(paint({ ...G, untracked: 3 })).toEqual(['↓0:dim', '±0:dim', '?3:dim', '↑0:dim'])
})

test('options: every item is on unless the person turned it off', () => {
  const ON = { time: true, cost: true, speed: true, git: true, cache: true, fetch: true, folder: true }
  expect(showOf({})).toEqual(ON)
  expect(showOf({ showTime: true, showGit: true })).toEqual(ON)
  expect(showOf({ showTime: false })).toEqual({ ...ON, time: false })
  expect(showOf({ showCost: false })).toEqual({ ...ON, cost: false })
  expect(showOf({ showSpeed: false })).toEqual({ ...ON, speed: false })
  expect(showOf({ showGit: false })).toEqual({ ...ON, git: false })
  expect(showOf({ showCache: false })).toEqual({ ...ON, cache: false })
  expect(showOf({ fetchRemote: false })).toEqual({ ...ON, fetch: false })
  expect(showOf({ showFolder: false })).toEqual({ ...ON, folder: false })
})

test('layout: without the git chip every threshold is the gauge\'s old one', () => {
  expect(NARROW_BELOW).toBe(115)
  expect(layoutOf(80, false)).toMatchObject({ narrow: true, speed: true })
  expect(layoutOf(114, false)).toMatchObject({ narrow: true, speed: true })
  expect(layoutOf(115, false)).toMatchObject({ narrow: false, speed: true })
})

test('layout: with the git chip the speed waits for 85 columns, and the untracked slot is in every wide pane', () => {
  expect(SPEED_FROM).toBe(85)
  expect(layoutOf(84, true)).toMatchObject({ narrow: true, speed: false, untracked: false })
  expect(layoutOf(85, true)).toMatchObject({ narrow: true, speed: true, untracked: false })
  expect(layoutOf(114, true)).toMatchObject({ narrow: true, speed: true, untracked: false })
  expect(layoutOf(115, true)).toMatchObject({ narrow: false, speed: true, untracked: true })
})

// The rooms of the folder and the branch are measured on the drawn row since 0.13.1: roomOf in folder.test.ts, the
// drawn widths in width.test.tsx.
