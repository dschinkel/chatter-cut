import assert from 'node:assert/strict'
import test from 'node:test'
import { getRemovedVoiceSegments, getVocalEnergyReduction, getVoiceComparisonLevels } from '../src/voice-segments.ts'

test('processed waveform plots the remaining level and keeps the removed level separate', () => {
  assert.deepEqual(getVoiceComparisonLevels([0, 0.1, 0.8], [1, 0.5, 0.6]), [
    { remaining: 0, original: 1, removed: 1 },
    { remaining: 0.1, original: 0.5, removed: 0.4 },
    { remaining: 0.8, original: 0.6, removed: 0 },
  ])
  assert.deepEqual(getVoiceComparisonLevels([0, 0, 0, 0], [1, 0.5]).map(value=>value.remaining), [0, 0, 0, 0])
})

test('reports actual energy reduction even when every region retains some quiet voice', () => {
  assert.equal(getVocalEnergyReduction([1, 0.5, 0.2], [0.1, 0.05, 0.02]), 99)
  assert.equal(getVocalEnergyReduction([1, 0.5], [1, 0.5]), 0)
  assert.equal(getVocalEnergyReduction([1, 0.5], [0, 0]), 100)
  assert.equal(getVocalEnergyReduction([1], [2]), 0)
  assert.equal(getVocalEnergyReduction([0], [0]), null)
  assert.equal(getVocalEnergyReduction([1], []), null)
})

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
