#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'

const baseRef = `origin/${process.env.GITHUB_BASE_REF || 'main'}`
const headPackage = JSON.parse(readFileSync('package.json', 'utf8'))
const changed = execFileSync('git', ['diff', '--name-only', `${baseRef}...HEAD`], { encoding: 'utf8' }).trim().split('\n').filter(Boolean)
const headBranch = process.env.GITHUB_HEAD_REF || execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim()
const releaseBranch = /^release\/v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(headBranch)
const comparisonRef = releaseBranch ? baseRef : execFileSync('git', ['merge-base', baseRef, 'HEAD'], { encoding: 'utf8' }).trim()
const basePackage = JSON.parse(execFileSync('git', ['show', `${comparisonRef}:package.json`], { encoding: 'utf8' }))

if (!releaseBranch) {
  if (basePackage.version !== headPackage.version || changed.includes('CHANGELOG.md')) {
    throw new Error('feature PRs must not change package version or CHANGELOG.md; run Prepare Release after merge')
  }
  console.log(`feature release files clean at ${headPackage.version}`)
} else {
  const branchVersion = releaseBranch.slice(1).join('.')
  if (headPackage.version !== branchVersion) {
    throw new Error(`release branch ${headBranch} must match package version ${headPackage.version}`)
  }
  if (!isNextVersion(basePackage.version, headPackage.version)) {
    throw new Error(`release version ${headPackage.version} must be the next patch, minor, or major after ${basePackage.version}`)
  }
  if (changed.length !== 2 || !changed.includes('package.json') || !changed.includes('CHANGELOG.md')) {
    throw new Error('release PRs may change only package.json and CHANGELOG.md')
  }

  const baseManifest = { ...basePackage }
  const headManifest = { ...headPackage }
  delete baseManifest.version
  delete headManifest.version
  if (!isDeepStrictEqual(baseManifest, headManifest)) {
    throw new Error('release PRs may change only the package version in package.json')
  }

  const baseChangelog = execFileSync('git', ['show', `${baseRef}:CHANGELOG.md`], { encoding: 'utf8' })
  const headChangelog = readFileSync('CHANGELOG.md', 'utf8')
  const previousHistory = baseChangelog.replace(/^# Changelog\s*/, '')
  const releasePrefix = `# Changelog\n\n## ${headPackage.version}\n\n`
  if (!headChangelog.startsWith(releasePrefix)) {
    throw new Error(`release changelog must start with ## ${headPackage.version}`)
  }
  if (!headChangelog.endsWith(previousHistory)) {
    throw new Error('release changelog must preserve existing history unchanged')
  }
  const inserted = headChangelog.slice(releasePrefix.length, headChangelog.length - previousHistory.length)
  if (!inserted.endsWith('\n\n')) {
    throw new Error('release changelog must separate the new entry from existing history')
  }
  const releaseNotes = inserted.slice(0, -2).split('\n')
  if (releaseNotes.length === 0 || releaseNotes.some(line => !line.startsWith('- '))) {
    throw new Error('release changelog must contain generated bullet entries under the new heading')
  }
  console.log(`release metadata valid at ${headPackage.version} (${headBranch})`)
}

function isNextVersion(baseVersion, candidateVersion) {
  const base = parseVersion(baseVersion)
  const candidate = parseVersion(candidateVersion)
  if (!base || !candidate) return false

  const [baseMajor, baseMinor, basePatch] = base
  const [major, minor, patch] = candidate
  return (major === baseMajor && minor === baseMinor && patch === basePatch + 1)
    || (major === baseMajor && minor === baseMinor + 1 && patch === 0)
    || (major === baseMajor + 1 && minor === 0 && patch === 0)
}

function parseVersion(version) {
  if (typeof version !== 'string') return null
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version)
  if (!match) return null
  const parts = match.slice(1).map(Number)
  return parts.every(Number.isSafeInteger) ? parts : null
}
