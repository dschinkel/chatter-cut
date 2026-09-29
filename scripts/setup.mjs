import { spawnSync } from 'node:child_process'

function run(cmd,args,opts={}) {
  console.log(`\n> ${cmd} ${args.join(' ')}`)
  const r=spawnSync(cmd,args,{stdio:'inherit',...opts})
  if (r.error?.code === 'ENOENT') {
    console.error(`\nMissing ${cmd}.`)
    process.exit(2)
  }
  if (r.status !== 0) process.exit(r.status ?? 1)
}

console.log('Local Voice Remover setup')
console.log('Video/audio stays on this computer. Internet is only needed to install dependencies/models.')

run('pnpm',['install','--frozen-lockfile=false'])
run('uv',['python','install','3.12'])
run('uv',['sync','--python','3.12'])
run('uv',['run','python','-c','import sys,numpy,torch,demucs; print("Python",sys.version.split()[0]); print("NumPy",numpy.__version__); print("PyTorch",torch.__version__); print("Demucs import OK")'])
run('ffmpeg',['-version'])
console.log('\nSetup complete. Run: pnpm doctor && pnpm dev')
