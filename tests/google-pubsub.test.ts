import {
  createVerify,
  generateKeyPairSync,
} from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { googlePubSubConnector } from '../src/connectors/adapters/google-pubsub.js'
import {
  validateConnectorManifest,
  type ResolvedDataSource,
} from '../src/connectors/types.js'

const keyPair = generateKeyPairSync('rsa', { modulusLength: 2048 })
const privateKey = keyPair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_pubsub_1',
    projectId: 'tangle_project',
    publishedAgentId: null,
    kind: 'gcloud-pubsub',
    label: 'Google Pub/Sub test',
    consistencyModel: 'advisory',
    scopes: [],
    metadata: {},
    credentials: {
      kind: 'api-key',
      apiKey: JSON.stringify({
        type: 'service_account',
        project_id: 'customer-project',
        client_email: 'hub@customer-project.iam.gserviceaccount.com',
        private_key: privateKey,
        token_uri: 'http://169.254.169.254/latest/meta-data',
      }),
    },
    status: 'active',
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

describe('google-pubsub manifest', () => {
  it('ships topic, subscription, publish, pull, acknowledgement, and deadline operations', () => {
    expect(googlePubSubConnector.manifest.kind).toBe('gcloud-pubsub')
    expect(googlePubSubConnector.manifest.capabilities.map((capability) => capability.name)).toEqual([
      'topics.list',
      'topics.get',
      'topics.create',
      'topics.delete',
      'messages.publish',
      'subscriptions.list',
      'subscriptions.get',
      'subscriptions.create',
      'subscriptions.delete',
      'messages.pull',
      'messages.acknowledge',
      'messages.modifyAckDeadline',
    ])
  })

  it('passes safety validation and approval-gates every mutation', () => {
    expect(validateConnectorManifest(googlePubSubConnector.manifest)).toEqual({ ok: true, issues: [] })
    const mutations = googlePubSubConnector.manifest.capabilities.filter(
      (capability) => capability.class === 'mutation',
    )
    expect(mutations).toHaveLength(8)
    for (const mutation of mutations) {
      expect(mutation.cas, mutation.name).toBe('none')
      expect(mutation.externalEffect, mutation.name).toBe(true)
    }
  })
})

