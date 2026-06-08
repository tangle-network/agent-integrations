import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  exports: Record<string, { types: string; import: string; default: string }>
}

describe('package exports', () => {
  it('exposes stable subpaths for platform control plane and product consumers', () => {
    expect(packageJson.exports).toMatchObject({
      '.': {
        types: './dist/index.d.ts',
        import: './dist/index.js',
      },
      './catalog': {
        types: './dist/catalog.d.ts',
        import: './dist/catalog.js',
      },
      './connectors': {
        types: './dist/connectors/index.d.ts',
        import: './dist/connectors/index.js',
      },
      './connectors/adapters': {
        types: './dist/connectors/adapters/index.d.ts',
        import: './dist/connectors/adapters/index.js',
      },
      './consumer': {
        types: './dist/consumer.d.ts',
        import: './dist/consumer.js',
      },
      './webhooks': {
        types: './dist/webhooks/index.d.ts',
        import: './dist/webhooks/index.js',
      },
      './registry': {
        types: './dist/registry.d.ts',
        import: './dist/registry.js',
      },
      './runtime': {
        types: './dist/runtime.d.ts',
        import: './dist/runtime.js',
      },
      './specs': {
        types: './dist/specs.d.ts',
        import: './dist/specs.js',
      },
      './coverage-catalog': {
        types: './dist/coverage-catalog.d.ts',
        import: './dist/coverage-catalog.js',
      },
    })
    expect(packageJson.exports).not.toHaveProperty('./tangle-catalog-runtime')
  })
})
