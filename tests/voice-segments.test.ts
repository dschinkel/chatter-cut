import assert from 'node:assert/strict'
import test from 'node:test'
import { getRemovedVoiceSegments } from '../src/voice-segments.ts'

test('marks every original voice region removed when no voice remains', () => {
  assert.deepEqual(getRemovedVoiceSegments([{ start: 1, end: 3 }, { start: 5, end: 8 }], []), [{ start: 1, end: 3 }, { start: 5, end: 8 }])
})

test('does not mark unchanged voice or original silence as removed', () => {
  assert.deepEqual(getRemovedVoiceSegments([{ start: 1, end: 3 }], [{ start: 0, end: 4 }]), [])
  assert.deepEqual(getRemovedVoiceSegments([], [{ start: 1, end: 3 }]), [])
})

test('splits removal around retained voice within a region', () => {
  assert.deepEqual(getRemovedVoiceSegments([{ start: 1, end: 9 }], [{ start: 2, end: 3 }, { start: 5, end: 7 }]), [
    { start: 1, end: 2 }, { start: 3, end: 5 }, { start: 7, end: 9 },
  ])
})

test('handles overlapping, unsorted regions without duplicate removal', () => {
  const original = [{ start: 4, end: 8 }, { start: 1, end: 5 }]
  const remaining = [{ start: 4, end: 6 }, { start: 2, end: 4 }]
  assert.deepEqual(getRemovedVoiceSegments(original, remaining), [{ start: 1, end: 2 }, { start: 6, end: 8 }])
  assert.deepEqual(original, [{ start: 4, end: 8 }, { start: 1, end: 5 }])
})

test('keeps adjacent boundaries and disjoint silent gaps separate', () => {
  assert.deepEqual(getRemovedVoiceSegments([{ start: 0, end: 2 }, { start: 4, end: 6 }], [{ start: 2, end: 4 }]), [
    { start: 0, end: 2 }, { start: 4, end: 6 },
  ])
})
