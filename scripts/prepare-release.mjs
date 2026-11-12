#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'

const request = process.argv[2]
const file = readFileSync('package.json', 'utf8')
const manifest = JSON.parse(file)
const registry = (process.env.npm_config_registry || 'https://registry.npmjs.org').replace(/\/$/, '')
const response = await fetch(`${registry}/${manifest.name.replace('/', '%2f')}/latest`, { signal: AbortSignal.timeout(30000) })
if (!response.ok) throw new Error(`Cannot read published release: HTTP ${response.status}`)
const previous = (await response.json()).version
if (!/^\d+\.\d+\.\d+$/.test(previous || '')) throw new Error('Published predecessor is not a stable version')
const parts = previous.split('.').map(Number)
let version = request
if (['patch', 'minor', 'major'].includes(request)) {
  if (request === 'minor' && parts[0] >= 1) throw new Error('Compatible 1.x+ releases use patch; breaking changes use major')
  const index = { major: 0, minor: 1, patch: 2 }[request]
  const selected = [...parts]
  selected[index]++
  selected.fill(0, index + 1)
  version = selected.join('.')
}
if (!/^\d+\.\d+\.\d+$/.test(version || '')) throw new Error('usage: node scripts/prepare-release.mjs <patch|minor|major|x.y.z>')
const [major, minor, patch] = parts
const successors = [`${major}.${minor}.${patch + 1}`, `${major + 1}.0.0`, ...(major === 0 ? [`0.${minor + 1}.0`] : [])]
if (!successors.includes(version)) throw new Error('Release must be the next patch or the next admitted major; only 0.x admits a minor')
if (manifest.version === version) throw new Error(`already ${version}`)
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const tag = `v${previous}`
if (git('merge-base', tag, 'HEAD') !== git('rev-parse', `${tag}^{commit}`)) throw new Error('Published predecessor is not in this source history')
const subjects = git('log', '--no-merges', '--format=%s', `${tag}..HEAD`).split('\n').filter((line) => line && !line.startsWith('chore(release):'))
if (!subjects.length) throw new Error(`no commits since ${tag}`)
const old = readFileSync('CHANGELOG.md', 'utf8')
manifest.version = version
writeFileSync('package.json', `${JSON.stringify(manifest, null, 2)}\n`)
writeFileSync('CHANGELOG.md', `# Changelog\n\n## ${version}\n\n${subjects.map((subject) => `- ${subject}`).join('\n')}\n\n${old.replace(/^# Changelog\s*/, '')}`)
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`)
console.log(`Prepared ${version} from ${subjects.length} commits since published ${tag}`)