describe('google-pubsub service-account execution', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('signs a fixed-audience service-account JWT and lists topics with its access token', async () => {
    const requestedUrls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      requestedUrls.push(url)
      if (url === 'https://oauth2.googleapis.com/token') {
        const form = new URLSearchParams(String(init?.body))
        expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer')
        const assertion = form.get('assertion')!
        const [header, payload, signature] = assertion.split('.')
        expect(JSON.parse(Buffer.from(header!, 'base64url').toString('utf8'))).toEqual({
          alg: 'RS256',
          typ: 'JWT',
        })
        expect(JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8'))).toMatchObject({
          iss: 'hub@customer-project.iam.gserviceaccount.com',
          aud: 'https://oauth2.googleapis.com/token',
          scope: 'https://www.googleapis.com/auth/pubsub',
        })
        expect(
          createVerify('RSA-SHA256')
            .update(`${header}.${payload}`)
            .end()
            .verify(keyPair.publicKey, Buffer.from(signature!, 'base64url')),
        ).toBe(true)
        return jsonResponse({ access_token: 'access-token', expires_in: 3600, token_type: 'Bearer' })
      }
      expect(init?.headers).toMatchObject({ authorization: 'Bearer access-token' })
      return jsonResponse({ topics: [{ name: 'projects/customer-project/topics/orders' }] })
    }))

    const result = await googlePubSubConnector.executeRead!({
      source: source(),
      capabilityName: 'topics.list',
      args: { pageSize: 25, pageToken: 'next-page' },
      idempotencyKey: 'list-1',
    })
    await googlePubSubConnector.executeRead!({
      source: source(),
      capabilityName: 'topics.list',
      args: { pageSize: 1 },
      idempotencyKey: 'list-1-again',
    })

    expect(requestedUrls).toEqual([
      'https://oauth2.googleapis.com/token',
      'https://pubsub.googleapis.com/v1/projects/customer-project/topics?pageSize=25&pageToken=next-page',
      'https://pubsub.googleapis.com/v1/projects/customer-project/topics?pageSize=1',
    ])
    expect(result.data).toEqual({ topics: [{ name: 'projects/customer-project/topics/orders' }] })
  })

  it('publishes UTF-8 text as base64 and does not pass undeclared message fields', async () => {
    let publishedBody: unknown
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === 'https://oauth2.googleapis.com/token') {
        return jsonResponse({ access_token: 'access-token' })
      }
      publishedBody = JSON.parse(String(init?.body))
      return jsonResponse({ messageIds: ['msg-1'] })
    }))

    const result = await googlePubSubConnector.executeMutation!({
      source: source(),
      capabilityName: 'messages.publish',
      args: {
        topic: 'orders',
        messages: [{
          text: 'hello',
          attributes: { tenant: 'acme' },
          orderingKey: 'customer-1',
          injected: 'must-not-pass',
        }],
      },
      idempotencyKey: 'publish-1',
    })

    expect(publishedBody).toEqual({
      messages: [{
        data: Buffer.from('hello').toString('base64'),
        attributes: { tenant: 'acme' },
        orderingKey: 'customer-1',
      }],
    })
    expect(result).toMatchObject({
      status: 'committed',
      data: { messageIds: ['msg-1'] },
      idempotentReplay: false,
    })
  })

  it('builds a bounded pull-subscription request from declared fields', async () => {
    let requestBody: unknown
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === 'https://oauth2.googleapis.com/token') {
        return jsonResponse({ access_token: 'access-token' })
      }
      requestBody = JSON.parse(String(init?.body))
      return jsonResponse({ name: 'projects/customer-project/subscriptions/order-workers' })
    }))

    await googlePubSubConnector.executeMutation!({
      source: source(),
      capabilityName: 'subscriptions.create',
      args: {
        subscription: 'order-workers',
        topic: 'orders',
        ackDeadlineSeconds: 30,
        messageRetentionDuration: '604800s',
        deadLetterTopic: 'dead-orders',
        maxDeliveryAttempts: 10,
        minimumBackoff: '10s',
        maximumBackoff: '60s',
        enableExactlyOnceDelivery: true,
      },
      idempotencyKey: 'subscription-1',
    })

    expect(requestBody).toEqual({
      topic: 'projects/customer-project/topics/orders',
      ackDeadlineSeconds: 30,
      messageRetentionDuration: '604800s',
      deadLetterPolicy: {
        deadLetterTopic: 'projects/customer-project/topics/dead-orders',
        maxDeliveryAttempts: 10,
      },
      retryPolicy: { minimumBackoff: '10s', maximumBackoff: '60s' },
      enableExactlyOnceDelivery: true,
    })
  })

  it('rejects path injection before any token or provider request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(googlePubSubConnector.executeRead!({
      source: source(),
      capabilityName: 'topics.get',
      args: { topic: '../secrets' },
      idempotencyKey: 'get-1',
    })).rejects.toThrow(/valid Pub\/Sub resource ID/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('classifies a missing Pub/Sub IAM role as configuration, not expired credentials', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === 'https://oauth2.googleapis.com/token') {
        return jsonResponse({ access_token: 'access-token' })
      }
      return jsonResponse({
        error: { status: 'PERMISSION_DENIED', message: 'Permission denied' },
      }, 403)
    }))

    await expect(googlePubSubConnector.executeRead!({
      source: source(),
      capabilityName: 'topics.list',
      args: {},
      idempotencyKey: 'list-2',
    })).rejects.toMatchObject({
      name: 'ProviderConfigError',
      status: 403,
      reason: 'PERMISSION_DENIED',
    })
  })
})
