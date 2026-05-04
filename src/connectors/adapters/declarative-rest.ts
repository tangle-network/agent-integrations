import {
  type Capability,
  type CapabilityMutationResult,
  type CapabilityReadResult,
  type ConnectorAdapter,
  type ConnectorCredentials,
  type ConnectorInvocation,
  CredentialsExpired,
} from '../types.js'

export type RestCredentialPlacement =
  | { kind: 'bearer' }
  | { kind: 'header'; header: string; prefix?: string }
  | { kind: 'query'; parameter: string }

export interface RestConnectorSpec {
  kind: string
  displayName: string
  description: string
  auth: ConnectorAdapter['manifest']['auth']
  category: ConnectorAdapter['manifest']['category']
  defaultConsistencyModel: ConnectorAdapter['manifest']['defaultConsistencyModel']
  baseUrl: string | { metadataKey: string; fallback?: string }
  credentialPlacement?: RestCredentialPlacement
  defaultHeaders?: Record<string, string>
  capabilities: RestOperationSpec[]
  test?: RestRequestSpec
}

export interface RestOperationSpec {
  name: string
  class: 'read' | 'mutation'
  description: string
  parameters: Record<string, unknown>
  requiredScopes?: string[]
  request: RestRequestSpec
  cas?: 'etag-if-match' | 'native-idempotency' | 'optimistic-read-verify' | 'none'
  externalEffect?: boolean
}

export interface RestRequestSpec {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  query?: Record<string, string | number | boolean | undefined>
  headers?: Record<string, string>
  body?: 'args' | string | Record<string, unknown>
}

export function declarativeRestConnector(spec: RestConnectorSpec): ConnectorAdapter {
  const capabilities = spec.capabilities.map(operationToCapability)
  const adapter: ConnectorAdapter = {
    manifest: {
      kind: spec.kind,
      displayName: spec.displayName,
      description: spec.description,
      auth: spec.auth,
      category: spec.category,
      defaultConsistencyModel: spec.defaultConsistencyModel,
      capabilities,
    },

    async executeRead(inv: ConnectorInvocation): Promise<CapabilityReadResult> {
      const op = readOperation(spec, inv.capabilityName, 'read')
      const response = await executeRestRequest(spec, op.request, inv)
      return {
        data: response.data,
        etag: response.etag,
        fetchedAt: Date.now(),
      }
    },

    async executeMutation(inv: ConnectorInvocation): Promise<CapabilityMutationResult> {
      const op = readOperation(spec, inv.capabilityName, 'mutation')
      const response = await executeRestRequest(spec, op.request, inv)
      return {
        status: 'committed',
        data: response.data,
        etagAfter: response.etag,
        committedAt: Date.now(),
        idempotentReplay: false,
      }
    },

    async test(source) {
      if (!spec.test) return { ok: true }
      try {
        await executeRestRequest(spec, spec.test, {
          source,
          capabilityName: '__test__',
          args: {},
          idempotencyKey: 'test',
        })
        return { ok: true }
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : 'unknown error' }
      }
    },
  }
  return adapter
}

function operationToCapability(op: RestOperationSpec): Capability {
  const base = {
    name: op.name,
    description: op.description,
    parameters: op.parameters,
    requiredScopes: op.requiredScopes,
  }
  if (op.class === 'read') {
    return { ...base, class: 'read' }
  }
  return {
    ...base,
    class: 'mutation',
    cas: op.cas ?? 'native-idempotency',
    externalEffect: op.externalEffect ?? true,
  }
}

function readOperation(spec: RestConnectorSpec, name: string, expected: 'read' | 'mutation'): RestOperationSpec {
  const op = spec.capabilities.find((candidate) => candidate.name === name)
  if (!op || op.class !== expected) {
    throw new Error(`${spec.kind}: unknown ${expected} capability ${name}`)
  }
  return op
}

