import { afterEach, describe, expect, it, vi } from 'vitest'
import { jotformConnector } from '../src/connectors/adapters/jotform.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

describe('jotform adapter manifest', () => {
  it('classifies itself as the webhook category and exposes the jotform kind', () => {
    expect(jotformConnector.manifest.kind).toBe('jotform')
    expect(jotformConnector.manifest.category).toBe('webhook')
    expect(jotformConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = jotformConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('exposes the REST surface that backs the New Submission trigger and the read paths agents need', () => {
    const names = jotformConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'forms.list',
        'form.get',
        'form.questions',
        'form.submissions.list',
        'submission.get',
        'form.webhooks.list',
        'submission.create',
        'submission.update',
        'submission.delete',
        'form.webhooks.create',
        'form.webhooks.delete',
      ].sort(),
    )
    const reads = jotformConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = jotformConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      [
        'forms.list',
        'form.get',
        'form.questions',
        'form.submissions.list',
        'submission.get',
        'form.webhooks.list',
      ].sort(),
    )
    expect(mutations).toEqual(
      [
        'submission.create',
        'submission.update',
        'submission.delete',
        'form.webhooks.create',
        'form.webhooks.delete',
      ].sort(),
    )
  })
})

describe('jotform regional routing', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('pins EU accounts to the connection host instead of an action argument', async () => {
    const source: ResolvedDataSource = {
      id: 'src_jotform_eu',
      projectId: 'proj_1',
      publishedAgentId: null,
      kind: 'jotform',
      label: 'Jotform EU',
      consistencyModel: 'authoritative',
      scopes: [],
      metadata: { apiBaseUrl: 'https://eu-api.jotform.com' },
      credentials: { kind: 'api-key', apiKey: 'jotform_test_key' },
      status: 'active',
    }
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ content: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await jotformConnector.executeRead!({
      source,
      capabilityName: 'forms.list',
      args: { apiBaseUrl: 'https://attacker.example' },
      idempotencyKey: 'read-1',
    })

    const [url] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(new URL(url).origin).toBe('https://eu-api.jotform.com')
  })

  it('rejects untrusted connection hosts before sending the API key', async () => {
    const source: ResolvedDataSource = {
      id: 'src_jotform_untrusted',
      projectId: 'proj_1',
      publishedAgentId: null,
      kind: 'jotform',
      label: 'Jotform untrusted',
      consistencyModel: 'authoritative',
      scopes: [],
      metadata: { apiBaseUrl: 'https://credential-capture.example' },
      credentials: { kind: 'api-key', apiKey: 'must_not_leave_process' },
      status: 'active',
    }
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(jotformConnector.executeRead!({
      source,
      capabilityName: 'forms.list',
      args: {},
      idempotencyKey: 'read-2',
    })).rejects.toThrow('connection base URL is not an allowed provider endpoint')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
