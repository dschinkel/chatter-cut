import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { CAMERA_CLICK_FILTER, encodeGainWave } from '../server/foreground-audio.ts'
import { analyzeWindRumble, WIND_FILTER } from '../server/wind-audio.ts'

function pcmWave(values: number[], rate = 8000, channels = 1) {
  const buffer = Buffer.alloc(44 + values.length * 2)
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8)
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(channels, 22)
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2 * channels, 28)
  buffer.writeUInt16LE(2 * channels, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36)
  buffer.writeUInt32LE(values.length * 2, 40)
  values.forEach((value,index)=>buffer.writeInt16LE(Math.round(Math.max(-1,Math.min(0.999,value))*32768),44+index*2))
  return buffer
}

function windySignal(rate = 8000) {
  let seed = 42, low = 0
  return Array.from({length: rate * 6}, (_, index) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    low += 0.08 * ((seed / 2**32 * 2 - 1) - low)
    const time = index / rate
    return (time >= 1 && time < 4 ? low * 0.5 : 0) + 0.002 * Math.sin(2 * Math.PI * 900 * time)
  })
}

test('identifies sustained irregular low rumble and leaves quiet sections, high tones, and steady bass alone', () => {
  const wind = analyzeWindRumble(pcmWave(windySignal()))
  assert.ok(wind.detectedSeconds > 1, `missed wind: ${wind.detectedSeconds}s`)
  assert.equal(wind.gains[5], 1)
  assert.equal(wind.gains[55], 1)
  for (const frequency of [80, 900]) {
    const tone = Array.from({length: 8000 * 2}, (_, index)=>0.04*Math.sin(2*Math.PI*frequency*index/8000))
    assert.equal(analyzeWindRumble(pcmWave(tone)).detectedSeconds, 0, `misidentified ${frequency}Hz tone as wind`)
    assert.equal(analyzeWindRumble(pcmWave(tone.flatMap(value=>[value,0]),8000,2)).detectedSeconds, 0, `misidentified single-channel ${frequency}Hz tone as wind`)
  }
  assert.equal(analyzeWindRumble(pcmWave(Array(8000).fill(0))).detectedSeconds, 0)
})

test('wind filtering reduces rumble while preserving the high band and source duration', t => {
  if (spawnSync('ffmpeg',['-version']).status !== 0) {t.skip('FFmpeg is not installed');return}
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'chatter-wind-test-'))
  try {
    const rate = 44100
    const source = Array.from({length: rate * 2}, (_, index)=>0.1*Math.sin(2*Math.PI*50*index/rate)+0.02*Math.sin(2*Math.PI*1000*index/rate))
    fs.writeFileSync(path.join(directory,'input.wav'),pcmWave(source.flatMap(value=>[value,value]),rate,2))
    fs.writeFileSync(path.join(directory,'gain.wav'),encodeGainWave(new Float32Array(20).fill(0.1),2,0.1))
    const filter = `${WIND_FILTER};[windclean]${CAMERA_CLICK_FILTER},alimiter=limit=0.98:level=0:latency=1[clean]`
    const result = spawnSync('ffmpeg',['-y','-loglevel','error','-f','lavfi','-i','anullsrc=r=44100:cl=stereo','-i',path.join(directory,'input.wav'),'-i',path.join(directory,'gain.wav'),'-filter_complex',filter,'-map','[clean]','-c:a','pcm_f32le','-f','f32le',path.join(directory,'output.raw')])
    assert.equal(result.status,0,result.stderr.toString())
    const output = fs.readFileSync(path.join(directory,'output.raw'))
    assert.equal(output.length,rate*2*2*4)
    const amplitude = (frequency: number) => {
      let sin = 0, cos = 0, count = 0
      for(let index=rate/2;index<rate*1.5;index++){
        const value=output.readFloatLE(index*2*4)
        sin+=value*Math.sin(2*Math.PI*frequency*index/rate)
        cos+=value*Math.cos(2*Math.PI*frequency*index/rate)
        count++
      }
      return 2*Math.hypot(sin,cos)/count
    }
    assert.ok(amplitude(50)<0.015,'should reduce rumble by at least 16 dB')
    assert.ok(Math.abs(amplitude(1000)-0.02)<0.001,'should preserve the higher-frequency sound level')
  } finally {fs.rmSync(directory,{recursive:true,force:true})}
})