async function executeRestRequest(
  spec: RestConnectorSpec,
  request: RestRequestSpec,
  inv: ConnectorInvocation,
): Promise<{ data: unknown; etag?: string }> {
  const baseUrl = resolveBaseUrl(spec.baseUrl, inv.source.metadata)
  const url = new URL(interpolate(request.path, inv.args), baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`)
  for (const [key, value] of Object.entries(request.query ?? {})) {
    const rendered = renderQueryValue(value, inv.args)
    if (rendered !== undefined && rendered !== '') url.searchParams.set(key, String(rendered))
  }
  const headers: Record<string, string> = {
    accept: 'application/json',
    ...spec.defaultHeaders,
    ...renderHeaders(request.headers ?? {}, inv.args),
  }
  applyCredentials(headers, url, spec.credentialPlacement ?? { kind: 'bearer' }, inv.source.credentials)
  if (inv.expectedEtag) headers['if-match'] = inv.expectedEtag
  if (request.method !== 'GET' && request.method !== 'DELETE') {
    headers['content-type'] = headers['content-type'] ?? 'application/json'
  }
  const res = await fetch(url, {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'DELETE' ? undefined : JSON.stringify(resolveBody(request.body, inv.args)),
    signal: AbortSignal.timeout(20_000),
  })
  if (res.status === 401 || res.status === 403) {
    throw new CredentialsExpired(`${spec.displayName} rejected credentials (${res.status})`, inv.source.id)
  }
  if (res.status === 409 || res.status === 412) {
    return {
      data: {
        status: 'conflict',
        message: await safeErrorText(res),
      },
      etag: res.headers.get('etag') ?? undefined,
    }
  }
  if (res.status === 429) {
    return {
      data: {
        status: 'rate-limited',
        retryAfter: res.headers.get('retry-after') ?? undefined,
        message: await safeErrorText(res),
      },
    }
  }
  if (!res.ok) {
    throw new Error(`${spec.kind} ${request.method} ${url.pathname} HTTP ${res.status}: ${(await safeErrorText(res)).slice(0, 300)}`)
  }
  const text = await res.text()
  const data = text ? JSON.parse(text) as unknown : null
  return { data, etag: res.headers.get('etag') ?? undefined }
}

function resolveBaseUrl(baseUrl: RestConnectorSpec['baseUrl'], metadata: Record<string, unknown>): string {
  if (typeof baseUrl === 'string') return baseUrl
  const value = metadata[baseUrl.metadataKey]
  if (typeof value === 'string' && value.trim()) return value
  if (baseUrl.fallback) return baseUrl.fallback
  throw new Error(`missing metadata.${baseUrl.metadataKey} base URL`)
}

function applyCredentials(
  headers: Record<string, string>,
  url: URL,
  placement: RestCredentialPlacement,
  credentials: ConnectorCredentials,
): void {
  const token = credentialToken(credentials)
  if (placement.kind === 'bearer') headers.authorization = `Bearer ${token}`
  if (placement.kind === 'header') headers[placement.header] = `${placement.prefix ?? ''}${token}`
  if (placement.kind === 'query') url.searchParams.set(placement.parameter, token)
}

function credentialToken(credentials: ConnectorCredentials): string {
  if (credentials.kind === 'oauth2') return credentials.accessToken
  if (credentials.kind === 'api-key') return credentials.apiKey
  throw new Error(`declarative REST connectors require oauth2 or api-key credentials, got ${credentials.kind}`)
}

function resolveBody(body: RestRequestSpec['body'], args: Record<string, unknown>): unknown {
  if (!body || body === 'args') return args
  if (typeof body === 'string') return renderValue(body, args)
  return renderObject(body, args)
}

function renderHeaders(headers: Record<string, string>, args: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, interpolate(value, args)]))
}

function renderObject(input: Record<string, unknown>, args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, renderValue(value, args)]))
}

function renderValue(value: unknown, args: Record<string, unknown>): unknown {
  if (typeof value === 'string') {
    const exact = value.match(/^\{([a-zA-Z0-9_.-]+)\}$/)
    if (exact) return readRequiredPath(args, exact[1])
    return interpolate(value, args)
  }
  return value
}

function renderQueryValue(value: unknown, args: Record<string, unknown>): unknown {
  if (typeof value !== 'string') return value
  const exact = value.match(/^\{([a-zA-Z0-9_.-]+)\}$/)
  if (exact) return readPath(args, exact[1])
  try {
    return interpolate(value, args)
  } catch {
    return undefined
  }
}

function interpolate(template: string, args: Record<string, unknown>): string {
  return template.replace(/\{([a-zA-Z0-9_.-]+)\}/g, (_match, key: string) => {
    const value = readPath(args, key)
    if (value === undefined || value === null) {
      throw new Error(`missing required argument: ${key}`)
    }
    return encodeURIComponent(String(value))
  })
}

function readRequiredPath(input: Record<string, unknown>, path: string): unknown {
  const value = readPath(input, path)
  if (value === undefined || value === null) throw new Error(`missing required argument: ${path}`)
  return value
}

function readPath(input: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((value, part) => {
    if (value && typeof value === 'object' && part in value) {
      return (value as Record<string, unknown>)[part]
    }
    return undefined
  }, input)
}

async function safeErrorText(res: Response): Promise<string> {
  return (await res.text().catch(() => res.statusText)) || res.statusText
}
