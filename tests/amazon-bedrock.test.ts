import { afterEach, describe, expect, it, vi } from 'vitest'
import { amazonBedrockConnector } from '../src/connectors/adapters/amazon-bedrock.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function bedrockSource(): ResolvedDataSource {
  return {
    id: 'src_bedrock_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'amazon-bedrock',
    label: 'bedrock test',
    consistencyModel: 'advisory',
    scopes: [],
    metadata: {},
    credentials: {
      kind: 'api-key',
      apiKey: JSON.stringify({ accessKeyId: 'AKIAEXAMPLE', secretAccessKey: 'secret-key', region: 'us-west-2' }),
    },
    status: 'active',
  }
}

describe('amazon-bedrock adapter manifest', () => {
  it('exposes the amazon-bedrock kind, "other" category, and advisory consistency', () => {
    expect(amazonBedrockConnector.manifest.kind).toBe('amazon-bedrock')
    expect(amazonBedrockConnector.manifest.category).toBe('other')
    expect(amazonBedrockConnector.manifest.defaultConsistencyModel).toBe('advisory')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape; AWS keys signed with SigV4)', () => {
    const auth = amazonBedrockConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/aws/i)
  })

  it('covers model invocation, conversation, streaming, and foundation-model discovery', () => {
    const names = amazonBedrockConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'models.list',
        'models.get',
        'model.invoke',
        'model.converse',
        'model.invoke.stream',
      ].sort(),
    )
    const reads = amazonBedrockConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = amazonBedrockConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['models.get', 'models.list'].sort())
    expect(mutations).toEqual(
      ['model.converse', 'model.invoke', 'model.invoke.stream'].sort(),
    )
  })

  it('marks generative invocations as cas="none" with externalEffect (non-idempotent sampling)', () => {
    const byName = new Map(amazonBedrockConnector.manifest.capabilities.map((c) => [c.name, c]))
    const invoke = byName.get('model.invoke')
    const converse = byName.get('model.converse')
    const stream = byName.get('model.invoke.stream')
    if (
      !invoke ||
      invoke.class !== 'mutation' ||
      !converse ||
      converse.class !== 'mutation' ||
      !stream ||
      stream.class !== 'mutation'
    ) {
      throw new Error('expected mutation capabilities')
    }
    expect(invoke.cas).toBe('none')
    expect(converse.cas).toBe('none')
    expect(stream.cas).toBe('none')
  })
})

describe('amazon-bedrock execution (SigV4 + control-plane host)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('signs models.list against the region-substituted bedrock.<region> control-plane host', async () => {
    let capturedUrl = ''
    let capturedHeaders: Record<string, string> = {}
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input)
        capturedHeaders = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>))
        return new Response(JSON.stringify({ modelSummaries: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }),
    )

    await amazonBedrockConnector.executeRead!({
      source: bedrockSource(),
      capabilityName: 'models.list',
      args: {},
      idempotencyKey: 't',
    })

    // host header's {region} token is resolved into the URL host, never sent literally
    expect(capturedUrl).toContain('https://bedrock.us-west-2.amazonaws.com/foundation-models')
    expect(capturedUrl).not.toContain('{region}')
    expect(capturedHeaders.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\/\d{8}\/us-west-2\/bedrock\/aws4_request,/,
    )
    expect(capturedHeaders['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/)
  })

  it('targets the bedrock-runtime.<region> base host for model.invoke', async () => {
    let capturedUrl = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        capturedUrl = String(input)
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
      }),
    )

    await amazonBedrockConnector.executeMutation!({
      source: bedrockSource(),
      capabilityName: 'model.invoke',
      // accept/contentType are passed because model.invoke declares them as
      // `{placeholder}` headers, which the shared renderHeaders interpolation
      // requires (a pre-existing optional-header limitation, not AWS-specific).
      args: {
        modelId: 'anthropic.claude-3-sonnet-20240229-v1:0',
        body: { x: 1 },
        accept: 'application/json',
        contentType: 'application/json',
      },
      idempotencyKey: 't',
    })

    // model.invoke carries no host override, so it targets the bedrock-runtime
    // base host (not the bedrock.<region> control-plane host).
    expect(capturedUrl).toContain('https://bedrock-runtime.us-west-2.amazonaws.com/model/')
    expect(capturedUrl).toContain('/invoke')
  })

  it('test() probes the control-plane host without throwing on the {region} placeholder', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ modelSummaries: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
    const result = await amazonBedrockConnector.test(bedrockSource())
    expect(result.ok).toBe(true)
  })
})
