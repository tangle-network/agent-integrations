import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CONNECTOR_ADAPTER_FACTORIES,
  amplitudeConnector,
} from '../src/connectors/adapters/index.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'
import { getIntegrationSpec } from '../src/specs/registry.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_amplitude_1',
    projectId: 'project_1',
    publishedAgentId: null,
    kind: 'amplitude',
    label: 'Amplitude test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: {
      kind: 'api-key',
      apiKey: JSON.stringify({ apiKey: 'project-key', secretKey: 'project-secret' }),
    },
    status: 'active',
    ...overrides,
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('Amplitude adapter', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('ships an executable API-key pack with approval metadata and precise setup', () => {
    expect(amplitudeConnector.manifest).toMatchObject({
      kind: 'amplitude',
      category: 'other',
      auth: { kind: 'api-key' },
    })
    expect(amplitudeConnector.manifest.capabilities.map((capability) => capability.name).sort()).toEqual([
      'annotation-categories.create',
      'annotation-categories.delete',
      'annotation-categories.get',
      'annotation-categories.list',
      'annotation-categories.update',
      'annotations.create',
      'annotations.delete',
      'annotations.get',
      'annotations.list',
      'annotations.update',
      'charts.results',
      'events.list',
      'events.segment',
      'sessions.average-length',
      'users.activity',
      'users.counts',
      'users.search',
    ])
    for (const capability of amplitudeConnector.manifest.capabilities) {
      if (capability.class === 'mutation') expect(capability.externalEffect, capability.name).toBe(true)
    }

    const factory = CONNECTOR_ADAPTER_FACTORIES.find((candidate) => candidate.kind === 'amplitude')
    expect(factory?.envMap).toEqual({})
    const spec = getIntegrationSpec('amplitude')
    expect(spec).toMatchObject({
      status: 'executable',
      auth: { mode: 'api_key', placement: 'basic' },
      setup: {
        credentialFields: [expect.objectContaining({ label: 'Amplitude project credential JSON', secret: true })],
      },
    })
  })

  it('tests the default project with HTTP Basic credentials', async () => {
    let requestUrl = ''
    let authorization = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      authorization = new Headers(init?.headers).get('authorization') ?? ''
      return json({ data: [] })
    }))

    await expect(amplitudeConnector.test!(source())).resolves.toEqual({ ok: true })
    expect(requestUrl).toBe('https://amplitude.com/api/2/events/list')
    expect(authorization).toBe(`Basic ${Buffer.from('project-key:project-secret').toString('base64')}`)
  })

  it('routes EU projects only to the documented EU API host', async () => {
    let requestUrl = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      requestUrl = String(input)
      return json({ data: [] })
    }))

    await amplitudeConnector.executeRead!({
      source: source({ metadata: { apiBaseUrl: 'https://analytics.eu.amplitude.com' } }),
      capabilityName: 'events.list',
      args: {},
      idempotencyKey: 'eu-list',
    })
    expect(requestUrl).toBe('https://analytics.eu.amplitude.com/api/2/events/list')

    await expect(amplitudeConnector.executeRead!({
      source: source({ metadata: { apiBaseUrl: 'https://amplitude.com.attacker.test' } }),
      capabilityName: 'events.list',
      args: {},
      idempotencyKey: 'blocked-host',
    })).rejects.toThrow(/not an allowed provider endpoint/)
  })

  it('encodes analytics query JSON once and preserves provider parameter names', async () => {
    let requestUrl = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      requestUrl = String(input)
      return json({ data: { series: [] } })
    }))
    const event = JSON.stringify({ event_type: 'Checkout Completed' })

    await amplitudeConnector.executeRead!({
      source: source(),
      capabilityName: 'events.segment',
      args: {
        event,
        metric: 'totals',
        start: '20260801',
        end: '20260810',
        interval: 1,
        groupBy: 'country',
      },
      idempotencyKey: 'segment',
    })

    const url = new URL(requestUrl)
    expect(url.pathname).toBe('/api/2/events/segmentation')
    expect(url.searchParams.get('e')).toBe(event)
    expect(url.searchParams.get('m')).toBe('totals')
    expect(url.searchParams.get('start')).toBe('20260801')
    expect(url.searchParams.get('g')).toBe('country')
  })

  it('creates an annotation with the documented body and no credential fields', async () => {
    let request: { url: string; method: string; body: unknown } | undefined
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      request = {
        url: String(input),
        method: init?.method ?? '',
        body: JSON.parse(String(init?.body)),
      }
      return json({ data: { id: 42 } })
    }))
    const annotation = {
      label: 'Release 2.0',
      start: '2026-08-10T12:00:00+00:00',
      category: 'Releases',
      details: 'Production deploy',
    }

    const result = await amplitudeConnector.executeMutation!({
      source: source(),
      capabilityName: 'annotations.create',
      args: { annotation },
      idempotencyKey: 'annotation-create',
    })

    expect(request).toEqual({
      url: 'https://amplitude.com/api/3/annotations',
      method: 'POST',
      body: annotation,
    })
    expect(result.status).toBe('committed')
  })

  it('fails closed on incomplete, rejected, and unknown operations', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'revoked' }, 401)))
    await expect(amplitudeConnector.executeRead!({
      source: source(),
      capabilityName: 'events.list',
      args: {},
      idempotencyKey: 'revoked',
    })).rejects.toThrow(/rejected credentials/)

    await expect(amplitudeConnector.executeRead!({
      source: source({ credentials: { kind: 'api-key', apiKey: '{"apiKey":"project-key"}' } }),
      capabilityName: 'events.list',
      args: {},
      idempotencyKey: 'missing-secret',
    })).rejects.toThrow(/missing secretKey/)

    await expect(amplitudeConnector.executeMutation!({
      source: source(),
      capabilityName: 'events.ingest',
      args: {},
      idempotencyKey: 'unadvertised',
    })).rejects.toThrow(/unknown mutation capability/)
  })

  it('redacts both project credentials and their Basic header from errors', async () => {
    const encoded = Buffer.from('project-key:project-secret').toString('base64')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      `project-key project-secret ${encoded}`,
      { status: 500 },
    )))

    const operation = amplitudeConnector.executeRead!({
      source: source(),
      capabilityName: 'events.list',
      args: {},
      idempotencyKey: 'redaction',
    })
    await expect(operation).rejects.not.toThrow(/project-key|project-secret/)
    await expect(operation).rejects.not.toThrow(new RegExp(encoded))
  })
})
