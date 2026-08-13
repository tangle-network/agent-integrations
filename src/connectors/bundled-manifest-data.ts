import type {
  ConnectorManifest,
  OAuth2UrlTemplateMetadataSpec,
} from './types.js'
import { bundledManifestData } from './bundled-manifest-data-runtime.mjs'

type EncodedManifestValue = {
  __tangleUndefined?: boolean
  [key: string]: unknown
}

const BUNDLED_UNDEFINED_MARKER = '__tangleUndefined'
const bundledManifests = bundledManifestData as unknown as EncodedManifestValue[]

restoreUndefinedValues(bundledManifests)

/** Static manifest data for every adapter shipped by this package. */
export const BUNDLED_ADAPTER_MANIFESTS = bundledManifests as unknown as ConnectorManifest[]

const manifestsByKind = new Map(
  BUNDLED_ADAPTER_MANIFESTS.map((manifest) => [manifest.kind, manifest]),
)

/** Every connector manifest this package bundles, sorted by kind. */
export function listBundledAdapterManifests(): ConnectorManifest[] {
  return BUNDLED_ADAPTER_MANIFESTS
}

/** The bundled manifest for `kind`, or undefined when nothing implements it. */
export function getBundledAdapterManifest(kind: string): ConnectorManifest | undefined {
  return manifestsByKind.get(kind)
}

/** Whether this package ships a real, executable adapter for `kind`. */
export function hasBundledAdapter(kind: string): boolean {
  return manifestsByKind.has(kind)
}

/** Kinds this package implements. */
export function listBundledAdapterKinds(): string[] {
  return listBundledAdapterManifests().map((manifest) => manifest.kind)
}

/**
 * How a bundled connector really authenticates.
 *
 * `oauth2_client_credentials` is called out separately because it IS a
 * connectable mode but has no user-facing authorize step — a caller that
 * treats "oauth2 without an authorizationUrl" as broken would wrongly
 * condemn these machine-to-machine providers.
 */
export type BundledAuthMode =
  | 'oauth2'
  | 'oauth2_client_credentials'
  | 'api_key'
  | 'hmac'
  | 'none'

/** The auth mode a connect flow would actually drive for this manifest,
 * resolving `one_of` through its declared `preferred` mode. */
export function bundledAuthMode(manifest: ConnectorManifest): BundledAuthMode | undefined {
  const auth = manifest.auth
  const effective =
    auth.kind === 'one_of'
      ? (auth.options.find((option) => option.kind === auth.preferred) ?? auth.options[0])
      : auth
  switch (effective.kind) {
    case 'oauth2':
      return effective.grantType === 'client_credentials' ? 'oauth2_client_credentials' : 'oauth2'
    case 'api-key':
      return 'api_key'
    case 'hmac':
      return 'hmac'
    case 'none':
      return 'none'
    default:
      return undefined
  }
}

/** The setup hint an api-key connector shows when collecting its credential. */
export function bundledApiKeyHint(manifest: ConnectorManifest): string | undefined {
  const auth = manifest.auth
  const candidates = auth.kind === 'one_of' ? auth.options : [auth]
  for (const candidate of candidates) {
    if (candidate.kind === 'api-key') return candidate.hint
  }
  return undefined
}

export interface BundledOAuth2AuthContract {
  grantType: 'authorization_code' | 'client_credentials'
  authorizationUrl?: string
  tokenUrl: string
  scopes: string[]
  clientIdEnv: string
  clientSecretEnv?: string
  scopeSeparator: ' ' | ','
  pkce?: 'required' | 'supported' | 'unsupported'
  authorizationClientIdParam: string
  tokenClientIdParam: string
  tokenClientSecretParam: string
  tokenClientAuthMethod: 'none' | 'client_secret_post' | 'client_secret_basic'
  sendScopeParam?: boolean
  extraAuthParams?: Record<string, string>
  tokenRequestHeaders?: Record<string, string>
  urlTemplateMetadata?: Readonly<Record<string, OAuth2UrlTemplateMetadataSpec>>
}

/** The selected OAuth2 contract for a manifest, including non-redirect
 * client-credentials providers and validated provider-root templates. */
export function bundledOAuth2AuthContract(
  manifest: ConnectorManifest,
): BundledOAuth2AuthContract | undefined {
  const auth = manifest.auth
  const candidates =
    auth.kind === 'one_of'
      ? auth.options.filter((option) => option.kind === auth.preferred)
      : [auth]
  for (const candidate of candidates) {
    if (candidate.kind !== 'oauth2') continue
    const grantType = candidate.grantType ?? 'authorization_code'
    if (grantType === 'authorization_code' && !candidate.authorizationUrl) continue
    return {
      grantType,
      authorizationUrl: candidate.authorizationUrl,
      tokenUrl: candidate.tokenUrl,
      scopes: candidate.scopes,
      clientIdEnv: candidate.clientIdEnv,
      clientSecretEnv: candidate.clientSecretEnv,
      scopeSeparator: candidate.scopeSeparator ?? ' ',
      pkce: candidate.pkce,
      authorizationClientIdParam: candidate.authorizationClientIdParam ?? 'client_id',
      tokenClientIdParam: candidate.tokenClientIdParam ?? 'client_id',
      tokenClientSecretParam: candidate.tokenClientSecretParam ?? 'client_secret',
      tokenClientAuthMethod: candidate.tokenClientAuthMethod ?? 'client_secret_post',
      sendScopeParam: candidate.sendScopeParam,
      extraAuthParams: candidate.extraAuthParams,
      tokenRequestHeaders: candidate.tokenRequestHeaders,
      urlTemplateMetadata: candidate.urlTemplateMetadata,
    }
  }
  return undefined
}

/** The authorization-code OAuth2 branch of a manifest, if it has one. */
export function bundledOAuth2Auth(manifest: ConnectorManifest):
  | (BundledOAuth2AuthContract & {
      grantType: 'authorization_code'
      authorizationUrl: string
    })
  | undefined {
  const contract = bundledOAuth2AuthContract(manifest)
  if (contract?.grantType !== 'authorization_code' || !contract.authorizationUrl) return undefined
  return {
    ...contract,
    grantType: 'authorization_code',
    authorizationUrl: contract.authorizationUrl,
  }
}

function restoreUndefinedValues(value: EncodedManifestValue | EncodedManifestValue[]): void {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const child = value[index]
      if (isUndefinedMarker(child)) {
        value[index] = undefined as unknown as EncodedManifestValue
      } else if (child && typeof child === 'object') {
        restoreUndefinedValues(child)
      }
    }
    return
  }
  for (const [key, child] of Object.entries(value)) {
    if (isUndefinedMarker(child)) {
      value[key] = undefined
    } else if (child && typeof child === 'object') {
      restoreUndefinedValues(child as EncodedManifestValue)
    }
  }
}

function isUndefinedMarker(value: unknown): value is { __tangleUndefined: true } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const entries = Object.entries(value)
  return entries.length === 1 && entries[0]?.[0] === BUNDLED_UNDEFINED_MARKER && entries[0][1] === true
}
