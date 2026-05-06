import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    specs: 'src/specs/index.ts',
    'bin/tangle-catalog-runtime': 'src/bin/tangle-catalog-runtime.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
})
