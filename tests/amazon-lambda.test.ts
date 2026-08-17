import { afterEach, describe, expect, it, vi } from 'vitest'
import { amazonLambdaConnector } from '../src/connectors/adapters/amazon-lambda.js'
import {
  validateConnectorManifest,
  type ResolvedDataSource,
} from '../src/connectors/types.js'

function source(): ResolvedDataSource {
  return {
    id: 'src_lambda_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'aws-lambda',
    label: 'Lambda test',
    consistencyModel: 'advisory',
    scopes: [],
    metadata: {},
    credentials: {
      kind: 'api-key',
      apiKey: JSON.stringify({
        accessKeyId: 'AKIAEXAMPLE',
        secretAccessKey: 'secret-key',
        region: 'us-west-2',
      }),
    },
    status: 'active',
  }
}

function response(body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('aws-lambda adapter manifest', () => {
  it('ships function, version, and alias operations', () => {
    expect(amazonLambdaConnector.manifest.capabilities.map((capability) => capability.name)).toEqual([
      'functions.list',
      'functions.get',
      'aliases.list',
      'functions.invoke',
      'functions.create',
      'functions.code.update',
      'functions.configuration.update',
      'versions.publish',
      'aliases.create',
      'aliases.update',
      'aliases.delete',
      'functions.delete',
    ])
  })

  it('requires approval for every write and validates safely', () => {
    const mutations = amazonLambdaConnector.manifest.capabilities.filter(
      (capability) => capability.class === 'mutation',
    )
    expect(mutations).toHaveLength(9)
    for (const mutation of mutations) expect(mutation.externalEffect).toBe(true)
    expect(validateConnectorManifest(amazonLambdaConnector.manifest)).toEqual({
      ok: true,
      issues: [],
    })
  })
})

describe('aws-lambda execution', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('signs a region-scoped function list request for Lambda', async () => {
    let url = ''
    let headers: Record<string, string> = {}
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      url = String(input)
      headers = Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>),
      )
      return response({ Functions: [] })
    }))

    const result = await amazonLambdaConnector.executeRead!({
      source: source(),
      capabilityName: 'functions.list',
      args: { maxItems: 7, functionVersion: 'ALL' },
      idempotencyKey: 'list-1',
    })

    const requestUrl = new URL(url)
    expect(`${requestUrl.origin}${requestUrl.pathname}`).toBe(
      'https://lambda.us-west-2.amazonaws.com/2015-03-31/functions',
    )
    expect(Object.fromEntries(requestUrl.searchParams)).toEqual({
      FunctionVersion: 'ALL',
      MaxItems: '7',
    })
    expect(headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\/\d{8}\/us-west-2\/lambda\/aws4_request,/,
    )
    expect(result.data).toEqual({ Functions: [] })
  })

  it('encodes function names and preserves the invocation payload', async () => {
    let url = ''
    let headers: Record<string, string> = {}
    let body: unknown
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      url = String(input)
      headers = Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>),
      )
      body = JSON.parse(String(init?.body))
      return response({ ok: true })
    }))

    const result = await amazonLambdaConnector.executeMutation!({
      source: source(),
      capabilityName: 'functions.invoke',
      args: {
        functionName: 'orders/worker',
        qualifier: 'live',
        invocationType: 'RequestResponse',
        logType: 'Tail',
        payload: { orderId: 'ord_1', nested: { count: 2 } },
      },
      idempotencyKey: 'invoke-1',
    })

    expect(url).toBe(
      'https://lambda.us-west-2.amazonaws.com/2015-03-31/functions/orders%2Fworker/invocations?Qualifier=live',
    )
    expect(headers['X-Amz-Invocation-Type']).toBe('RequestResponse')
    expect(headers['X-Amz-Log-Type']).toBe('Tail')
    expect(headers).not.toHaveProperty('X-Amz-Client-Context')
    expect(body).toEqual({ orderId: 'ord_1', nested: { count: 2 } })
    expect(result.status).toBe('committed')
  })

  it('maps only declared CreateFunction fields', async () => {
    let body: Record<string, unknown> = {}
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>
      return response({ FunctionName: 'worker' })
    }))

    await amazonLambdaConnector.executeMutation!({
      source: source(),
      capabilityName: 'functions.create',
      args: {
        functionName: 'worker',
        role: 'arn:aws:iam::123456789012:role/lambda',
        code: { S3Bucket: 'deployments', S3Key: 'worker.zip' },
        runtime: 'nodejs24.x',
        handler: 'index.handler',
        injectedField: 'must-not-pass',
      },
      idempotencyKey: 'create-1',
    })

    expect(body).toEqual({
      FunctionName: 'worker',
      Role: 'arn:aws:iam::123456789012:role/lambda',
      Code: { S3Bucket: 'deployments', S3Key: 'worker.zip' },
      Runtime: 'nodejs24.x',
      Handler: 'index.handler',
    })
  })
})
