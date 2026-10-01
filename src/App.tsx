import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, AudioLines, CheckCircle2, Clock3, Download, Loader2, RotateCcw, Scissors, ShieldCheck, Terminal, Upload, Video } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { BackgroundPicker, type BackgroundStyle } from '@/components/BackgroundPicker'
import { WaveBackdrop } from '@/components/WaveBackdrop'
import { VoiceTimeline } from '@/components/VoiceTimeline'
import { WindCleanupControl } from '@/components/WindCleanupControl'
import type { VoiceSegment } from '@/voice-segments'
import { AUDIO_PROCESSING_VERSION } from '@/audio-processing-version'
import { FOREGROUND_RANGE_STORAGE_KEY, parseSavedForegroundRange } from '@/processing-settings'

type Job = {
  id: string
  status: 'uploading'|'queued'|'probing'|'preflight'|'extracting'|'separating'|'filtering'|'muxing'|'done'|'error'
  progress: number
  message: string
  outputUrl?: string
  previewUrl?: string
  previewStatus?: 'preparing'|'ready'|'error'
  mode?: 'all'|'foreground'
  foregroundRange?: number
  windReduction?: boolean
  windDetected?: boolean
  windSeconds?: number
  error?: string
  logs?: string[]
  etaSeconds?: number
  durationSeconds?: number
  originalVoiceSegments?: VoiceSegment[]
  originalVoiceLevels?: number[]
  processedVoiceSegments?: VoiceSegment[]
  processedVoiceLevels?: number[]
  friendlyError?: { tag: string; message: string }
}

const labels: Record<Job['status'], string> = { uploading:'Uploading video', queued:'Preparing', probing:'Inspecting source', preflight:'Checking disk space', extracting:'Extracting audio', separating:'Separating voice with AI', filtering:'Filtering foreground voice', muxing:'Rebuilding video', done:'Complete', error:'Failed' }
const formatEta = (seconds?: number) => seconds == null ? 'Calculating…' : seconds < 60 ? `~${Math.max(1,seconds)} sec remaining` : `~${Math.ceil(seconds/60)} min remaining`
const BACKGROUND_STORAGE_KEY = 'chatter-cut:background:v2'

