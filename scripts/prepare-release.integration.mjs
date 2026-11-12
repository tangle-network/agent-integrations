import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const script = fileURLToPath(new URL('./prepare-release.mjs', import.meta.url))
test('prepares from published history despite a newer refused tag and refuses invalid requests before writes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'prepare-published-release-'))
  const peer = createServer((_request, response) => response.end(JSON.stringify({ version: '1.0.4' })))
  await new Promise((resolve) => peer.listen(0, '127.0.0.1', resolve))
  const environment = { ...process.env, npm_config_registry: `http://127.0.0.1:${peer.address().port}` }
  const git = (...args) => execute('git', args, { cwd: directory })
  const commit = (message) => git('-c', 'user.name=Release Fixture', '-c', 'user.email=release@example.invalid', 'commit', '-qm', message)
  try {
    await git('init', '-q')
    const baseline = '# Changelog\n\n## 1.0.4\n\n- Published history\n'
    await writeFile(join(directory, 'package.json'), '{"name":"@fixture/integrations","version":"1.0.4"}\n')
    await writeFile(join(directory, 'CHANGELOG.md'), baseline)
    await git('add', '.')
    await commit('published baseline')
    await git('tag', 'v1.0.4')
    await writeFile(join(directory, 'feature'), 'Drive change feed\n')
    await git('add', '.')
    await commit('feat: retain Drive change feeds')
    await writeFile(join(directory, 'package.json'), '{"name":"@fixture/integrations","version":"1.1.0"}\n')
    await git('add', '.')
    await commit('chore(release): 1.1.0')
    await git('tag', 'v1.1.0')
    const before = await readFile(join(directory, 'package.json'), 'utf8')
    await assert.rejects(execute(process.execPath, [script, 'minor'], { cwd: directory, env: environment }), /Compatible 1.x/)
    assert.equal(await readFile(join(directory, 'package.json'), 'utf8'), before)
    assert.equal(await readFile(join(directory, 'CHANGELOG.md'), 'utf8'), baseline)
    const output = join(directory, 'output')
    await execute(process.execPath, [script, 'patch'], { cwd: directory, env: { ...environment, GITHUB_OUTPUT: output } })
    assert.equal(JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')).version, '1.0.5')
    assert.equal(await readFile(join(directory, 'output'), 'utf8'), 'version=1.0.5\n')
    const changelog = await readFile(join(directory, 'CHANGELOG.md'), 'utf8')
    assert.match(changelog, /## 1.0.5\n\n- feat: retain Drive change feeds/)
    assert.ok(changelog.endsWith(baseline.replace(/^# Changelog\s*/, '')))
    assert.doesNotMatch(changelog, /chore\(release\)/)
  } finally {
    peer.closeAllConnections()
    await new Promise((resolve) => peer.close(resolve))
    await rm(directory, { recursive: true, force: true })
  }
})
