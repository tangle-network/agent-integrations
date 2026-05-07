import { describe, expect, it } from 'vitest'
import {
  InMemoryConnectionStore,
  InMemoryIntegrationGrantStore,
  IntegrationHub,
  createIntegrationRuntime,
  createMockIntegrationProvider,
  type IntegrationManifest,
} from '../src/index'

const owner = { type: 'user' as const, id: 'user_1' }
const app = { type: 'app' as const, id: 'daily-ops-agent' }
const sandbox = { type: 'sandbox' as const, id: 'sandbox_1' }

describe('IntegrationRuntime app and agent grants', () => {
  it('resolves an app manifest against a user connection graph', async () => {
    const store = new InMemoryConnectionStore()
    const hub = new IntegrationHub({
      providers: [createMockIntegrationProvider()],
      store,
      capabilitySecret: 'secret',
    })
    const runtime = createIntegrationRuntime({
      hub,
      grants: new InMemoryIntegrationGrantStore(),
    })
    await hub.upsertConnection({
      id: 'conn_gmail',
      owner,
      providerId: 'mock',
      connectorId: 'gmail',
      status: 'active',
      grantedScopes: ['email.read'],
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    })

    const resolution = await runtime.resolveManifest(dailyOpsManifest, owner)

    expect(resolution.ready.map((r) => r.requirement.id)).toEqual(['gmail-read'])
    expect(resolution.missing.map((r) => r.requirement.id)).toEqual(['gmail-write'])
  })

  it('creates grants and injects scoped sandbox capabilities for generated apps', async () => {
    const store = new InMemoryConnectionStore()
    const hub = new IntegrationHub({
      providers: [createMockIntegrationProvider()],
      store,
      capabilitySecret: 'secret',
      now: () => new Date('2026-05-05T00:00:00.000Z'),
    })
    const runtime = createIntegrationRuntime({
      hub,
      grants: new InMemoryIntegrationGrantStore(),
      now: () => new Date('2026-05-05T00:00:00.000Z'),
    })
    await hub.upsertConnection({
      id: 'conn_gmail',
      owner,
      providerId: 'mock',
      connectorId: 'gmail',
      status: 'active',
      grantedScopes: ['email.read', 'email.write'],
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    })

    const grants = await runtime.createGrants({
      manifest: dailyOpsManifest,
      owner,
      grantee: app,
    })
    const bundle = await runtime.buildSandboxBundle({
      manifestId: dailyOpsManifest.id,
      grantee: app,
      subject: sandbox,
      ttlMs: 60_000,
    })

    expect(grants).toHaveLength(2)
    expect(bundle.capabilities).toHaveLength(2)
    expect(bundle.connectors).toHaveLength(2)
    expect(bundle.tools.map((tool) => tool.action.id).sort()).toEqual(['drafts.create', 'messages.search'])
    expect(bundle.capabilities.every((binding) =>
      binding.capability.capability.subject.type === 'sandbox'
      && binding.capability.token.length > 20
    )).toBe(true)
  })

  it('builds bundles from explicit grant ids for installed templates and durable app instances', async () => {
    const store = new InMemoryConnectionStore()
    const hub = new IntegrationHub({
      providers: [createMockIntegrationProvider()],
      store,
      capabilitySecret: 'secret',
      now: () => new Date('2026-05-05T00:00:00.000Z'),
    })
    const grantStore = new InMemoryIntegrationGrantStore()
    const runtime = createIntegrationRuntime({
      hub,
      grants: grantStore,
      now: () => new Date('2026-05-05T00:00:00.000Z'),
    })
    await hub.upsertConnection({
      id: 'conn_gmail',
      owner,
      providerId: 'mock',
      connectorId: 'gmail',
      status: 'active',
      grantedScopes: ['email.read', 'email.write'],
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    })

    const grants = await runtime.createGrants({
      manifest: dailyOpsManifest,
      owner,
      grantee: app,
      metadata: { installId: 'install_1' },
    })
    const readOnlyBundle = await runtime.buildSandboxBundle({
      grantIds: [grants[0]!.id],
      grantee: app,
      subject: sandbox,
      ttlMs: 60_000,
    })

    expect(readOnlyBundle.manifestId).toBe(dailyOpsManifest.id)
    expect(readOnlyBundle.capabilities).toHaveLength(1)
    expect(readOnlyBundle.tools.map((tool) => tool.action.id)).toEqual(['messages.search'])
    expect(readOnlyBundle.tools.map((tool) => tool.action.id)).not.toContain('drafts.create')
  })

  it('fails closed when explicit bundle grant ids are missing or owned by another grantee', async () => {
    const store = new InMemoryConnectionStore()
    const hub = new IntegrationHub({
      providers: [createMockIntegrationProvider()],
      store,
      capabilitySecret: 'secret',
    })
    const runtime = createIntegrationRuntime({
      hub,
      grants: new InMemoryIntegrationGrantStore(),
    })
    await hub.upsertConnection({
      id: 'conn_gmail',
      owner,
      providerId: 'mock',
      connectorId: 'gmail',
      status: 'active',
      grantedScopes: ['email.read', 'email.write'],
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    })

    const grants = await runtime.createGrants({
      manifest: dailyOpsManifest,
      owner,
      grantee: app,
    })

    await expect(runtime.buildSandboxBundle({
      grantIds: ['grant_missing'],
      subject: sandbox,
      ttlMs: 60_000,
    })).rejects.toThrow(/unknown grant id/)
    await expect(runtime.buildSandboxBundle({
      grantIds: [grants[0]!.id],
      grantee: { type: 'app', id: 'other-app' },
      subject: sandbox,
      ttlMs: 60_000,
    })).rejects.toThrow(/different grantee/)
  })

  it('works for domain agents and Blueprint-style sandbox context injection', async () => {
    const store = new InMemoryConnectionStore()
    const hub = new IntegrationHub({
      providers: [createMockIntegrationProvider()],
      store,
      capabilitySecret: 'secret',
    })
    const runtime = createIntegrationRuntime({ hub })
    await hub.upsertConnection({
      id: 'conn_tax_email',
      owner,
      providerId: 'mock',
      connectorId: 'gmail',
      status: 'active',
      grantedScopes: ['email.read'],
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    })

    await runtime.createGrants({
      manifest: taxResearchManifest,
      owner,
      grantee: { type: 'agent', id: 'tax-agent' },
    })
    const bundle = await runtime.buildSandboxBundle({
      manifestId: taxResearchManifest.id,
      grantee: { type: 'agent', id: 'tax-agent' },
      subject: { type: 'sandbox', id: 'blueprint-sandbox' },
      ttlMs: 300_000,
    })

    expect(bundle.tools).toHaveLength(1)
    expect(bundle.tools[0].connectorId).toBe('gmail')
    expect(bundle.tools[0].risk).toBe('read')
  })
})

const dailyOpsManifest: IntegrationManifest = {
  id: 'daily-ops-agent',
  title: 'Daily Ops Agent',
  requirements: [
    {
      id: 'gmail-read',
      connectorId: 'gmail',
      mode: 'read',
      reason: 'Read recent email for the daily summary.',
      requiredActions: ['messages.search'],
    },
    {
      id: 'gmail-write',
      connectorId: 'gmail',
      mode: 'write',
      reason: 'Create draft replies after user approval.',
      requiredActions: ['drafts.create'],
    },
  ],
}

const taxResearchManifest: IntegrationManifest = {
  id: 'tax-agent-research',
  title: 'Tax Agent Research Context',
  requirements: [
    {
      id: 'email-context',
      connectorId: 'gmail',
      mode: 'read',
      reason: 'Read user-provided tax documents and correspondence.',
      requiredActions: ['messages.search'],
    },
  ],
}
