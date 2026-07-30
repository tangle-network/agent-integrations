import { afterEach, describe, expect, it, vi } from 'vitest'
import { tallyConnector } from '../src/connectors/adapters/tally.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

const source: ResolvedDataSource = {
  id: 'src_tally_1',
  projectId: 'proj_1',
  publishedAgentId: null,
  kind: 'tally',
  label: 'Tally test',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'tally_test_key' },
  status: 'active',
}

describe('tally adapter manifest', () => {
  it('classifies itself as a webhook-backed forms provider', () => {
    expect(tallyConnector.manifest.kind).toBe('tally')
    expect(tallyConnector.manifest.category).toBe('webhook')
    expect(tallyConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = tallyConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('exposes forms, submissions, and signed webhook management', () => {
    const names = tallyConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual([
      'user.get',
      'forms.list',
      'forms.get',
      'forms.questions.list',
      'submissions.list',
      'submissions.get',
      'webhooks.list',
      'forms.create',
      'forms.update',
      'forms.delete',
      'submissions.delete',
      'webhooks.create',
      'webhooks.delete',
    ].sort())

    const reads = tallyConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toHaveLength(7)

    const mutations = tallyConnector.manifest.capabilities.filter((c) => c.class === 'mutation').map((c) => c.name)
    expect(mutations).toHaveLength(6)
  })
})

describe('tally execution', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses the current plural submissions route with incremental filters', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ items: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await tallyConnector.executeRead!({
      source,
      capabilityName: 'submissions.list',
      args: { formId: 'form_1', afterId: 'sub_0', limit: 100 },
      idempotencyKey: 'read-1',
    })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(String(url)).toBe('https://api.tally.so/forms/form_1/submissions?limit=100&afterId=sub_0')
    expect(init.headers).toMatchObject({ authorization: 'Bearer tally_test_key' })
  })

  it('creates a signed form-response webhook with the documented body', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'wh_1' }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await tallyConnector.executeMutation!({
      source,
      capabilityName: 'webhooks.create',
      args: {
        formId: 'form_1',
        url: 'https://hub.tangle.tools/hooks/tally',
        eventTypes: ['FORM_RESPONSE'],
        signingSecret: 'provider_generated_reference',
      },
      idempotencyKey: 'write-1',
    })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(String(url)).toBe('https://api.tally.so/webhooks')
    expect(JSON.parse(String(init.body))).toEqual({
      formId: 'form_1',
      url: 'https://hub.tangle.tools/hooks/tally',
      eventTypes: ['FORM_RESPONSE'],
      signingSecret: 'provider_generated_reference',
    })
  })
})
