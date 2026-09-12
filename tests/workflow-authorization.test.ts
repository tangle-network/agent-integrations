import { describe, expect, it, vi } from 'vitest'
import {
  InMemoryConnectionStore,
  InMemoryIntegrationGrantStore,
  InMemoryIntegrationWorkflowStore,
  IntegrationHub,
  createIntegrationRuntime,
  createIntegrationWorkflowRuntime,
  createMockIntegrationProvider,
  type IntegrationGrant,
  type IntegrationManifest,
  type IntegrationTriggerEvent,
} from '../src/index'

const owner = { type: 'user' as const, id: 'owner' }
const grantee = { type: 'agent' as const, id: 'agent' }
const manifest: IntegrationManifest = {
  id: 'inbound-agent',
  requirements: [{
    id: 'gmail-trigger', connectorId: 'gmail', mode: 'trigger',
    reason: 'Wake the authorized agent when mail arrives.',
    requiredTriggers: ['message.received'],
  }],
}

async function setup() {
  const grants = new InMemoryIntegrationGrantStore()
  const store = new InMemoryIntegrationWorkflowStore()
  const hub = new IntegrationHub({
    providers: [createMockIntegrationProvider()],
    store: new InMemoryConnectionStore(),
    capabilitySecret: 'workflow-test-only',
  })
  await hub.upsertConnection({
    id: 'connection', owner, providerId: 'mock', connectorId: 'gmail',
    status: 'active', grantedScopes: ['email.read'],
    createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
  })
  const runtime = createIntegrationWorkflowRuntime({
    runtime: createIntegrationRuntime({ hub, grants }), hub, grants, store,
  })
  const installed = await runtime.install({
    workflow: {
      id: 'incoming-mail', manifest,
      trigger: { requirementId: 'gmail-trigger', triggerId: 'message.received' },
    },
    owner, grantee,
  })
  const grant = grants.get(installed.triggerGrantId)!
  const event: IntegrationTriggerEvent = {
    id: 'event', providerId: 'mock', connectorId: 'gmail',
    connectionId: 'connection', trigger: 'message.received',
    occurredAt: new Date(0).toISOString(), payload: { subject: 'hello' },
  }
  return { runtime, grants, store, installed, grant, event }
}

const changedGrants: Array<[string, (grant: IntegrationGrant) => IntegrationGrant]> = [
  ['revoked grant', (g) => ({ ...g, status: 'revoked' })],
  ['wrong manifest', (g) => ({ ...g, manifestId: 'other' })],
  ['changed owner id', (g) => ({ ...g, owner: { ...g.owner, id: 'other' } })],
  ['changed owner type', (g) => ({ ...g, owner: { ...g.owner, type: 'team' } })],
  ['changed grantee id', (g) => ({ ...g, grantee: { ...g.grantee, id: 'other' } })],
  ['changed grantee type', (g) => ({ ...g, grantee: { ...g.grantee, type: 'app' } })],
  ['different connection', (g) => ({ ...g, connectionId: 'other' })],
  ['different connector', (g) => ({ ...g, connectorId: 'other' })],
  ['removed trigger', (g) => ({ ...g, allowedTriggers: [] })],
]

describe('workflow dispatch authorization', () => {
  it('dispatches an active binding and awaits the consumer', async () => {
    const f = await setup()
    let completed = false
    const result = await f.runtime.dispatchEvent(f.event, async ({ workflows }) => {
      expect(workflows.map((w) => w.id)).toEqual([f.installed.id])
      await Promise.resolve()
      completed = true
    })
    expect(result.matched).toEqual([f.installed])
    expect(completed).toBe(true)
  })

  it('rechecks the grant after a previously successful dispatch', async () => {
    const f = await setup()
    expect((await f.runtime.dispatchEvent(f.event, () => {})).matched).toHaveLength(1)
    f.grants.put({ ...f.grant, status: 'revoked' })
    expect((await f.runtime.dispatchEvent(f.event, () => {})).matched).toEqual([])
  })

  it.each(changedGrants)('excludes a %s', async (_name, change) => {
    const f = await setup()
    f.grants.put(change(f.grant))
    const handler = vi.fn()
    expect((await f.runtime.dispatchEvent(f.event, handler)).matched).toEqual([])
    // Preserve the existing empty-match callback contract.
    expect(handler).toHaveBeenCalledExactlyOnceWith({ event: f.event, workflows: [] })
  })

  it('excludes a deleted grant', async () => {
    const f = await setup()
    f.grants.delete(f.grant.id)
    expect((await f.runtime.dispatchEvent(f.event, () => {})).matched).toEqual([])
  })

  it('rejects a store result for a different grant id', async () => {
    const f = await setup()
    vi.spyOn(f.grants, 'get').mockReturnValue({ ...f.grant, id: 'other' })
    expect((await f.runtime.dispatchEvent(f.event, () => {})).matched).toEqual([])
  })

  it.each(['paused', 'error'] as const)('excludes a %s subscription', async (status) => {
    const f = await setup()
    f.store.put({ ...f.installed, subscription: { ...f.installed.subscription, status } })
    expect((await f.runtime.dispatchEvent(f.event, () => {})).matched).toEqual([])
  })

  it.each(['paused', 'error'] as const)('excludes a %s workflow', async (status) => {
    const f = await setup()
    f.store.put({ ...f.installed, status })
    expect((await f.runtime.dispatchEvent(f.event, () => {})).matched).toEqual([])
  })

  it.each(['connectionId', 'trigger'] as const)('does not read grants for an unrelated %s', async (field) => {
    const f = await setup()
    const get = vi.spyOn(f.grants, 'get')
    expect((await f.runtime.dispatchEvent({ ...f.event, [field]: 'other' }, () => {})).matched).toEqual([])
    expect(get).not.toHaveBeenCalled()
  })

  it('does not route a different connector sharing a connection id', async () => {
    const f = await setup()
    expect((await f.runtime.dispatchEvent({ ...f.event, connectorId: 'other' }, () => {})).matched).toEqual([])
  })

  it('propagates grant-store failures without delivering partial matches', async () => {
    const f = await setup()
    vi.spyOn(f.grants, 'get').mockImplementation(() => { throw new Error('store unavailable') })
    const handler = vi.fn()
    await expect(f.runtime.dispatchEvent(f.event, handler)).rejects.toThrow('store unavailable')
    expect(handler).not.toHaveBeenCalled()
  })

  it('propagates the consumer failure for retry', async () => {
    const f = await setup()
    await expect(f.runtime.dispatchEvent(f.event, () => { throw new Error('enqueue failed') })).rejects.toThrow('enqueue failed')
  })

  it('does not cache grant state across dispatches', async () => {
    const f = await setup()
    const get = vi.spyOn(f.grants, 'get')
    await f.runtime.dispatchEvent(f.event, () => {})
    await f.runtime.dispatchEvent(f.event, () => {})
    expect(get).toHaveBeenCalledTimes(2)
  })
})
