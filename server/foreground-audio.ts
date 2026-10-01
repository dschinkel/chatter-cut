import { Buffer } from 'node:buffer'

const FRAME_SECONDS = 0.02
const CONTROL_RATE = 1000

export function readPcm16WaveHeader(buffer: Buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Expected PCM16 vocal WAV')
  let channels = 0, sampleRate = 0, dataStart = -1, dataSize = 0
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const size = buffer.readUInt32LE(offset + 4), body = offset + 8
    const id = buffer.toString('ascii', offset, offset + 4)
    if (id === 'fmt ') {
      if (size < 16 || buffer.readUInt16LE(body) !== 1 || buffer.readUInt16LE(body + 14) !== 16) throw new Error('Expected PCM16 vocal WAV')
      channels = buffer.readUInt16LE(body + 2)
      sampleRate = buffer.readUInt32LE(body + 4)
    }
    if (id === 'data') { dataStart = body; dataSize = Math.min(size, buffer.length - body); break }
    offset = body + size + size % 2
  }
  if (!channels || !sampleRate || dataStart < 0) throw new Error('Vocal WAV has no usable PCM data')
  const samples = Math.floor(dataSize / (channels * 2))
  return { channels, sampleRate, dataStart, samples }
}

export function readVocalRms(buffer: Buffer) {
  const { channels, sampleRate, dataStart, samples } = readPcm16WaveHeader(buffer)
  const windowSamples = Math.max(1, Math.round(sampleRate * FRAME_SECONDS))
  const rms: number[] = []
  for (let start = 0; start < samples; start += windowSamples) {
    const end = Math.min(samples, start + windowSamples)
    let strongest = 0
    for (let channel = 0; channel < channels; channel++) {
      let energy = 0
      for (let frame = start; frame < end; frame++) {
        const value = buffer.readInt16LE(dataStart + (frame * channels + channel) * 2) / 32768
        energy += value * value
      }
      strongest = Math.max(strongest, Math.sqrt(energy / (end - start)))
    }
    rms.push(strongest)
  }
  return { rms, duration: samples / sampleRate, frameSeconds: windowSamples / sampleRate }
}

export function buildForegroundControl(rms: readonly number[], range: number, frameSeconds = FRAME_SECONDS) {
  const breadth = Math.max(0, Math.min(100, range))
  const sorted = rms.filter(value => Number.isFinite(value) && value > 0).sort((a, b) => a - b)
  const percentile = (values: number[], fraction: number) => values[Math.floor((values.length - 1) * fraction)] || 0
  const noise = Math.min(percentile(sorted, 0.2), percentile(sorted, 0.95) * 0.1)
  const audibleFloor = Math.max(0.00003, noise * 2)
  const audible = sorted.filter(value => value > audibleFloor)
  const reference = percentile(audible, 0.95)
  // Calibrate to this recording, rather than an absolute dBFS threshold.
  const threshold = Math.max(audibleFloor * 1.5, reference * 10 ** (-(3 + breadth * 0.2) / 20))
  const releaseThreshold = Math.max(audibleFloor, threshold * 0.4)
  const gains = new Float32Array(rms.length).fill(1)
  const preRoll = Math.ceil(0.12 / frameSeconds)
  const hold = Math.ceil(0.3 / frameSeconds)
  const fade = Math.ceil(0.12 / frameSeconds)
  if (breadth === 100) gains.fill(0)
  else if (reference > audibleFloor) {
    for (let index = 0; index < rms.length; index++) {
      if (rms[index] < threshold) continue
      const start = Math.max(0, index - preRoll)
      let lastVoice = index
      while (index + 1 < rms.length && index - lastVoice < hold) {
        index++
        if (rms[index] >= releaseThreshold) lastVoice = index
      }
      const end = Math.min(rms.length - 1, lastVoice + hold)
      // Mute the entire selected phrase, including quiet consonants and pauses.
      for (let frame = start; frame <= end; frame++) gains[frame] = 0
      for (let step = 1; step <= fade; step++) {
        if (start - step >= 0) gains[start - step] = Math.min(gains[start - step], step / fade)
        if (end + step < gains.length) gains[end + step] = Math.min(gains[end + step], step / fade)
      }
    }
  }
  return {
    gains, thresholdDb: 20 * Math.log10(threshold),
    suppressedSeconds: Array.from(gains).reduce((sum, gain) => sum + (1 - gain) * frameSeconds, 0),
  }
}

export function encodeGainWave(gains: Float32Array, duration: number, frameSeconds = FRAME_SECONDS): Buffer {
  const samples = Math.ceil(duration * CONTROL_RATE)
  const result = Buffer.alloc(44 + samples * 4)
  result.write('RIFF', 0); result.writeUInt32LE(result.length - 8, 4); result.write('WAVEfmt ', 8)
  result.writeUInt32LE(16, 16); result.writeUInt16LE(3, 20); result.writeUInt16LE(1, 22)
  result.writeUInt32LE(CONTROL_RATE, 24); result.writeUInt32LE(CONTROL_RATE * 4, 28)
  result.writeUInt16LE(4, 32); result.writeUInt16LE(32, 34); result.write('data', 36)
  result.writeUInt32LE(samples * 4, 40)
  for (let sample = 0; sample < samples; sample++) {
    const position = sample / CONTROL_RATE / frameSeconds
    const frame = Math.min(gains.length - 1, Math.floor(position))
    const next = Math.min(gains.length - 1, frame + 1)
    const gain = gains.length ? gains[frame] + (gains[next] - gains[frame]) * (position - Math.floor(position)) : 1
    result.writeFloatLE(gain, 44 + sample * 4)
  }
  return result
}

// Duplicate the mono gain into both channels before multiplication, so stereo
// voices are attenuated equally. Compensate the limiter delay to retain sync.
export const FOREGROUND_FILTER = '[2:a]aresample=44100,pan=stereo|c0=c0|c1=c0[gain];[1:a][gain]amultiply,asplit=2[kept][analysis];[0:a][kept]amix=inputs=2:normalize=0:duration=first,alimiter=limit=0.98:level=0:latency=1[out]'

// Repair brief impulses using adjacent audio. Overlap-save preserves samples
// outside detected clicks, including continuous high-frequency field sounds.
export const CAMERA_CLICK_FILTER = 'adeclick=window=55:overlap=75:arorder=2:threshold=1.5:burst=2:method=save'
