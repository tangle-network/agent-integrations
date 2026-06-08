import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    consumer: 'src/consumer.ts',
    catalog: 'src/catalog.ts',
    registry: 'src/registry.ts',
    runtime: 'src/runtime.ts',
    specs: 'src/specs/index.ts',
    'connectors/index': 'src/connectors/index.ts',
    'connectors/adapters/index': 'src/connectors/adapters/index.ts',
    'connect/index': 'src/connect/index.ts',
    'middleware/index': 'src/middleware/index.ts',
    'webhooks/index': 'src/webhooks/index.ts',
    'stripe/index': 'src/stripe/index.ts',
    'coverage-catalog': 'src/coverage-catalog.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
})
