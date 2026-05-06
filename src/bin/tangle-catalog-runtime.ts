#!/usr/bin/env node
import { startTangleCatalogRuntimeNodeServer } from '../tangle-catalog-runtime-server.js'

const secret = process.env.TANGLE_CATALOG_RUNTIME_SECRET
if (!secret || secret.length < 32) {
  console.error('TANGLE_CATALOG_RUNTIME_SECRET must be set to at least 32 characters.')
  process.exit(1)
}

const authResolverUrl = process.env.TANGLE_CATALOG_AUTH_RESOLVER_URL
const authResolverSecret = process.env.TANGLE_CATALOG_AUTH_RESOLVER_SECRET
if (Boolean(authResolverUrl) !== Boolean(authResolverSecret)) {
  console.error('TANGLE_CATALOG_AUTH_RESOLVER_URL and TANGLE_CATALOG_AUTH_RESOLVER_SECRET must be set together.')
  process.exit(1)
}

const port = Number(process.env.PORT ?? process.env.TANGLE_CATALOG_RUNTIME_PORT ?? 4109)
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  console.error('PORT must be an integer between 1 and 65535.')
  process.exit(1)
}

const server = await startTangleCatalogRuntimeNodeServer({
  secret,
  host: process.env.HOST ?? process.env.TANGLE_CATALOG_RUNTIME_HOST ?? '0.0.0.0',
  port,
  authResolver: authResolverUrl && authResolverSecret
    ? {
        endpoint: authResolverUrl,
        secret: authResolverSecret,
      }
    : false,
  onLog: (event) => {
    const line = JSON.stringify({
      level: event.level,
      message: event.message,
      ...event.metadata,
    })
    if (event.level === 'error') console.error(line)
    else console.log(line)
  },
})

console.log(JSON.stringify({
  level: 'info',
  message: 'Tangle catalog runtime listening.',
  url: server.url,
}))

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await server.close()
    process.exit(0)
  })
}
