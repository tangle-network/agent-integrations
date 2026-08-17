import {
  type CapabilityMutationResult,
  type CapabilityReadResult,
  type ConnectorAdapter,
  CredentialsExpired,
  ProviderRateLimited,
  type ResolvedDataSource,
} from '../types.js'

const baseUrl = 'https://modelslab.com/api/v6/images'

export const modelslabConnector: ConnectorAdapter = {
  manifest: {
    kind: 'modelslab',
    displayName: 'ModelsLab',
    description: 'Submit text-to-image generations and fetch queued ModelsLab results.',
    auth: {
      kind: 'api-key',
      hint: 'ModelsLab API key from modelslab.com/account/api-key.',
    },
    category: 'other',
    defaultConsistencyModel: 'advisory',
    capabilities: [
      {
        name: 'text.to.image',
        class: 'mutation',
        description: 'Submit a text-to-image generation. Poll images.status when ModelsLab returns processing.',
        parameters: {
          type: 'object',
          properties: {
            prompt: { type: 'string' },
            negative_prompt: { type: 'string' },
            model_id: { type: 'string' },
            width: { type: 'integer', minimum: 256, maximum: 1024 },
            height: { type: 'integer', minimum: 256, maximum: 1024 },
            num_inference_steps: { type: 'integer', minimum: 20, maximum: 50 },
            guidance_scale: { type: 'number', minimum: 1, maximum: 20 },
            samples: { type: 'integer', minimum: 1, maximum: 4 },
            seed: { type: 'integer' },
            safety_checker: { type: 'boolean' },
          },
          required: ['prompt'],
        },
        cas: 'none',
        externalEffect: true,
      },
      {
        name: 'images.status',
        class: 'read',
        description: 'Fetch a queued image generation by request id.',
        parameters: {
          type: 'object',
          properties: { requestId: { type: 'string' } },
          required: ['requestId'],
        },
      },
    ],
  },

  async executeMutation(inv): Promise<CapabilityMutationResult> {
    if (inv.capabilityName !== 'text.to.image') {
      throw new Error(`modelslab: unknown mutation capability ${inv.capabilityName}`)
    }
    const prompt = requiredString(inv.args, 'prompt')
    const data = await request(inv.source, `${baseUrl}/text2img`, {
      ...pick(inv.args, [
        'negative_prompt',
        'model_id',
        'width',
        'height',
        'num_inference_steps',
        'guidance_scale',
        'samples',
        'seed',
        'safety_checker',
      ]),
      prompt,
    })
    return {
      status: 'committed',
      data,
      committedAt: Date.now(),
      idempotentReplay: false,
    }
  },

  async executeRead(inv): Promise<CapabilityReadResult> {
    if (inv.capabilityName !== 'images.status') {
      throw new Error(`modelslab: unknown read capability ${inv.capabilityName}`)
    }
    const requestId = encodeURIComponent(requiredString(inv.args, 'requestId'))
    const data = await request(inv.source, `${baseUrl}/fetch/${requestId}`, {})
    return { data, fetchedAt: Date.now() }
  },

  async test(source) {
    try {
      await request(source, 'https://modelslab.com/api/wallet_balance', {})
      return { ok: true }
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : 'unknown error' }
    }
  },
}

async function request(
  source: ResolvedDataSource,
  url: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const apiKey = credential(source)
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, key: apiKey }),
    signal: AbortSignal.timeout(20_000),
  })
  const responseBody = await readBody(response)
  if (response.status === 401 || response.status === 403) {
    throw new CredentialsExpired(`ModelsLab rejected credentials (${response.status})`, source.id)
  }
  if (response.status === 429) {
    throw new ProviderRateLimited('ModelsLab rate limit (429)', source.id, {
      status: 429,
      body: responseBody,
      retryAfterMs: retryAfterMs(response.headers.get('retry-after')),
    })
  }
  if (!response.ok) throw new Error(`modelslab POST ${new URL(url).pathname} HTTP ${response.status}`)
  if (isErrorResponse(responseBody)) throw new Error('ModelsLab rejected the image request')
  return responseBody
}

function credential(source: ResolvedDataSource): string {
  if (source.credentials.kind !== 'api-key' || !source.credentials.apiKey.trim()) {
    throw new Error('modelslab: API key required')
  }
  return source.credentials.apiKey
}

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || !value) throw new Error(`modelslab: ${key} is required`)
  return value
}

function pick(args: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter((key) => args[key] !== undefined).map((key) => [key, args[key]]))
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

function isErrorResponse(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && (value as Record<string, unknown>).status === 'error')
}

function retryAfterMs(value: string | null): number {
  if (!value) return 60_000
  const seconds = Number(value)
  return Number.isFinite(seconds) && seconds >= 0 ? Math.max(1_000, seconds * 1_000) : 60_000
}
