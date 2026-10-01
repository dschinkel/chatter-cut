import assert from 'node:assert/strict'
import test from 'node:test'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { buildForegroundControl, CAMERA_CLICK_FILTER, encodeGainWave, FOREGROUND_FILTER, readVocalRms } from '../server/foreground-audio.ts'

function pcmWave(values: number[], sampleRate = 44100, channels = 1) {
  const buffer = Buffer.alloc(44 + values.length * 2)
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8)
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(channels, 22)
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * channels * 2, 28)
  buffer.writeUInt16LE(channels * 2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36)
  buffer.writeUInt32LE(values.length * 2, 40)
  values.forEach((value, index) => buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(value * 32768))), 44 + index * 2))
  return buffer
}

test('removes prominent phrases in quiet recordings while keeping a separate distant voice', () => {
  const rms = Array(300).fill(0.00001)
  rms.fill(0.003, 50, 100)
  rms.fill(0.00015, 100, 110) // quiet ending of the same phrase
  rms.fill(0.0001, 200, 240) // separate distant voice
  const { gains } = buildForegroundControl(rms, 75)
  assert.equal(gains[48], 0, 'covers the phrase onset')
  assert.equal(gains[80], 0, 'fully removes strong speech')
  assert.equal(gains[105], 0, 'does not restore quieter syllables')
  assert.equal(gains[220], 1, 'retains the separate distant voice')
  const quieter = buildForegroundControl(rms.map(value => value * 0.5), 75)
  assert.deepEqual(quieter.gains, gains, 'adapts when recording gain changes')
})

test('camera click cleanup removes short impulses while preserving a steady high tone and duration', t => {
  if (spawnSync('ffmpeg', ['-version']).status !== 0) { t.skip('FFmpeg is not installed'); return }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chatter-click-test-'))
  try {
    const rate = 44100
    const clean = Array.from({ length: rate * 2 }, (_, index) => 0.008 * Math.sin(2 * Math.PI * 220 * index / rate) + 0.004 * Math.sin(2 * Math.PI * 5500 * index / rate))
    const noisy = [...clean]
    for (const location of [rate / 2, rate]) {
      for (let offset = 0; offset < 4; offset++) noisy[location + offset] += offset % 2 ? -0.2 : 0.2
    }
    const cleanWave = pcmWave(clean), input = path.join(directory, 'clicks.wav'), output = path.join(directory, 'clean.raw')
    fs.writeFileSync(input, pcmWave(noisy))
    const result = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', input, '-af', CAMERA_CLICK_FILTER, '-c:a', 'pcm_f32le', '-f', 'f32le', output])
    assert.equal(result.status, 0, result.stderr.toString())
    const audio = fs.readFileSync(output)
    assert.equal(audio.length, clean.length * 4)
    for (const location of [rate / 2, rate]) {
      const errors = Array.from({ length: 4 }, (_, offset) => Math.abs(audio.readFloatLE((location + offset) * 4) - cleanWave.readInt16LE(44 + (location + offset) * 2) / 32768))
      assert.ok(Math.max(...errors) < 0.002, 'click should be reduced by at least 40 dB')
    }
    for (let index = rate * 1.5; index < rate * 1.8; index++) {
      assert.ok(Math.abs(audio.readFloatLE(index * 4) - cleanWave.readInt16LE(44 + index * 2) / 32768) < 0.000001, 'steady high tone should be preserved')
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

test('higher range removes more phrases and 100 removes the complete vocal stem', () => {
  const rms = [...Array(50).fill(0.00001), ...Array(50).fill(0.02), ...Array(60).fill(0.00001), ...Array(50).fill(0.003), ...Array(50).fill(0.00001)]
  assert.equal(buildForegroundControl(rms, 0).gains[180], 1)
  assert.equal(buildForegroundControl(rms, 75).gains[180], 0)
  assert.ok(buildForegroundControl(rms, 100).gains.every(gain => gain === 0))
  assert.ok(buildForegroundControl(Array(50).fill(0), 75).gains.every(gain => gain === 1))
  assert.ok(buildForegroundControl(Array(50).fill(0.01), 75).gains.every(gain => gain === 0))
})

test('stereo detector keeps opposite-phase speech and uses the louder channel', () => {
  const mono = Array.from({ length: 320 }, (_, index) => Math.sin(index * 0.3) * 0.01)
  const stereo = mono.flatMap(value => [value, -value])
  const expected = readVocalRms(pcmWave(mono, 16000)).rms
  assert.deepEqual(readVocalRms(pcmWave(stereo, 16000, 2)).rms, expected)
  assert.deepEqual(readVocalRms(pcmWave(mono.flatMap(value => [value, 0]), 16000, 2)).rms, expected)
})

test('FFmpeg removes selected vocals in both channels without changing background level or timing', t => {
  if (spawnSync('ffmpeg', ['-version']).status !== 0) { t.skip('FFmpeg is not installed'); return }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chatter-foreground-test-'))
  try {
    const rate = 44100, samples = rate * 5
    const background: number[] = [], vocals: number[] = []
    for (let index = 0; index < samples; index++) {
      const time = index / rate
      const amplitude = time >= 1 && time < 2 ? 0.003 : time >= 2 && time < 2.2 ? 0.0002 : time >= 3 && time < 4 ? 0.00015 : 0
      const voice = Math.sin(2 * Math.PI * 880 * time) * amplitude
      background.push(Math.sin(2 * Math.PI * 220 * time) * 0.005, Math.sin(2 * Math.PI * 330 * time) * 0.005)
      vocals.push(voice, -voice)
    }
    const backgroundWave = pcmWave(background, rate, 2), vocalWave = pcmWave(vocals, rate, 2)
    const detector = readVocalRms(vocalWave), control = buildForegroundControl(detector.rms, 75, detector.frameSeconds)
    fs.writeFileSync(path.join(directory, 'background.wav'), backgroundWave)
    fs.writeFileSync(path.join(directory, 'vocals.wav'), vocalWave)
    fs.writeFileSync(path.join(directory, 'gain.wav'), encodeGainWave(control.gains, detector.duration, detector.frameSeconds))
    const result = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(directory, 'background.wav'), '-i', path.join(directory, 'vocals.wav'), '-i', path.join(directory, 'gain.wav'), '-filter_complex', FOREGROUND_FILTER, '-map', '[out]', '-c:a', 'pcm_f32le', '-f', 'f32le', path.join(directory, 'output.raw'), '-map', '[analysis]', '-f', 'null', '-'])
    assert.equal(result.status, 0, result.stderr.toString())
    const output = fs.readFileSync(path.join(directory, 'output.raw'))
    assert.equal(output.length, samples * 2 * 4, 'retains the exact source duration')
    for (const [start, end, retainVoice] of [[1.2, 1.8, false], [2.05, 2.18, false], [3.3, 3.7, true]] as const) {
      let squaredError = 0, count = 0
      for (let index = Math.floor(start * rate) * 2; index < Math.floor(end * rate) * 2; index++) {
        const expected = backgroundWave.readInt16LE(44 + index * 2) / 32768 + (retainVoice ? vocalWave.readInt16LE(44 + index * 2) / 32768 : 0)
        squaredError += (output.readFloatLE(index * 4) - expected) ** 2
        count++
      }
      assert.ok(Math.sqrt(squaredError / count) < 0.000001, `unexpected audio change in ${start}–${end}s`)
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})
