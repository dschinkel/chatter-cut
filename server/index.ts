import express from 'express'
import multer from 'multer'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { homedir } from 'node:os'

interface VideoSource {
  codec?: string
  width?: number
  height?: number
  fps?: string
  pixelFormat?: string
  colorSpace?: string
  colorTransfer?: string
  colorPrimaries?: string
}

interface Job {
  id: string
  status: string
  progress: number
  message: string
  source?: VideoSource
  videoPreserved?: boolean
  outputUrl?: string
  previewUrl?: string
  previewStatus?: 'preparing' | 'ready' | 'error'
  error?: string
  logs: string[]
  startedAt: number
  etaSeconds?: number
  durationSeconds?: number
  originalVoiceSegments?: Array<{ start: number; end: number }>
  originalVoiceLevels?: number[]
  processedVoiceSegments?: Array<{ start: number; end: number }>
  processedVoiceLevels?: number[]
  friendlyError?: { tag: string; message: string }
  diskSpace?: { freeBytes: number; requiredBytes: number; inputBytes: number }
  mode?: 'all' | 'foreground'
  foregroundRange?: number
}

interface ProbeResult {
  format?: { duration?: string }
  streams?: Array<{
    codec_name?: string
    width?: number
    height?: number
    r_frame_rate?: string
    pix_fmt?: string
    color_space?: string
    color_transfer?: string
    color_primaries?: string
  }>
}

const app = express()
const port = 8787
const root = path.join(homedir(), 'Downloads', 'chatter-cut')
const uploads = path.join(root, 'uploads')
const outputs = path.join(root, 'processed-videos')
const previews = path.join(root, 'previews')
const legacyOutputs = path.resolve('.local-voice-remover', 'outputs')
const work = path.join(root, 'work')

for (const directory of [uploads, outputs, previews, work]) {
  fs.mkdirSync(directory, { recursive: true })
}

// Local-only app: do not impose an arbitrary multi-GB upload ceiling.
// Multer streams the multipart body to disk rather than holding the video in RAM.
const upload = multer({ dest: uploads })
const jobs = new Map<string, Job>()

app.use('/outputs', express.static(outputs))
app.use('/previews', express.static(previews))
// Keep previously generated video links working after changing the save folder.
app.use('/outputs', express.static(legacyOutputs))

function addLog(job: Job, source: string, text: string): void {
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    job.logs.push(`[${source}] ${line}`)
  }
  if (job.logs.length > 1200) job.logs.splice(0, job.logs.length - 1200)
}

function updateEta(job: Job): void {
  if (job.progress <= 2 || job.progress >= 100) { job.etaSeconds = job.progress >= 100 ? 0 : undefined; return }
  const elapsed = (Date.now() - job.startedAt) / 1000
  const effective = Math.max(1, job.progress - 2)
  job.etaSeconds = Math.max(1, Math.round((elapsed / effective) * (100 - job.progress)))
}

function setStage(job: Job, values: Partial<Job>): void { Object.assign(job, values); updateEta(job) }

