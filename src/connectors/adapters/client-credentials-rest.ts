import { createHash } from 'node:crypto'
import {
  type ConnectorAdapter,
  type ConnectorCredentials,
  type ResolvedDataSource,
  CredentialsExpired,
  ProviderRateLimited,
} from '../types.js'
import {
  declarativeRestConnector,
  type RestCredentialPlacement,
  type RestConnectorSpec,
} from './declarative-rest.js'

export interface ClientCredentialsRegion {
  apiBaseUrl: string
  tokenUrl: string
}

export interface ClientCredentialsRestSpec
  extends Omit<RestConnectorSpec, 'baseUrl' | 'allowedBaseUrls' | 'allowedBaseUrlSuffixes' | 'credentialPlacement'> {
  regions: Readonly<Record<string, ClientCredentialsRegion>>
  defaultRegion: string
  regionMetadataKey?: string
  defaultScope?: string
  tokenCredentialPlacement?: 'basic' | 'form-body'
  apiCredentialPlacement?: RestCredentialPlacement
}

interface CredentialBundle {
  clientId: string
  clientSecret: string
  region?: string
  scope?: string
}

interface CachedToken {
  fingerprint: string
  accessToken: string
  expiresAt: number
}

/**
 * Wrap a declarative REST connector whose customer-owned client credentials
 * must first be exchanged against a region-specific token endpoint.
 *
 * Tokens are kept only in this adapter instance, keyed by connection id and a
 * one-way credential fingerprint. Client ids/secrets remain in the encrypted
 * connection envelope and are never copied into metadata or error messages.
 */
export function clientCredentialsRestConnector(spec: ClientCredentialsRestSpec): ConnectorAdapter {
  const regionMetadataKey = spec.regionMetadataKey ?? 'region'
  const delegated = declarativeRestConnector({
    ...spec,
    baseUrl: { metadataKey: '__clientCredentialsApiBaseUrl' },
    allowedBaseUrls: Object.values(spec.regions).map((region) => region.apiBaseUrl),
    credentialPlacement: spec.apiCredentialPlacement ?? { kind: 'bearer' },
  })
  const tokens = new Map<string, CachedToken>()
  const pending = new Map<string, { fingerprint: string; promise: Promise<CachedToken> }>()

  async function authenticatedSource(source: ResolvedDataSource): Promise<ResolvedDataSource> {
    const bundle = readCredentialBundle(source.credentials)
    const regionName = readRegionName(bundle, source.metadata, regionMetadataKey, spec.defaultRegion)
    const region = spec.regions[regionName]
    if (!region) {
      throw new Error(`${spec.kind}: unsupported region ${regionName}; expected one of ${Object.keys(spec.regions).join(', ')}`)
    }
    const resolvedRegion = {
      ...region,
      tokenUrl: renderConnectionMetadata(region.tokenUrl, source.metadata),
    }
    const scope = bundle.scope ?? spec.defaultScope
    const fingerprint = credentialFingerprint(bundle, resolvedRegion, scope)
    const cached = tokens.get(source.id)
    if (cached?.fingerprint === fingerprint && cached.expiresAt > Date.now() + 60_000) {
      return withAccessToken(source, resolvedRegion.apiBaseUrl, cached.accessToken)
    }
    if (cached) tokens.delete(source.id)

    const inFlight = pending.get(source.id)
    if (inFlight?.fingerprint === fingerprint) {
      const token = await inFlight.promise
      return withAccessToken(source, resolvedRegion.apiBaseUrl, token.accessToken)
    }

    const promise = exchangeClientCredentials(
      spec.displayName,
      source.id,
      bundle,
      resolvedRegion,
      fingerprint,
      scope,
      spec.tokenCredentialPlacement ?? 'basic',
    )
    pending.set(source.id, { fingerprint, promise })
    try {
      const token = await promise
      if (pending.get(source.id)?.promise === promise) cacheToken(tokens, source.id, token)
      return withAccessToken(source, resolvedRegion.apiBaseUrl, token.accessToken)
    } finally {
      if (pending.get(source.id)?.promise === promise) pending.delete(source.id)
    }
  }

  return {
    manifest: delegated.manifest,
    executeRead: delegated.executeRead
      ? async (invocation) => delegated.executeRead!({
          ...invocation,
          source: await authenticatedSource(invocation.source),
        })
      : undefined,
    executeMutation: delegated.executeMutation
      ? async (invocation) => delegated.executeMutation!({
          ...invocation,
          source: await authenticatedSource(invocation.source),
        })
      : undefined,
    async test(source) {
      try {
        return delegated.test(await authenticatedSource(source))
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : 'unknown error' }
      }
    },
  }
}

function cacheToken(tokens: Map<string, CachedToken>, sourceId: string, token: CachedToken): void {
  tokens.set(sourceId, token)
  const timeout = setTimeout(() => {
    if (tokens.get(sourceId) === token) tokens.delete(sourceId)
  }, Math.max(0, token.expiresAt - Date.now()))
  timeout.unref()
}

