import { describe, expect, it } from 'vitest'
import {
  discoverWorkspaceCapabilities,
  InMemoryConnectionStore,
  type IntegrationActor,
  type IntegrationConnection,
  type IntegrationConnector,
} from '../src/index'

const owner: IntegrationActor = { type: 'team', id: 'ws_1' }

const stripeConnector: IntegrationConnector = {
  id: 'stripe',
  providerId: 'first_party',
  title: 'Stripe',
  category: 'other',
  auth: 'api_key',
  scopes: ['stripe.read', 'stripe.write'],
  actions: [
    {
      id: 'create_checkout',
      title: 'Create checkout session',
      risk: 'write',
      requiredScopes: ['stripe.write'],
      dataClass: 'private',
      description: 'Spin up a hosted checkout session.',
      inputSchema: { type: 'object', properties: { amount: { type: 'integer' } } },
    },
    {
      id: 'find_customer',
      title: 'Find customer',
      risk: 'read',
      requiredScopes: ['stripe.read'],
      dataClass: 'private',
    },
  ],
  triggers: [
    {
      id: 'invoice.paid',
      title: 'Invoice paid',
      requiredScopes: ['stripe.read'],
      dataClass: 'private',
    },
  ],
}

const gmailConnector: IntegrationConnector = {
  id: 'gmail',
  providerId: 'first_party',
  title: 'Gmail',
  category: 'email',
  auth: 'oauth2',
  scopes: ['gmail.read', 'gmail.send'],
  actions: [
    { id: 'send', title: 'Send', risk: 'write', requiredScopes: ['gmail.send'], dataClass: 'private' },
    { id: 'list', title: 'List inbox', risk: 'read', requiredScopes: ['gmail.read'], dataClass: 'private' },
  ],
}

const connection = (id: string, connectorId: string, granted: string[]): IntegrationConnection => ({
  id,
  owner,
  providerId: 'first_party',
  connectorId,
  status: 'active',
  grantedScopes: granted,
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
})

describe('discoverWorkspaceCapabilities', () => {
  it('returns capabilities for active connections whose scopes are granted', async () => {
    const result = await discoverWorkspaceCapabilities({
      owner,
      connectors: [stripeConnector, gmailConnector],
      connections: [
        connection('c_stripe', 'stripe', ['stripe.read', 'stripe.write']),
        connection('c_gmail', 'gmail', ['gmail.read']),
      ],
    })
    const ids = result.capabilities.map((c) => c.id).sort()
    expect(ids).toEqual(['gmail.list', 'stripe.create_checkout', 'stripe.find_customer'])
    expect(result.capabilities.every((c) => c.connected)).toBe(true)
    expect(result.countsByConnector).toEqual({ stripe: 2, gmail: 1 })
  })

  it('hides actions when the connection is missing required scopes', async () => {
    const result = await discoverWorkspaceCapabilities({
      owner,
      connectors: [gmailConnector],
      connections: [connection('c_gmail', 'gmail', ['gmail.read'])],
    })
    expect(result.capabilities.map((c) => c.actionId)).toEqual(['list'])
    expect(result.unreachableConnectors).toEqual([])
  })

  it('reports unreachable connectors when no action survives scope gating', async () => {
    const result = await discoverWorkspaceCapabilities({
      owner,
      connectors: [gmailConnector],
      connections: [connection('c_gmail', 'gmail', [])],
    })
    expect(result.capabilities).toHaveLength(0)
    expect(result.unreachableConnectors).toEqual([{ connectorId: 'gmail', reason: 'all_actions_missing_scope' }])
  })

  it('includeUnconnected surfaces every catalog action with connected=false', async () => {
    const result = await discoverWorkspaceCapabilities({
      owner,
      connectors: [stripeConnector, gmailConnector],
      connections: [connection('c_stripe', 'stripe', ['stripe.read'])],
      includeUnconnected: true,
    })
    const stripeCaps = result.capabilities.filter((c) => c.connectorId === 'stripe')
    const gmailCaps = result.capabilities.filter((c) => c.connectorId === 'gmail')
    expect(stripeCaps.find((c) => c.actionId === 'find_customer')?.connected).toBe(true)
    expect(gmailCaps.every((c) => c.connected === false)).toBe(true)
  })

  it('returns MCP-shape tool schemas alongside each capability', async () => {
    const result = await discoverWorkspaceCapabilities({
      owner,
      connectors: [stripeConnector],
      connections: [connection('c_stripe', 'stripe', ['stripe.write'])],
    })
    const create = result.capabilities.find((c) => c.actionId === 'create_checkout')!
    expect(create.toolSchema.name).toBe('stripe.create_checkout')
    expect(create.toolSchema.inputSchema).toEqual({ type: 'object', properties: { amount: { type: 'integer' } } })
  })

  it('resolves connections from a store when none provided inline', async () => {
    const store = new InMemoryConnectionStore()
    await store.put(connection('c_gmail', 'gmail', ['gmail.read', 'gmail.send']))
    const result = await discoverWorkspaceCapabilities({
      owner,
      store,
      connectors: [gmailConnector],
    })
    expect(result.capabilities.map((c) => c.actionId).sort()).toEqual(['list', 'send'])
  })

  it('emits triggers alongside capabilities', async () => {
    const result = await discoverWorkspaceCapabilities({
      owner,
      connectors: [stripeConnector],
      connections: [connection('c_stripe', 'stripe', ['stripe.read'])],
    })
    expect(result.triggers).toHaveLength(1)
    expect(result.triggers[0].id).toBe('stripe.invoice.paid')
    expect(result.triggers[0].connected).toBe(true)
  })

  it('throws when neither connections nor store is supplied', async () => {
    await expect(
      discoverWorkspaceCapabilities({ owner, connectors: [gmailConnector] }),
    ).rejects.toThrow(/connections or store/)
  })

  it('throws when neither connectors nor providers is supplied', async () => {
    await expect(
      discoverWorkspaceCapabilities({ owner, connections: [] }),
    ).rejects.toThrow(/connectors or providers/)
  })
})
