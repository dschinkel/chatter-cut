import { spawnSync } from 'node:child_process'
const quick=process.argv.includes('--quick')
let failed=false

function check(label,cmd,args) {
  const r=spawnSync(cmd,args,{encoding:'utf8'})
  if (r.status===0) {
    const first=(r.stdout||r.stderr||'').trim().split(/\r?\n/)[0]
    console.log(`✓ ${label}${first ? ` — ${first}` : ''}`)
    return true
  }
  console.error(`✗ ${label}`)
  if (r.error?.code==='ENOENT') console.error(`  ${cmd} is not installed or not on PATH`)
  else console.error(`  ${(r.stderr||r.stdout||'').trim().split(/\r?\n/).slice(-4).join('\n  ')}`)
  failed=true
  return false
}

console.log('Local Voice Remover environment')
check('Node',process.execPath,['--version'])
check('pnpm','pnpm',['--version'])
check('FFmpeg','ffmpeg',['-version'])
check('ffprobe','ffprobe',['-version'])
check('uv','uv',['--version'])
check('Local Python + NumPy + PyTorch + Demucs','uv',['run','python','-c',
  'import sys,numpy,torch,demucs; print(f"Python {sys.version.split()[0]}, NumPy {numpy.__version__}, PyTorch {torch.__version__}")'
])
if (!quick) check('Demucs CLI','uv',['run','demucs','--help'])
if (failed) {
  console.error('\nEnvironment is not ready. Run: pnpm setup')
  process.exit(1)
}
console.log('\n✓ Environment ready — processing is local to this Mac.')
