import assert from 'node:assert/strict'
import test from 'node:test'
import { parseSavedForegroundRange } from '../src/processing-settings.ts'

test('remembers the chosen range, including zero, and defaults to 75 for invalid saved settings', () => {
  for (const range of [0, 50, 75, 100]) assert.equal(parseSavedForegroundRange(String(range)), range)
  for (const value of [null, '', 'oops', '-1', '101', 'Infinity']) assert.equal(parseSavedForegroundRange(value), 75)
})
