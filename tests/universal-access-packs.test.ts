import { describe, expect, it } from 'vitest'
import { rssConnector } from '../src/connectors/adapters/index.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

describe('universal access provider packs', () => {
  it('rejects a private pinned RSS target before issuing a request', async () => {
    const source: ResolvedDataSource = {
      id: 'rss_private',
      projectId: 'project_1',
      publishedAgentId: null,
      kind: 'rss',
      label: 'Private RSS',
      consistencyModel: 'cache',
      scopes: [],
      metadata: { feedUrl: 'http://169.254.169.254/latest/meta-data' },
      credentials: { kind: 'none' },
      status: 'active',
    }
    await expect(rssConnector.executeRead!({
      source,
      capabilityName: 'feed.fetch',
      args: {},
      idempotencyKey: 'rss_1',
    })).rejects.toThrow(/not a public network target/)
  })
})
