import { describe, expect, it } from 'vitest'
import { n8nConnector } from '../src/connectors/adapters/n8n.js'

describe('n8n adapter manifest', () => {
  it('exposes the n8n kind in the other category', () => {
    expect(n8nConnector.manifest.kind).toBe('n8n')
    expect(n8nConnector.manifest.category).toBe('other')
  })

  it('uses api-key auth (X-N8N-API-KEY header)', () => {
    expect(n8nConnector.manifest.auth.kind).toBe('api-key')
  })

  it('covers workflows, executions, and webhook trigger surfaces', () => {
    const names = n8nConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'workflows.list',
        'workflows.get',
        'workflows.activate',
        'workflows.deactivate',
        'executions.list',
        'executions.get',
        'webhooks.trigger',
      ].sort(),
    )
  })
})
