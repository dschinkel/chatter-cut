import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { nextReleaseVersion, planRelease, releaseTags } from '../scripts/release-version.mjs'

test('stable release tags sort numerically and ignore unrelated or prerelease tags', () => {
  assert.deepEqual(releaseTags(['v1.9.0', 'v1.10.0', 'v2.0.0', 'v1.10.0-beta.1', 'preview', 'v01.0.0']), ['v1.9.0', 'v1.10.0', 'v2.0.0'])
})

test('every push gets a release with the highest applicable semantic version bump', () => {
  assert.equal(nextReleaseVersion(undefined, ['feat: add releases']), 'v1.1.0')
  assert.equal(nextReleaseVersion('v1.1.0', ['Improve audio cleanup', 'docs: update README']), 'v1.1.1')
  assert.equal(nextReleaseVersion('v1.1.0', ['fix: repair audio', 'feat(wind): add cleanup']), 'v1.2.0')
  assert.equal(nextReleaseVersion('v1.1.0', ['feat: add option', 'fix(api)!: replace processing protocol']), 'v2.0.0')
  assert.equal(nextReleaseVersion('v1.1.0', ['Change API\n\nBREAKING CHANGE: require a new format']), 'v2.0.0')
  assert.equal(nextReleaseVersion('v1.1.0', ['docs: describe commit syntax\n\nfeat: example subject']), 'v1.1.1')
  assert.throws(() => nextReleaseVersion('bad', []))
})

test('release planning uses pushed commits, preserves versions on reruns, and avoids tag collisions', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'chatter-release-test-'))
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
  try {
    git('init', '--quiet')
    git('config', 'user.name', 'Release test')
    git('config', 'user.email', 'release@example.com')
    git('commit', '--quiet', '--allow-empty', '-m', 'Initial application')
    const before = git('rev-parse', 'HEAD')
    assert.equal(planRelease({ cwd }).tag, 'v1.1.0')
    git('tag', 'v1.1.0')
    git('commit', '--quiet', '--allow-empty', '-m', 'feat: add wind cleanup')
    const feature = git('rev-parse', 'HEAD')
    assert.equal(planRelease({ cwd, before }).tag, 'v1.2.0')
    assert.match(planRelease({ cwd, before }).notes, /add wind cleanup/)
    git('tag', 'v1.2.0')
    assert.equal(planRelease({ cwd, before }).tag, 'v1.2.0', 'reruns must reuse the published tag')
    git('commit', '--quiet', '--allow-empty', '-m', 'Fix playback')
    assert.equal(planRelease({ cwd, before: feature }).tag, 'v1.2.1')
    git('tag', 'v1.2.1')
    git('checkout', '--quiet', before)
    git('commit', '--quiet', '--allow-empty', '-m', 'Repair old queued push')
    assert.equal(planRelease({ cwd, before }).tag, 'v1.2.2', 'new versions must not collide with newer history')
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})
