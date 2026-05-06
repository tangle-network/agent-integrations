#!/usr/bin/env node
import {
  buildTangleCatalogRuntimePackageManifest,
  renderTangleCatalogRuntimePnpmAddCommand,
} from '../tangle-catalog.js'
import { auditTangleCatalogRuntimePackages } from '../tangle-catalog-runtime.js'
import { startTangleCatalogRuntimeNodeServer } from '../tangle-catalog-runtime-server.js'

const args = new Set(process.argv.slice(2))
if (args.has('--print-package-json')) {
  console.log(JSON.stringify(buildTangleCatalogRuntimePackageManifest({
    agentIntegrationsVersion: process.env.TANGLE_AGENT_INTEGRATIONS_VERSION,
  }), null, 2))
  process.exit(0)
}

if (args.has('--print-pnpm-add')) {
  console.log(renderTangleCatalogRuntimePnpmAddCommand({
    agentIntegrationsVersion: process.env.TANGLE_AGENT_INTEGRATIONS_VERSION,
  }))
  process.exit(0)
}

if (args.has('--audit-packages')) {
  const connectorIds = process.env.TANGLE_CATALOG_AUDIT_CONNECTORS
    ?.split(',')
    .map((id) => id.trim())
    .filter(Boolean)
  console.log(JSON.stringify(await auditTangleCatalogRuntimePackages({ connectorIds }), null, 2))
  process.exit(0)
}

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