function readCredentialBundle(credentials: ConnectorCredentials): CredentialBundle {
  let values: Record<string, unknown>
  if (credentials.kind === 'custom') {
    values = credentials.values
  } else if (credentials.kind === 'api-key') {
    try {
      const parsed = JSON.parse(credentials.apiKey) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
      values = parsed as Record<string, unknown>
    } catch {
      throw new Error('client credentials require a JSON object in the API-key field')
    }
  } else {
    throw new Error(`client credentials require custom or API-key credentials, got ${credentials.kind}`)
  }
  const clientId = requiredString(values.clientId, 'clientId')
  const clientSecret = requiredString(values.clientSecret, 'clientSecret')
  return {
    clientId,
    clientSecret,
    region: optionalString(values.region, 'region'),
    scope: optionalString(values.scope, 'scope'),
  }
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`client credentials are missing ${field}`)
  return value.trim()
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') throw new Error(`client credentials ${field} must be a string`)
  return value.trim()
}

function readRegionName(
  bundle: CredentialBundle,
  metadata: Record<string, unknown>,
  metadataKey: string,
  fallback: string,
): string {
  const metadataRegion = metadata[metadataKey]
  if (metadataRegion !== undefined && typeof metadataRegion !== 'string') {
    throw new Error(`connection metadata.${metadataKey} must be a string`)
  }
  return (bundle.region ?? metadataRegion ?? fallback).toLowerCase().trim()
}

function credentialFingerprint(
  bundle: CredentialBundle,
  region: ClientCredentialsRegion,
  scope: string | undefined,
): string {
  return createHash('sha256')
    .update(bundle.clientId)
    .update('\0')
    .update(bundle.clientSecret)
    .update('\0')
    .update(region.tokenUrl)
    .update('\0')
    .update(scope ?? '')
    .digest('hex')
}

function renderConnectionMetadata(template: string, metadata: Record<string, unknown>): string {
  const rendered = template.replace(/\{connection\.([a-zA-Z0-9_.-]+)\}/g, (_match, key: string) => {
    const value = key.split('.').reduce<unknown>((current, part) => {
      if (current && typeof current === 'object' && part in current) {
        return (current as Record<string, unknown>)[part]
      }
      return undefined
    }, metadata)
    if (typeof value !== 'string' || !value.trim()) throw new Error(`missing metadata.${key}`)
    return encodeURIComponent(value.trim())
  })
  const url = new URL(rendered)
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('client-credentials token URL must be HTTPS without embedded credentials')
  }
  return url.href
}

async function exchangeClientCredentials(
  displayName: string,
  sourceId: string,
  bundle: CredentialBundle,
  region: ClientCredentialsRegion,
  fingerprint: string,
  scope?: string,
  credentialPlacement: 'basic' | 'form-body' = 'basic',
): Promise<CachedToken> {
  const body = new URLSearchParams({ grant_type: 'client_credentials' })
  if (scope) body.set('scope', scope)
  if (credentialPlacement === 'form-body') {
    body.set('client_id', bundle.clientId)
    body.set('client_secret', bundle.clientSecret)
  }
  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/x-www-form-urlencoded',
  }
  if (credentialPlacement === 'basic') {
    headers.authorization = `Basic ${Buffer.from(`${bundle.clientId}:${bundle.clientSecret}`).toString('base64')}`
  }
  const response = await fetch(region.tokenUrl, {
    method: 'POST',
    headers,
    body: body.toString(),
    signal: AbortSignal.timeout(20_000),
  })
  if (response.status === 429) {
    throw new ProviderRateLimited(`${displayName} token endpoint rate limit (429)`, sourceId, {
      status: 429,
      retryAfterMs: retryAfterMs(response.headers.get('retry-after')),
    })
  }
  if (response.status === 400 || response.status === 401 || response.status === 403) {
    throw new CredentialsExpired(`${displayName} rejected client credentials (${response.status})`, sourceId, {
      status: response.status,
    })
  }
  if (!response.ok) throw new Error(`${displayName} token exchange failed (${response.status})`)

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new Error(`${displayName} token exchange returned malformed JSON`)
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`${displayName} token exchange returned an invalid response`)
  }
  const values = payload as Record<string, unknown>
  const accessToken = requiredString(values.access_token, 'access_token')
  const expiresIn = Number(values.expires_in ?? 3600)
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new Error(`${displayName} token exchange returned an invalid expires_in`)
  }
  return {
    fingerprint,
    accessToken,
    expiresAt: Date.now() + Math.round(expiresIn * 1000),
  }
}

function withAccessToken(source: ResolvedDataSource, apiBaseUrl: string, accessToken: string): ResolvedDataSource {
  return {
    ...source,
    metadata: { ...source.metadata, __clientCredentialsApiBaseUrl: apiBaseUrl },
    credentials: { kind: 'oauth2', accessToken },
  }
}

function retryAfterMs(raw: string | null): number {
  if (!raw) return 60_000
  const seconds = Number(raw)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.max(1_000, Math.round(seconds * 1000))
  const at = Date.parse(raw)
  return Number.isFinite(at) ? Math.max(1_000, at - Date.now()) : 60_000
}
