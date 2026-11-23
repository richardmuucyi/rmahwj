import { expect, test } from 'claude-code/testing'

import { BRANCH_MAX, FLEX_MAX, FOLDER_MAX, cellWidth, clipCells, colorOf, fitFolder, folderOf, roomOf, showOf, splitRoom, textOf } from '../hooks/git'

// The session's folder on row 1, with no engine in it: where the session is against its root, how the name is cut to
// the room it has, and how the git chip's room is shared between the folder and the branch. The drawn chip is in
// folder.draw.test.tsx, and the widths in width.test.tsx.

test('at the root: the root folder\'s last name, and a trailing separator changes nothing', () => {
  expect(folderOf('/home/me/vault', '/home/me/vault')).toEqual({ place: 'root', root: 'vault' })
  expect(folderOf('/home/me/vault', '/home/me/vault/')).toEqual({ place: 'root', root: 'vault' })
})

test('under the root: the root\'s name and the current folder\'s last name', () => {
  expect(folderOf('/home/me/vault', '/home/me/vault/.claude/mods')).toEqual({ place: 'under', root: 'vault', here: 'mods' })
})

test('Windows paths in another case and with the other separator are the same folder', () => {
  expect(folderOf('C:\\Src\\personal-notes', 'c:/src/personal-notes/.claude/')).toEqual({ place: 'under', root: 'personal-notes', here: '.claude' })
  expect(folderOf('C:\\Src\\personal-notes', 'c:/src/PERSONAL-NOTES')).toEqual({ place: 'root', root: 'personal-notes' })
})

test('a sibling whose name starts with the root\'s is outside it, not under it', () => {
  expect(folderOf('/home/me/vault', '/home/me/vault-old')).toEqual({ place: 'outside', root: 'vault-old' })
})

test('a path with no name in it keeps the path', () => {
  expect(folderOf('C:\\', 'C:\\')).toEqual({ place: 'root', root: 'C:' })
  expect(folderOf('/', '/')).toEqual({ place: 'root', root: '/' })
})

test('East Asian wide characters take two cells', () => {
  expect(cellWidth('vault')).toBe(5)
  expect(cellWidth('工作流')).toBe(6)
  expect(cellWidth('a工')).toBe(3)
  expect(clipCells('工作流改造術', 7)).toBe('工作流…')
  expect(clipCells('vault', 5)).toBe('vault')
  expect(clipCells('vault', 0)).toBe('')
})

test('at the root or outside it, the name is cut at the end to fit', () => {
  expect(fitFolder({ place: 'root', root: 'personal-notes' }, 20)).toBe('personal-notes')
  expect(fitFolder({ place: 'root', root: 'personal-notes' }, 8)).toBe('persona…')
  expect(fitFolder({ place: 'outside', root: 'sgt-admin' }, 6)).toBe('sgt-a…')
})

test('under the root, the root\'s name is cut first so the folder it moved into stays readable', () => {
  const f = { place: 'under', root: 'personal-notes', here: 'mods' } as const
  expect(fitFolder(f, 19)).toBe('personal-notes›mods')
  expect(fitFolder(f, 12)).toBe('person…›mods')
  expect(fitFolder(f, 6)).toBe('…›mods')
  expect(fitFolder(f, 3)).toBe('')
})

test('a CJK name is cut by cells, so it never takes more room than it was given', () => {
  const cut = fitFolder({ place: 'root', root: '工作流改造術' }, 7)
  expect(cut).toBe('工作流…')
  expect(cellWidth(cut)).toBeLessThanOrEqual(7)
  for (let room = 0; room <= 14; room++) {
    expect(cellWidth(fitFolder({ place: 'under', root: '工作流改造術', here: '資料' }, room)), `${room} cells`).toBeLessThanOrEqual(room)
  }
})

test('the folder part\'s colour: none at the root, the warning under it, the error outside it', () => {
  expect(colorOf({ place: 'root', root: 'vault' })).toBeUndefined()
  expect(colorOf({ place: 'under', root: 'vault', here: 'mods' })).toBe('warning')
  expect(colorOf({ place: 'outside', root: 'other' })).toBe('error')
})

test('the shared room: the piece that goes first keeps its room, the other takes what is left, none under 4 cells', () => {
  expect(FOLDER_MAX).toBe(16)
  expect(FLEX_MAX).toBe(FOLDER_MAX + 1 + BRANCH_MAX)
  // At the root the branch goes first.
  expect(splitRoom(33, 14, 4, false)).toEqual({ folder: 14, branch: 4 })
  expect(splitRoom(16, 14, 4, false)).toEqual({ folder: 11, branch: 4 })
  expect(splitRoom(6, 14, 4, false)).toEqual({ folder: 0, branch: 4 })
  // After a drift the folder goes first.
  expect(splitRoom(16, 16, 16, true)).toEqual({ folder: 16, branch: 0 })
  expect(splitRoom(20, 11, 16, true)).toEqual({ folder: 11, branch: 8 })
  // Too little room for anything; and a piece that wants none leaves it all to the other.
  expect(splitRoom(3, 5, 4, false)).toEqual({ folder: 0, branch: 0 })
  expect(splitRoom(20, 0, 4, false)).toEqual({ folder: 0, branch: 4 })
  expect(splitRoom(20, 9, 0, false)).toEqual({ folder: 9, branch: 0 })
})

test('the folder is on unless /config says false', () => {
  expect(showOf({}).folder).toBe(true)
  expect(showOf({ showFolder: false }).folder).toBe(false)
})

// ── 0.13.1: the room is measured on the row that is drawn ─────────────────

test('the gauge\'s three emoji glyphs take two cells, as width.test.tsx counts them', () => {
  expect(cellWidth('⚡ 62 t/s')).toBe(9)
  expect(cellWidth('⏱ 1h')).toBe(5)
  expect(cellWidth('⏳')).toBe(2)
  // The narrow symbols the rows also draw stay one cell.
  expect(cellWidth('● ◉ ↓ ± ↑ ▰ ▱ ↻ › …')).toBe(19)
})

test('the text of a drawn element: its strings in order, through every child; a button\'s label when it has no children', () => {
  expect(textOf('ab')).toBe('ab')
  expect(textOf({ type: 'Text', props: {}, children: ['a', { type: 'Text', props: { dimColor: true }, children: ['b', 'c'] }] })).toBe('abc')
  expect(textOf({ type: 'Box', props: {}, children: [{ type: 'Button', props: { label: 'x' } }, { type: 'Text', children: ['y'] }] })).toBe('xy')
  expect(textOf(undefined)).toBe('')
  expect(textOf(false)).toBe('')
})

test('the room left: the pane less 4 cells of footer padding, 2 spare and the cells used, up to the cap; none under 4', () => {
  // The hint line sits in the footer box, 2 cells of padding each side (Claude Code 2.1.330: Tdt=2, Rr=Tr-2*$n), so it
  // has 4 cells fewer than the viewport the mod is told.
  expect(roomOf(115, 89, FLEX_MAX)).toBe(20)
  expect(roomOf(300, 89, FLEX_MAX)).toBe(33)
  expect(roomOf(100, 89, FLEX_MAX)).toBe(5)
  expect(roomOf(98, 89, FLEX_MAX)).toBe(0)
  expect(roomOf(undefined, 89, FLEX_MAX)).toBe(33)
  expect(roomOf(0, 89, FLEX_MAX)).toBe(33)
  expect(roomOf(84, 64, FOLDER_MAX)).toBe(14)
})