export default function App(){
  const [backgroundStyle, setBackgroundStyle] = useState<BackgroundStyle>(() => {
    try { return localStorage.getItem(BACKGROUND_STORAGE_KEY) === 'color' ? 'color' : 'mono' }
    catch { return 'mono' }
  })
  useEffect(() => {
    try { localStorage.setItem(BACKGROUND_STORAGE_KEY, backgroundStyle) } catch {}
  }, [backgroundStyle])
  const [file,setFile]=useState<File|null>(null),[job,setJob]=useState<Job|null>(null),[drag,setDrag]=useState(false),[currentTime,setCurrentTime]=useState(0),[mode,setMode]=useState<'all'|'foreground'>('foreground'),[foregroundRange,setForegroundRange]=useState(()=>{try{return parseSavedForegroundRange(localStorage.getItem(FOREGROUND_RANGE_STORAGE_KEY))}catch{return 75}})
  const [windReduction,setWindReduction]=useState(false)
  useEffect(()=>{try{localStorage.setItem(FOREGROUND_RANGE_STORAGE_KEY,String(foregroundRange))}catch{}},[foregroundRange])
  const [browserPlaybackIssue,setBrowserPlaybackIssue]=useState(false),[usePreview,setUsePreview]=useState(false)
  const input=useRef<HTMLInputElement>(null),consoleRef=useRef<HTMLDivElement>(null),videoRef=useRef<HTMLVideoElement>(null),processedVideoRef=useRef<HTMLVideoElement>(null),stallTimer=useRef<ReturnType<typeof setTimeout>|null>(null)
  const source=useMemo(()=>file?URL.createObjectURL(file):'',[file])
  useEffect(()=>()=>{if(source)URL.revokeObjectURL(source)},[source])
  useEffect(()=>()=>{if(stallTimer.current)clearTimeout(stallTimer.current)},[])
  useEffect(()=>{if(browserPlaybackIssue&&job?.previewUrl)setUsePreview(true)},[browserPlaybackIssue,job?.previewUrl])
  useEffect(()=>{if(!job||!job.id||(['done','error'].includes(job.status)&&job.previewStatus!=='preparing'))return;const t=setInterval(async()=>{try{const r=await fetch(`/api/jobs/${job.id}`);if(r.ok)setJob(await r.json())}catch{}},700);return()=>clearInterval(t)},[job?.id,job?.status,job?.previewStatus])
  useEffect(()=>{const el=consoleRef.current;if(el)el.scrollTop=el.scrollHeight},[job?.logs?.length])
  const choose=(f?:File)=>{if(f&&f.type.startsWith('video/')){setFile(f);setJob(null);setCurrentTime(0);setBrowserPlaybackIssue(false);setUsePreview(false)}}
  const clearStall=()=>{if(stallTimer.current){clearTimeout(stallTimer.current);stallTimer.current=null}}
  const watchStall=()=>{clearStall();if(!usePreview)stallTimer.current=setTimeout(()=>setBrowserPlaybackIssue(true),5000)}
  const seek=(seconds:number)=>{if(videoRef.current){videoRef.current.currentTime=seconds}setCurrentTime(seconds)}
  const seekProcessed=(seconds:number)=>{if(processedVideoRef.current){processedVideoRef.current.currentTime=seconds}setCurrentTime(seconds)}
  const startProcessing=async()=>{
    try {
      const response=await fetch('/api/health')
      if(!response.ok)throw new Error('Processor unavailable')
      const health=await response.json()
      if(health.audioProcessingVersion!==AUDIO_PROCESSING_VERSION){
        setJob({id:'',status:'error',progress:0,message:'Restart the local processor',friendlyError:{tag:'Processor needs a restart',message:'The local processor is running an older voice filter. Stop the app in Terminal and run ./start.sh again before processing.'}})
        return
      }
      process()
    }catch{
      setJob({id:'',status:'error',progress:0,message:'Processor unavailable',friendlyError:{tag:'Connection',message:'Could not reach the local processing server. Start the app with ./start.sh and try again.'}})
    }
  }
  const process=()=>{if(!file)return;const started=Date.now();setJob({id:'',status:'uploading',progress:1,message:'Starting upload…',mode,foregroundRange,windReduction,logs:['[upload] Starting local upload…']});const data=new FormData();data.append('video',file);data.append('mode',mode);data.append('foregroundRange',String(foregroundRange));data.append('windReduction',String(windReduction));const xhr=new XMLHttpRequest();xhr.open('POST','/api/remove-voice');xhr.upload.onprogress=e=>{if(e.lengthComputable){const percent=Math.max(1,Math.min(99,Math.round((e.loaded/e.total)*100)));const elapsed=(Date.now()-started)/1000;const eta=percent>2?Math.max(1,Math.round((elapsed/percent)*(100-percent))):undefined;setJob(j=>({...j!,status:'uploading',progress:percent,message:`Uploading video… ${percent}%`,etaSeconds:eta}))}};xhr.onerror=()=>setJob(j=>({...j!,status:'error',progress:0,message:'Upload failed',friendlyError:{tag:'Connection',message:'Could not reach the local processing server. Make sure pnpm dev is running.'},error:'Could not reach the local processing server on port 8787.'}));xhr.onload=()=>{let body:any={};try{body=JSON.parse(xhr.responseText)}catch{}if(xhr.status<200||xhr.status>=300){setJob(j=>({...j!,status:'error',progress:0,message:'Upload failed',logs:[...(j?.logs||[]),`[server] HTTP ${xhr.status}: ${body.error||xhr.statusText||'Upload failed'}`,...(body.detail&&body.detail!==body.error?[`[server] ${body.detail}`]:[])],friendlyError:{tag:'Upload failed',message:body.error||`The local server returned HTTP ${xhr.status}.`},error:body.detail||body.error||`Server returned HTTP ${xhr.status}`}));return}setJob(body as Job)};xhr.send(data)}
  const reset=()=>{clearStall();setFile(null);setJob(null);setCurrentTime(0);setBrowserPlaybackIssue(false);setUsePreview(false);if(input.current)input.current.value=''}
  const consolePanel=<div className="min-w-0 rounded-xl border bg-black/80"><div className="flex items-center justify-between border-b border-white/10 px-4 py-3"><div className="flex items-center gap-2 text-sm font-medium text-white"><Terminal className="h-4 w-4"/>Processing console</div><span className="text-xs text-white/50">FFmpeg / Demucs</span></div><div ref={consoleRef} className="h-[520px] overflow-auto p-4 font-mono text-xs leading-5 text-white whitespace-pre-wrap break-all">{job?.logs?.length?job.logs.join('\n'):'Output will appear here when processing starts.'}</div></div>
  return <main className="app-shell min-h-screen" data-background={backgroundStyle}>
        <WaveBackdrop monochrome={backgroundStyle === 'mono'} />
        <div className="mx-auto max-w-7xl px-5 py-10 md:py-16"><header className="mb-10 flex flex-wrap items-center justify-between gap-4"><div className="flex items-center gap-3"><Scissors className="h-10 w-10 shrink-0 -rotate-12 text-white" strokeWidth={2.25} aria-hidden="true" /><h1 className="brand-title">Chatter Cut</h1></div><div className="flex flex-wrap items-center gap-4"><BackgroundPicker value={backgroundStyle} onChange={setBackgroundStyle} /><div className="hidden items-center gap-2 text-sm text-muted-foreground sm:flex"><ShieldCheck className="h-4 w-4"/>100% local processing</div></div></header>
  <section className="mb-8 text-center"><h2 className="hero-title">Remove voice from <span className="text-primary">video.</span></h2><p className="hero-description">Keep the video. Lose the chatter.</p></section>
  <div className="workspace-panel rounded-2xl border bg-card/90 p-4 shadow-2xl backdrop-blur md:p-7">{!file?<div onDragOver={e=>{e.preventDefault();setDrag(true)}} onDragLeave={()=>setDrag(false)} onDrop={e=>{e.preventDefault();setDrag(false);choose(e.dataTransfer.files[0])}} onClick={()=>input.current?.click()} className={`cursor-pointer rounded-xl border-2 border-dashed p-12 text-center transition md:p-20 ${drag?'border-primary bg-primary/10':'border-border hover:border-primary/60 hover:bg-muted/30'}`}><input ref={input} className="hidden" type="file" accept="video/*" onChange={e=>choose(e.target.files?.[0])}/><div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/15"><Upload className="h-8 w-8 text-primary"/></div><h3 className="text-xl font-semibold">Drop your video here</h3><p className="mt-2 text-sm text-muted-foreground">or click to choose a file · MP4, MOV, M4V, WebM</p></div>:<div className="space-y-6"><div className="flex flex-col gap-4 rounded-xl bg-muted/40 p-4 sm:flex-row sm:items-center"><div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/15"><Video className="text-primary"/></div><div className="min-w-0 flex-1"><p className="truncate font-medium">{file.name}</p><p className="text-sm text-muted-foreground">{(file.size/1024/1024).toFixed(1)} MB</p></div>{!job&&<Button variant="ghost" size="sm" onClick={reset}><RotateCcw className="h-4 w-4"/>Change</Button>}</div>
  <div className={`grid gap-5 ${job?'lg:grid-cols-[minmax(0,1.25fr)_minmax(360px,.75fr)]':''}`}><div className="min-w-0 space-y-5">{!job&&<div className="space-y-4 rounded-xl border bg-muted/20 p-4"><div><div className="text-sm font-semibold">Removal mode</div><div className="mt-2 grid gap-2 sm:grid-cols-2"><button type="button" onClick={()=>setMode('foreground')} className={`rounded-lg border p-3 text-left text-sm ${mode==='foreground'?'border-primary bg-primary/10':'hover:bg-muted/40'}`}><b className="block">Foreground / closest voices</b><span className="text-xs text-muted-foreground">Remove only the most prominent speech and preserve quieter/distant voices.</span></button><button type="button" onClick={()=>setMode('all')} className={`rounded-lg border p-3 text-left text-sm ${mode==='all'?'border-primary bg-primary/10':'hover:bg-muted/40'}`}><b className="block">Remove all voices</b><span className="text-xs text-muted-foreground">Existing Demucs behavior: remove the complete vocal stem.</span></button></div></div>{mode==='foreground'&&<div><div className="mb-2 flex items-center justify-between gap-3"><label htmlFor="foreground-range" className="text-sm font-medium">Foreground voice range</label><span className="rounded-md border bg-background px-2 py-1 text-sm tabular-nums">{foregroundRange}%</span></div><input id="foreground-range" type="range" min="0" max="100" step="1" value={foregroundRange} onChange={e=>setForegroundRange(Number(e.target.value))} className="w-full accent-current"/><div className="mt-1 flex justify-between text-xs text-muted-foreground"><span>Near only</span><span>Broad</span></div><p className="mt-2 text-xs text-muted-foreground">Start at 75% for voices that are very loud or close to the camera. Adjust up if the voice remains, or down if voices you want to keep are being removed.</p></div>}<WindCleanupControl enabled={windReduction} onChange={setWindReduction}/></div>}{job&&<div aria-label="Applied processing settings" className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border bg-muted/20 px-4 py-3 text-sm"><span>{(job.mode??mode)==='all'?'Removal mode: All voices':<>Voice removal range: <strong className="text-primary tabular-nums">{job.foregroundRange??foregroundRange}%</strong></>}</span><span className="text-muted-foreground">Wind cleanup: {(job.windReduction??windReduction)?job.windDetected===true?`${Math.round(job.windSeconds||0)} sec of likely rumble reduced`:job.windDetected===false?'No likely wind rumble detected':'Enabled':'Off'}</span></div>}<div className="space-y-3">
    <div className="flex items-center justify-between"><span className="text-sm font-semibold">Original video</span><span className="text-xs text-muted-foreground">source</span></div>
    <video key={usePreview?'preview':'source'} ref={videoRef} onTimeUpdate={e=>setCurrentTime(e.currentTarget.currentTime)} onWaiting={watchStall} onStalled={watchStall} onPlaying={clearStall} onPause={clearStall} onCanPlay={clearStall} onError={()=>setBrowserPlaybackIssue(true)} onLoadedMetadata={e=>{if(usePreview&&currentTime>0)e.currentTarget.currentTime=Math.min(currentTime,e.currentTarget.duration||currentTime)}} className="max-h-[420px] w-full rounded-xl bg-black" controls preload="metadata" src={usePreview&&job?.previewUrl?job.previewUrl:source}/>
    {job?.previewUrl&&<button type="button" className="text-xs text-primary underline underline-offset-2" onClick={()=>{clearStall();setUsePreview(value=>!value)}}>{usePreview?'Use original file':'Play browser-compatible preview'}</button>}
    {browserPlaybackIssue&&!job?.previewUrl&&<p className="text-xs text-muted-foreground" role="status">The browser is having trouble playing this video. {job?.previewStatus==='preparing'?'A smaller preview is being prepared locally.':job?.previewStatus==='error'?'The browser preview could not be created. Open the original in a desktop video player.':'Start processing to create a browser-compatible preview.'}</p>}
    {job&&<VoiceTimeline title="Original — Voice Detected" subtitle="click to seek" duration={job.durationSeconds||0} levels={job.originalVoiceLevels||[]} segments={job.originalVoiceSegments||[]} currentTime={currentTime} onSeek={seek}/>}
  </div>
  {job?.status==='done'&&job.outputUrl&&<div className="space-y-3 rounded-xl border bg-muted/10 p-3">
    <div className="flex items-center justify-between"><span className="text-sm font-semibold">Processed video — Voice Removed</span><span className="text-xs text-muted-foreground">generated output</span></div>
    <video ref={processedVideoRef} onTimeUpdate={e=>setCurrentTime(e.currentTarget.currentTime)} className="max-h-[420px] w-full rounded-xl bg-black" controls preload="metadata" src={job.outputUrl}/>
    <VoiceTimeline title="Processed — Voice Changes" subtitle="click to seek" duration={job.durationSeconds||0} levels={job.processedVoiceLevels||[]} segments={job.processedVoiceSegments||[]} original={{levels:job.originalVoiceLevels||[],segments:job.originalVoiceSegments||[]}} currentTime={currentTime} onSeek={seekProcessed}/>
  </div>}
  {job&&job.status!=='done'&&<VoiceTimeline title="Processed — Voice Changes" subtitle="available when processing completes" duration={job.durationSeconds||0} levels={[]} segments={[]} original={{levels:job.originalVoiceLevels||[],segments:job.originalVoiceSegments||[]}} currentTime={currentTime} onSeek={()=>{}} pending/>} {job&&<div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/30 px-4 py-3"><div className="flex items-center gap-2"><Clock3 className="h-4 w-4 text-primary"/><span className="text-sm font-medium">Estimated time</span></div><span className="text-sm tabular-nums text-muted-foreground">{job.status==='done'?'Complete':job.status==='error'?'Stopped':formatEta(job.etaSeconds)}</span></div>}
  {!job&&<Button className="w-full" size="lg" onClick={startProcessing}><AudioLines/>Remove Voice</Button>}
  {job&&job.status!=='done'&&job.status!=='error'&&<div className="py-3" aria-live="polite"><div className="mb-4 flex items-center justify-between"><div className="flex items-center gap-3"><Loader2 className="h-5 w-5 animate-spin text-primary"/><span className="font-medium">{labels[job.status]}</span></div><span className="text-sm text-muted-foreground">{job.progress}%</span></div><Progress value={job.progress}/><p className="mt-3 text-sm text-muted-foreground">{job.message}</p></div>}
  {job?.status==='error'&&<div className="rounded-xl border border-red-900/60 bg-red-950/30 p-5"><div className="mb-2 flex items-center gap-2"><AlertTriangle className="h-5 w-5"/><span className="rounded-full border px-2.5 py-1 text-xs font-semibold">{job.friendlyError?.tag||'Processing failed'}</span></div><p className="text-sm">{job.friendlyError?.message||'The video could not be processed. Check the processing console for details.'}</p><Button className="mt-4" variant="outline" onClick={reset}>Start over</Button></div>}
  {job?.status==='done'&&job.outputUrl&&<div className="space-y-4"><div className="flex items-center gap-2 text-sm font-medium"><CheckCircle2 className="h-5 w-5 text-primary"/>Voice-removed video is ready</div><p className="text-sm text-muted-foreground">Original resolution, FPS and encoded video stream are preserved — including 4K sources — with no video re-encoding.</p><div className="flex gap-3"><Button asChild className="flex-1" size="lg"><a href={job.outputUrl} download><Download/>Download {file?.name.toLowerCase().endsWith('.mov')?'MOV':'Video'}</a></Button><Button variant="outline" size="lg" onClick={reset}><RotateCcw/></Button></div></div>}</div>{job&&consolePanel}</div></div>}</div>
  <div className="mt-5 grid gap-3 text-sm text-muted-foreground sm:grid-cols-3"><div className="rounded-xl border bg-card/60 p-4"><b className="block text-foreground">1. Extract</b>FFmpeg extracts lossless audio.</div><div className="rounded-xl border bg-card/60 p-4"><b className="block text-foreground">2. Separate</b>Demucs isolates the vocal stem and maps vocal activity.</div><div className="rounded-xl border bg-card/60 p-4"><b className="block text-foreground">3. Rebuild</b>Original video stream is copied bit-for-bit; only audio is replaced.</div></div></div></main>
}
