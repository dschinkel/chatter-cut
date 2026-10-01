import { Buffer } from 'node:buffer'
import { readPcm16WaveHeader } from './foreground-audio.ts'

// Wind identification is a heuristic: sustained, irregular low-frequency
// energy dominating the recording. Other rumble can produce the same pattern.
export function analyzeWindRumble(buffer: Buffer) {
  const { channels, sampleRate, dataStart, samples } = readPcm16WaveHeader(buffer)
  const windowSamples = Math.max(1, Math.round(sampleRate * 0.1))
  const frameSeconds = windowSamples / sampleRate
  const omega = 2 * Math.PI * 180 / sampleRate, cosine = Math.cos(omega)
  const alpha = Math.sin(omega) / Math.SQRT2, denominator = 1 + alpha
  const b0 = (1 - cosine) / 2 / denominator, b1 = (1 - cosine) / denominator
  const a1 = -2 * cosine / denominator, a2 = (1 - alpha) / denominator
  const state = Array.from({ length: channels }, () => ({ x1: 0, x2: 0, y1: 0, y2: 0 }))
  const candidates: boolean[] = []
  for (let start = 0; start < samples; start += windowSamples) {
    const end = Math.min(samples, start + windowSamples)
    let fullEnergy = 0, lowEnergy = 0
    const channelEnergy = new Array(channels).fill(0), channelPeak = new Array(channels).fill(0)
    for (let frame = start; frame < end; frame++) {
      for (let channel = 0; channel < channels; channel++) {
        const value = buffer.readInt16LE(dataStart + (frame * channels + channel) * 2) / 32768
        const s = state[channel]
        const low = b0 * value + b1 * s.x1 + b0 * s.x2 - a1 * s.y1 - a2 * s.y2
        s.x2 = s.x1; s.x1 = value; s.y2 = s.y1; s.y1 = low
        fullEnergy += value * value; lowEnergy += low * low
        channelEnergy[channel] += low * low
        channelPeak[channel] = Math.max(channelPeak[channel], Math.abs(low))
      }
    }
    const count = (end - start) * channels
    const rms = Math.sqrt(fullEnergy / count)
    const irregular = channelEnergy.some((energy, channel) => {
      const channelRms = Math.sqrt(energy / (end - start))
      return channelRms > 0.0005 && channelPeak[channel] / channelRms > 1.8
    })
    candidates.push(rms > 0.001 && lowEnergy / Math.max(fullEnergy, 1e-12) > 0.6 && irregular)
  }
  const gains = new Float32Array(candidates.length).fill(1)
  let detectedFrames = 0
  for (let index = 0; index < candidates.length; index++) {
    if (!candidates[index]) continue
    const start = index
    while (index + 1 < candidates.length && candidates[index + 1]) index++
    if (index - start + 1 < 3) continue // skip brief footfalls and impacts
    detectedFrames += index - start + 1
    for (let frame = start; frame <= index; frame++) gains[frame] = 0.1
    for (let step = 1; step <= 3; step++) {
      const gain = 0.1 + 0.9 * step / 3
      if (start - step >= 0) gains[start - step] = Math.min(gains[start - step], gain)
      if (index + step < gains.length) gains[index + step] = Math.min(gains[index + step], gain)
    }
  }
  return { gains, frameSeconds, duration: samples / sampleRate, detectedSeconds: Math.min(samples / sampleRate, detectedFrames * frameSeconds) }
}

// The upper band stays at full level. Only the low band is reduced during
// detected rumble, with smooth fades into and out of those intervals.
export const WIND_FILTER = '[1:a]acrossover=split=180:order=4th[low][high];[2:a]aresample=44100,pan=stereo|c0=c0|c1=c0[gain];[low][gain]amultiply[reduced];[reduced][high]amix=inputs=2:normalize=0:duration=first[windclean]'
