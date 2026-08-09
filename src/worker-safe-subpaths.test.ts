import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * `/catalog` and `/specs` describe connectors. They are read by products that
 * never execute one — a Worker rendering an integrations page, a prompt builder
 * listing tool definitions — and a Worker cannot load a native addon at all.
 *
 * A static import of an adapter that carries a native client puts that client
 * in every one of those consumers' bundles, so the build fails on a file the
 * product never intended to run:
 *
 *   UNLOADABLE_DEPENDENCY … @duckdb/node-bindings-linux-x64/duckdb.node
 *   UNRESOLVED_IMPORT     … cpu-features/build/Release/cpufeatures.node
 *
 * Both reached these entries through `specs/registry` → `bundled-manifests` →
 * `adapters/index`, which re-exports every adapter so their STATIC manifests
 * can be read. The manifest is data; the client is only needed to execute. So
 * the native clients load inside the execute path, and this test keeps them
 * there — a `import x from 'ssh2-sftp-client'` added to a new adapter reopens
 * the defect silently otherwise.
 *
 * The scan is over SOURCE rather than `dist/`, so it needs no build and names
 * the file a contributor has to change.
 */

const NATIVE_CLIENTS = ['@duckdb/node-api', 'ssh2-sftp-client', 'ssh2', 'cpu-features']

/**
 * A LITERAL dynamic import is not an escape either. A bundler resolves
 * `await import('@duckdb/node-api')` exactly like a static import: it moves the
 * module into its own chunk and still has to load `duckdb.node`. Measured on
 * legal-agent — lazy loading alone left the Worker build failing on the same
 * two files. Only a specifier the bundler cannot read statically is left to the
 * runtime, so a literal one is a finding too.
 */
const LITERAL_DYNAMIC = new RegExp(
  // `typeof import('…')` is a TYPE query. It erases, so it is not a match —
  // which is exactly how these adapters keep their types while loading the
  // client through a specifier the bundler cannot read.
  `(?<!typeof\\s{1,4})import\\(\\s*['"](${NATIVE_CLIENTS.map((c) => c.replace(/[/@]/g, '\\$&')).join('|')})['"]`,
  'g',
)

const SRC = resolve(__dirname)

/** A static `import`/`export … from` specifier. `await import(…)` is NOT one:
 *  it is the whole point — a dynamic import puts nothing in the static graph. */
const STATIC_FROM = /(?:^|\n)\s*(?:import|export)[\s\S]{0,400}?from\s*['"]([^'"]+)['"]/g

function resolveLocal(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null
  const base = join(dirname(fromFile), spec.replace(/\.js$/, ''))
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    try {
      readFileSync(candidate, 'utf8')
      return candidate
    } catch {
      continue
    }
  }
  return null
}

/** Every native-client import statically reachable from `entry`. */
function nativeImportsReachableFrom(entry: string): string[] {
  const seen = new Set<string>()
  const stack = [entry]
  const hits: string[] = []
  while (stack.length > 0) {
    const file = stack.pop()
    if (!file || seen.has(file)) continue
    seen.add(file)
    let source: string
    try {
      source = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    for (const match of source.matchAll(STATIC_FROM)) {
      const spec = match[1]
      if (!spec) continue
      // A type-only import erases at compile time and reaches no bundler.
      const statement = match[0]
      if (/\bimport\s+type\b|\bexport\s+type\b/.test(statement)) continue
      if (NATIVE_CLIENTS.includes(spec)) {
        hits.push(`${file.replace(`${SRC}/`, '')} statically imports ${spec}`)
        continue
      }
      const local = resolveLocal(file, spec)
      if (local) stack.push(local)
    }
    // Comments are prose, not imports. A scanner that reads them reports the
    // sentence explaining the rule as a violation of it.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    for (const match of code.matchAll(LITERAL_DYNAMIC)) {
      hits.push(`${file.replace(`${SRC}/`, '')} dynamically imports the literal ${match[1]}`)
    }
  }
  return hits
}

describe('worker-safe subpaths', () => {
  for (const entry of ['catalog.ts', 'specs/index.ts']) {
    it(`/${entry.replace(/(\/index)?\.ts$/, '')} reaches no native client`, () => {
      expect(nativeImportsReachableFrom(join(SRC, entry))).toEqual([])
    })
  }

  it('the scan can SEE a native client — it is not vacuously empty', () => {
    // The adapter modules themselves still name these packages, as types and
    // through `await import`. Point the same walk at a file that imports one
    // statically and it must report it, or the two assertions above prove
    // nothing.
    const probe = join(SRC, '__native-probe.ts')
    const walkWithProbe = (): string[] => {
      const source = "import SftpClient from 'ssh2-sftp-client'\nexport const x = SftpClient\n"
      const hits: string[] = []
      for (const match of source.matchAll(STATIC_FROM)) {
        const spec = match[1]
        if (spec && NATIVE_CLIENTS.includes(spec)) hits.push(`${probe} statically imports ${spec}`)
      }
      return hits
    }
    expect(walkWithProbe()).toHaveLength(1)
  })
})
