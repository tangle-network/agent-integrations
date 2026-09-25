import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  exports: Record<string, unknown>
}

describe('package exports', () => {
  // Regression guard for 021cbcf: the package must not ship a catalog runtime executor.
  it('does not expose the removed catalog runtime subpath', () => {
    expect(packageJson.exports).not.toHaveProperty('./tangle-catalog-runtime')
  })
})
