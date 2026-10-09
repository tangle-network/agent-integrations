/** @type {import('tsdown').UserConfig} */
const config = {
  entry: {
    index: 'src/index.ts',
    consumer: 'src/consumer.ts',
    catalog: 'src/catalog.ts',
    worker: 'src/worker.ts',
    'internal/bundled-manifest-runtime': 'src/connectors/bundled-manifest-runtime.ts',
    registry: 'src/registry.ts',
    runtime: 'src/runtime.ts',
    specs: 'src/specs/index.ts',
    'connectors/index': 'src/connectors/index.ts',
    'connectors/oauth': 'src/connectors/oauth.ts',
    hub: 'src/hub.ts',
    sandbox: 'src/sandbox.ts',
    'connectors/adapters/index': 'src/connectors/adapters/index.ts',
    'connect/index': 'src/connect/index.ts',
    'middleware/index': 'src/middleware/index.ts',
    idempotency: 'src/idempotency.ts',
    'webhooks/index': 'src/webhooks/index.ts',
    'triggers/index': 'src/triggers/index.ts',
    'conversation-events/index': 'src/conversation-events/index.ts',
    'delegated-tools/index': 'src/delegated-tools/index.ts',
    'stripe/index': 'src/stripe/index.ts',
    'coverage-catalog': 'src/coverage-catalog.ts',
    mcp: 'src/mcp.ts',
    'tangle-search/index': 'src/tangle-search/index.ts',
    'twilio/index': 'src/twilio/index.ts',
    'managed-messaging/index': 'src/managed-messaging/index.ts',
  },
  format: 'esm',
  // Keep .js/.d.ts names: package.json exports point at them.
  fixedExtension: false,
  dts: true,
  sourcemap: true,
  target: 'es2022',
}

export default config