function run(job: Job, command: string, args: string[], onLine?: (line: string) => void, logLabel?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const label = logLabel ?? command
    addLog(job, 'command', `${command} ${args.map(a => JSON.stringify(a)).join(' ')}`)
    const process = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let errorOutput = ''

    process.stdout.on('data', (data: Buffer) => { const text = data.toString(); addLog(job, label, text); onLine?.(text) })
    process.stderr.on('data', (data: Buffer) => {
      const text = data.toString()
      errorOutput += text
      addLog(job, label, text)
      onLine?.(text)
    })
    process.on('error', reject)
    process.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} exited ${code}\n${errorOutput.slice(-4000)}`))
    })
  })
}


function analyzeVocalWaveform(file: string, duration: number, targetBins = 1200): { levels: number[]; segments: Array<{ start: number; end: number }>; peak: number; noise: number; threshold: number } {
  const buffer = fs.readFileSync(file)
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Unsupported vocal WAV format')
  let offset = 12, format = 1, channels = 2, bits = 16, dataStart = -1, dataSize = 0
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4), size = buffer.readUInt32LE(offset + 4), body = offset + 8
    if (id === 'fmt ' && size >= 16) { format = buffer.readUInt16LE(body); channels = buffer.readUInt16LE(body + 2); bits = buffer.readUInt16LE(body + 14) }
    if (id === 'data') { dataStart = body; dataSize = Math.min(size, buffer.length - body); break }
    offset = body + size + (size % 2)
  }
  if (dataStart < 0) throw new Error('Vocal WAV has no data chunk')
  const bytesPerSample = bits / 8, frameBytes = bytesPerSample * channels, frames = Math.floor(dataSize / frameBytes)
  const bins = Math.max(80, Math.min(targetBins, Math.ceil(duration * 8))), framesPerBin = Math.max(1, Math.floor(frames / bins))
  const rms: number[] = []
  for (let b = 0; b < bins; b++) {
    const from = b * framesPerBin, to = b === bins - 1 ? frames : Math.min(frames, from + framesPerBin)
    let sum = 0, count = 0
    for (let frame = from; frame < to; frame += 2) {
      for (let ch = 0; ch < channels; ch++) {
        const pos = dataStart + frame * frameBytes + ch * bytesPerSample
        if (pos + bytesPerSample > buffer.length) continue
        let sample = 0
        if (format === 3 && bits === 32) sample = buffer.readFloatLE(pos)
        else if (bits === 16) sample = buffer.readInt16LE(pos) / 32768
        else if (bits === 32) sample = buffer.readInt32LE(pos) / 2147483648
        sum += sample * sample; count++
      }
    }
    rms.push(count ? Math.sqrt(sum / count) : 0)
  }
  const sorted = [...rms].sort((a,b)=>a-b), noise = sorted[Math.floor(sorted.length * 0.25)] || 0
  const peak = Math.max(...rms, 0.000001)
  // Vocal stems can be quiet, especially for field/sports recordings. Use an adaptive
  // floor instead of requiring a fixed 0.003 RMS signal.
  const threshold = Math.max(0.00015, noise * 2.0, peak * 0.012)
  const levels = rms.map(v => Math.max(0, Math.min(1, v / peak)))
  const active = rms.map(v => v >= threshold)
  // Fill very short gaps and remove isolated blips.
  for (let i=1;i<active.length-1;i++) if (!active[i] && active[i-1] && active[i+1]) active[i]=true
  const secondsPerBin = duration / bins, segments: Array<{ start: number; end: number }> = []
  let start: number | null = null
  for (let i=0;i<=active.length;i++) {
    if (i<active.length && active[i] && start==null) start=i*secondsPerBin
    if ((i===active.length || !active[i]) && start!=null) {
      const end=i*secondsPerBin
      if (end-start>=0.15) segments.push({start,end:Math.min(duration,end)})
      start=null
    }
  }
  return { levels, segments, peak, noise, threshold }
}


function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = Math.max(0, bytes)
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++ }
  return `${value.toFixed(unit >= 3 ? 1 : 0)} ${units[unit]}`
}

function estimateRequiredFreeBytes(inputBytes: number, durationSeconds?: number): number {
  // The multipart upload already exists on disk when this runs. Reserve space for:
  // extracted 44.1 kHz stereo PCM, Demucs working/output stems, the final mux,
  // a smaller browser preview,
  // model/runtime scratch space, plus a safety margin.
  const pcmBytes = durationSeconds && durationSeconds > 0
    ? durationSeconds * 44100 * 2 * 2
    : inputBytes * 0.20
  const demucsWorking = Math.max(pcmBytes * 5, inputBytes * 0.30)
  const finalMux = inputBytes * 1.05
  const browserPreview = Math.max(inputBytes * 0.12, (durationSeconds || 0) * 400000)
  const fixedSafety = 2 * 1024 ** 3
  return Math.ceil(pcmBytes + demucsWorking + finalMux + browserPreview + fixedSafety)
}

function checkDiskSpace(job: Job, input: string): void {
  const inputBytes = fs.statSync(input).size
  const disk = fs.statfsSync(root)
  const freeBytes = disk.bavail * disk.bsize
  const requiredBytes = estimateRequiredFreeBytes(inputBytes, job.durationSeconds)
  job.diskSpace = { freeBytes, requiredBytes, inputBytes }
  addLog(job, 'disk', `Input ${formatBytes(inputBytes)}; free ${formatBytes(freeBytes)}; estimated processing headroom ${formatBytes(requiredBytes)}.`)
  if (freeBytes < requiredBytes) {
    throw new Error(`INSUFFICIENT_DISK_SPACE free=${freeBytes} required=${requiredBytes} input=${inputBytes}`)
  }
}

async function processJob(job: Job, input: string, originalName: string, mode: 'all' | 'foreground', foregroundRange: number): Promise<void> {
  const directory = path.join(work, job.id)
  fs.mkdirSync(directory, { recursive: true })
  const wav = path.join(directory, 'input.wav')
  const separated = path.join(directory, 'separated')
  job.mode = mode
  job.foregroundRange = foregroundRange
  let previewTask: Promise<void> | undefined

  try {
    setStage(job, { status: 'probing', progress: 5, message: 'Reading source video quality…' })
    let probeOutput = ''
    await run(job, 'ffprobe', [
      '-v', 'error', '-select_streams', 'v:0', '-show_entries',
      'stream=codec_name,width,height,r_frame_rate,pix_fmt,color_space,color_transfer,color_primaries:format=duration',
      '-of', 'json', input,
    ], (line) => { probeOutput += line })

    try {
      const probe = JSON.parse(probeOutput) as ProbeResult
      const video = probe.streams?.[0]
      const duration = Number(probe.format?.duration)
      if (Number.isFinite(duration) && duration > 0) job.durationSeconds = duration
      if (video) {
        job.source = {
          codec: video.codec_name,
          width: video.width,
          height: video.height,
          fps: video.r_frame_rate,
          pixelFormat: video.pix_fmt,
          colorSpace: video.color_space,
          colorTransfer: video.color_transfer,
          colorPrimaries: video.color_primaries,
        }
      }
    } catch {
      // Probe metadata is informational; processing can continue if parsing fails.
    }

    setStage(job, { status: 'preflight', progress: 8, message: 'Checking available disk space…' })
    checkDiskSpace(job, input)

    // A local MOV may contain HEVC or other streams that a browser cannot play
    // reliably. Make a small H.264/AAC copy for the in-app source player while
    // the original stream remains untouched for the final output.
    job.previewStatus = 'preparing'
    const previewName = `${job.id}-original-preview.mp4`
    const previewPath = path.join(previews, previewName)
    previewTask = run(job, 'ffmpeg', [
      '-y', '-loglevel', 'error', '-i', input, '-map', '0:v:0', '-map', '0:a:0?',
      '-vf', 'fps=24,scale=960:-2', '-c:v', 'libx264', '-preset', 'ultrafast',
      '-crf', '29', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k',
      '-movflags', '+faststart', previewPath,
    ], undefined, 'ffmpeg-preview').then(() => {
      job.previewUrl = `/previews/${previewName}`
      job.previewStatus = 'ready'
    }).catch((error: unknown) => {
      job.previewStatus = 'error'
      try { fs.unlinkSync(previewPath) } catch { /* no partial preview */ }
      addLog(job, 'preview', `Browser preview failed: ${error instanceof Error ? error.message : String(error)}`)
    })

    setStage(job, { status: 'extracting', progress: 10, message: 'Extracting the audio track…' })
    await run(job, 'ffmpeg', ['-y', '-i', input, '-vn', '-ac', '2', '-ar', '44100', '-c:a', 'pcm_s16le', wav])

    setStage(job, { status: 'separating', progress: 30, message: 'AI is separating vocals from the rest of the mix…' })
    await run(job, 'uv', ['run', 'demucs', '--two-stems=vocals', '-n', 'htdemucs', '-o', separated, wav], (line) => {
      const match = line.match(/(\d+)%/)
      if (match) { job.progress = Math.min(82, 30 + Math.round(Number(match[1]) * 0.52)); updateEta(job) }
    })

    const noVocals = path.join(separated, 'htdemucs', 'input', 'no_vocals.wav')
    const vocals = path.join(separated, 'htdemucs', 'input', 'vocals.wav')
    if (!fs.existsSync(noVocals)) throw new Error('Demucs finished but no_vocals.wav was not found.')

    // Demucs may emit IEEE-float/WAVE_EXTENSIBLE stems. Normalize the vocal stem to
    // a known PCM16 format before analysis so timeline detection never depends on the
    // exact WAV encoding produced by Demucs/torchaudio.
    if (fs.existsSync(vocals) && job.durationSeconds) {
      const analysisWav = path.join(directory, 'vocals-analysis-pcm16.wav')
      await run(job, 'ffmpeg', ['-y', '-i', vocals, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', analysisWav], undefined, 'ffmpeg-analysis')
      const analysis = analyzeVocalWaveform(analysisWav, job.durationSeconds)
      job.originalVoiceLevels = analysis.levels
      job.originalVoiceSegments = analysis.segments
      job.processedVoiceLevels = analysis.levels.map(() => 0)
      job.processedVoiceSegments = []
      addLog(job, 'analysis', `Vocal detector: peak=${analysis.peak.toFixed(6)}, noise=${analysis.noise.toFixed(6)}, threshold=${analysis.threshold.toFixed(6)}.`)
      addLog(job, 'analysis', `Detected ${analysis.segments.length} vocal region(s) across ${analysis.levels.length} waveform bins for before/after comparison.`)
      if (analysis.segments.length === 0 && analysis.peak > 0.0005) {
        addLog(job, 'analysis', 'Warning: vocal audio exists but no regions crossed the adaptive threshold.')
      }
    }

    let cleanedAudio = noVocals
    if (mode === 'foreground') {
      setStage(job, { status: 'filtering', progress: 84, message: `Removing the closest/most prominent voice range (${foregroundRange}%)…` })
      const foregroundAudio = path.join(directory, 'foreground-filtered.wav')
      // A mono/stereo recording cannot reveal literal physical distance. The range dial therefore
      // controls prominence: at low values only very strong vocal energy is subtracted; as the
      // value increases, progressively quieter vocal energy is included. Demucs' non-vocal stem
      // is left untouched.
      const thresholdDb = -10 - (foregroundRange * 0.40) // 0%=-10 dB, 25%=-20 dB, 100%=-50 dB
      const thresholdLinear = Math.pow(10, thresholdDb / 20)
      const filter = `[1:a]asplit=2[vocal][gatein];[gatein]agate=threshold=${thresholdLinear.toFixed(6)}:ratio=20:attack=15:release=300,volume=-0.96[remove];[vocal][remove]amix=inputs=2:normalize=0[kept];[0:a][kept]amix=inputs=2:normalize=0,alimiter=limit=0.98[out]`
      await run(job, 'ffmpeg', ['-y', '-i', noVocals, '-i', vocals, '-filter_complex', filter, '-map', '[out]', '-c:a', 'pcm_s24le', foregroundAudio], undefined, 'ffmpeg-foreground')
      cleanedAudio = foregroundAudio
      addLog(job, 'foreground', `Range ${foregroundRange}% => prominence threshold ${thresholdDb.toFixed(1)} dB. Strong vocal energy above this gate is suppressed; quieter vocal energy is retained.`)
      if (job.originalVoiceLevels?.length) {
        const cutoff = Math.max(0.04, 0.98 - foregroundRange * 0.0092)
        job.processedVoiceLevels = job.originalVoiceLevels.map(v => v >= cutoff ? v * 0.04 : v)
        job.processedVoiceSegments = job.originalVoiceSegments?.filter(seg => {
          const mid=(seg.start+seg.end)/2, i=Math.min(job.originalVoiceLevels!.length-1, Math.floor((mid/(job.durationSeconds||1))*job.originalVoiceLevels!.length))
          return (job.originalVoiceLevels![i]||0) < cutoff
        }) || []
      }
    }

    setStage(job, { status: 'muxing', progress: 88, message: 'Putting the cleaned audio back into the original video…' })
    const parsedName = path.parse(originalName)
    const safeName = parsedName.name.replace(/[^a-z0-9_-]+/gi, '_')
    // Preserve the source container instead of forcing every result to MP4.
    // MOV gets lossless PCM audio; the video stream is always stream-copied.
    const sourceExt = parsedName.ext.toLowerCase()
    const supportedExt = new Set(['.mov', '.mp4', '.m4v', '.mkv', '.webm'])
    const outputExt = supportedExt.has(sourceExt) ? sourceExt : '.mkv'
    const outputName = `${safeName}-no-voice${outputExt}`
    const output = path.join(outputs, `${job.id}-${outputName}`)

    const muxArgs = [
      '-y', '-i', input, '-i', cleanedAudio,
      '-map', '0:v:0', '-map', '1:a:0',
      '-map_metadata', '0', '-map_chapters', '0',
      '-c:v', 'copy',
    ]

    if (outputExt === '.mov') {
      // The audio has to be regenerated because it is the part we changed, but
      // PCM keeps that regenerated audio lossless inside the MOV container.
      muxArgs.push('-c:a', 'pcm_s24le')
    } else if (outputExt === '.mkv') {
      muxArgs.push('-c:a', 'flac')
    } else if (outputExt === '.webm') {
      muxArgs.push('-c:a', 'libopus', '-b:a', '320k')
    } else {
      // MP4/M4V compatibility: PCM is not broadly supported in these containers.
      muxArgs.push('-c:a', 'aac', '-b:a', '320k')
    }

    if (outputExt === '.mov' || outputExt === '.mp4' || outputExt === '.m4v') {
      muxArgs.push('-movflags', '+faststart')
    }
    muxArgs.push('-shortest', output)
    await run(job, 'ffmpeg', muxArgs)

    setStage(job, {
      status: 'done', progress: 100,
      message: 'Complete — original video stream preserved without re-encoding.',
      videoPreserved: true,
      outputUrl: `/outputs/${path.basename(output)}`,
    })
  } catch (error: unknown) {
    const raw = error instanceof Error ? error.message : String(error)
    const lower = raw.toLowerCase()
    const diskMatch = raw.match(/INSUFFICIENT_DISK_SPACE free=(\d+) required=(\d+)/)
    const friendlyError = diskMatch ? {
        tag: 'Not enough disk space',
        message: `Processing needs about ${formatBytes(Number(diskMatch[2]))} free after the upload, but only ${formatBytes(Number(diskMatch[1]))} is available. Free disk space and try again.`
      }
      : lower.includes('no space left') ? { tag: 'Disk space', message: 'Your Mac ran out of free disk space while processing. Free some space and try again.' }
      : lower.includes('matches no streams') || lower.includes('does not contain any stream') || lower.includes('no audio') ? { tag: 'No audio track', message: 'This video does not appear to contain a usable audio track.' }
      : lower.includes('invalid data found') || lower.includes('moov atom not found') ? { tag: 'Corrupt media', message: 'FFmpeg could not read this media file. The file may be incomplete or damaged.' }
      : lower.includes('unknown decoder') || lower.includes('unsupported codec') || lower.includes('decoder') && lower.includes('not found') ? { tag: 'Unsupported codec', message: 'The video uses a codec this FFmpeg installation cannot decode.' }
      : lower.includes('ffmpeg') ? { tag: 'FFmpeg failed', message: 'FFmpeg could not complete this processing step. Check the processing console for the technical details.' }
      : lower.includes('demucs') ? { tag: 'AI separation failed', message: 'The voice-separation model could not finish. Check the processing console for details.' }
      : { tag: 'Processing failed', message: 'The video could not be processed. Check the processing console for the technical details.' }
    setStage(job, { status: 'error', message: 'Processing failed', error: raw, friendlyError })
  } finally {
    // FFmpeg must finish reading the uploaded source before it can be removed.
    await previewTask
    try { fs.unlinkSync(input) } catch { /* already removed */ }
  }
}

app.post('/api/remove-voice', (req, res, next) => {
  upload.single('video')(req, res, (error: unknown) => {
    if (error) return next(error)
    if (!req.file) return res.status(400).json({ error: 'No video uploaded.' })

    const id = crypto.randomUUID()
    const job: Job = { id, status: 'queued', progress: 2, message: 'Preparing video…', logs: [], startedAt: Date.now() }
    jobs.set(id, job)
    res.json(job)
    const mode = req.body.mode === 'all' ? 'all' : 'foreground'
    const requestedRange = Number(req.body.foregroundRange ?? 60)
    const foregroundRange = Number.isFinite(requestedRange) ? Math.max(0, Math.min(100, requestedRange)) : 60
    void processJob(job, req.file.path, req.file.originalname, mode, foregroundRange)
  })
})

/* Multipart/upload errors happen before a processing job exists. Return useful JSON
   so the React UI can display the actual problem instead of a generic HTTP 500. */
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error('[upload]', error)
  if (error instanceof multer.MulterError) {
    const friendly = error.code === 'LIMIT_FILE_SIZE'
      ? 'The selected video exceeds the configured local upload size limit.'
      : `Video upload failed (${error.code}): ${message}`
    return res.status(413).json({ error: friendly, detail: message, code: error.code })
  }
  return res.status(500).json({ error: `Local server error: ${message}`, detail: message })
})

app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id)
  if (!job) return res.status(404).json({ error: 'Job not found' })
  res.json(job)
})

app.get('/api/health', (_req, res) => res.json({ ok: true }))

// Keep an explicit reference to the HTTP server and keep stdin referenced while
// running under `tsx` + `concurrently`. This prevents the API process from
// silently falling through after startup in development.
const server = app.listen(port, '127.0.0.1', () => {
  console.log(`Local Voice Remover API: http://localhost:${port}`)
})

server.on('error', (error) => {
  console.error('[server] HTTP server error:', error)
  process.exitCode = 1
})

server.on('close', () => {
  console.log('[server] HTTP server closed')
})

process.stdin.resume()

function shutdown(signal: NodeJS.Signals): void {
  console.log(`[server] ${signal} received; shutting down.`)
  server.close((error) => {
    if (error) {
      console.error('[server] Error while shutting down:', error)
      process.exit(1)
    }
    process.exit(0)
  })
}

process.once('SIGINT', () => shutdown('SIGINT'))
process.once('SIGTERM', () => shutdown('SIGTERM'))
