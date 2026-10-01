import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const versionPattern = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

export function releaseTags(tags) {
  return tags.filter(tag => versionPattern.test(tag)).sort((left, right) => {
    const a = left.slice(1).split('.').map(Number)
    const b = right.slice(1).split('.').map(Number)
    return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
  })
}

export function nextReleaseVersion(previous, messages, initialVersion = '1.1.0') {
  if (!previous) {
    if (!versionPattern.test(`v${initialVersion}`)) throw new Error('Initial version must be MAJOR.MINOR.PATCH')
    return `v${initialVersion}`
  }
  if (!versionPattern.test(previous)) throw new Error('Previous release must be vMAJOR.MINOR.PATCH')
  const [major, minor, patch] = previous.slice(1).split('.').map(Number)
  if (messages.some(message => /^\w+(?:\([^\r\n)]+\))?!: /.test(message.trimStart()) || /^BREAKING[ -]CHANGE: /m.test(message))) return `v${major + 1}.0.0`
  if (messages.some(message => /^feat(?:\([^\r\n)]+\))?: /.test(message.trimStart()))) return `v${major}.${minor + 1}.0`
  return `v${major}.${minor}.${patch + 1}`
}

export function planRelease({ cwd = process.cwd(), before = process.env.RELEASE_BEFORE } = {}) {
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
  const tags = releaseTags(git('tag', '--list').split('\n'))
  const current = releaseTags(git('tag', '--points-at', 'HEAD').split('\n')).at(-1)
  const previous = tags.filter(tag => tag !== current).at(-1)
  // Use an ancestor for notes, but allocate versions above all existing tags.
  // This also handles an older push reaching the release queue later.
  let base = releaseTags(git('tag', '--merged', 'HEAD').split('\n')).filter(tag => tag !== current).at(-1)
  if (before && !/^0+$/.test(before)) {
    try { git('cat-file', '-e', `${before}^{commit}`); base = before } catch { /* New/force-pushed history can lack the previous commit. */ }
  }
  const range = base ? `${base}..HEAD` : 'HEAD'
  const messages = git('log', '--format=%B%x00', range).split('\0')
  const initialVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
  const tag = current || nextReleaseVersion(previous, messages, initialVersion)
  const changes = git('log', '--format=- %s (%h)', range)
  return { tag, previous: previous || '', notes: `## Changes\n\n${changes || '- Release of the current application.'}\n` }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const release = planRelease()
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `tag=${release.tag}\n`)
  if (process.env.RELEASE_NOTES_PATH) writeFileSync(process.env.RELEASE_NOTES_PATH, release.notes)
  console.log(release.tag)
}
