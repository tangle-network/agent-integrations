import {
  CONNECTOR_ADAPTER_FACTORIES,
  type ConnectorAdapterFactoryDefinition,
} from './adapters/factories.js'
import * as bundledAdapters from './adapters/index.js'
import type { ConnectorAdapter, ConnectorManifest } from './types.js'

/**
 * The bundled adapter registry — the single source of truth for "which
 * connectors does this package actually implement, and how do they really
 * authenticate".
 *
 * This exists because the answer was previously maintained by hand in two
 * places that drifted apart: `specs/registry.ts` carried an 18-name
 * `EXECUTABLE_KINDS` set while the package shipped 530 adapters, and the
 * platform kept its own private `collectBundledAdapters()` copy. A catalog
 * that describes connectors must derive from the connectors, never restate
 * them — restating is what let QuickBooks and Xero advertise a
 * `https://example.invalid/...` authorization URL behind a live Connect
 * button.
 *
 * Manifests are static data. Factory-style adapters need client credentials
 * to *execute*, but their manifest (auth endpoints, scopes, capability list)
 * is fixed at definition time, so we instantiate them with clearly-marked
 * placeholder options purely to read that static shape. The placeholders are
 * never used to make a request — {@link listBundledAdapterManifests} returns
 * manifests, not adapters.
 */

/** Placeholder marker for factory options resolved only to read a manifest. */
const MANIFEST_PROBE_PREFIX = 'tangle-adapter-metadata-'

function isConnectorAdapter(value: unknown): value is ConnectorAdapter {
  if (!value || typeof value !== 'object') return false
  const manifest = (value as { manifest?: unknown }).manifest
  if (!manifest || typeof manifest !== 'object') return false
  return typeof (manifest as { kind?: unknown }).kind === 'string'
}

function manifestFromFactory(
  definition: ConnectorAdapterFactoryDefinition,
): ConnectorManifest | undefined {
  const probeOptions = Object.fromEntries(
    Object.keys(definition.envMap).map((name) => [name, `${MANIFEST_PROBE_PREFIX}${name}`]),
  )
  try {
    return definition.factory(probeOptions).manifest
  } catch {
    // A factory that cannot be constructed from placeholder options cannot
    // contribute a manifest. Skipping is correct: it means the adapter is not
    // describable without real credentials, so the catalog must not claim it.
    return undefined
  }
}

let cachedManifests: ConnectorManifest[] | undefined
let cachedByKind: Map<string, ConnectorManifest> | undefined

function buildRegistry(): Map<string, ConnectorManifest> {
  const byKind = new Map<string, ConnectorManifest>()
  for (const value of Object.values(bundledAdapters)) {
    if (isConnectorAdapter(value)) byKind.set(value.manifest.kind, value.manifest)
  }
  for (const definition of CONNECTOR_ADAPTER_FACTORIES) {
    if (byKind.has(definition.kind)) continue
    const manifest = manifestFromFactory(definition)
    if (manifest) byKind.set(manifest.kind, manifest)
  }
  return byKind
}

function registry(): Map<string, ConnectorManifest> {
  if (!cachedByKind) cachedByKind = buildRegistry()
  return cachedByKind
}

/** Every connector manifest this package bundles, sorted by kind. */
export function listBundledAdapterManifests(): ConnectorManifest[] {
  if (!cachedManifests) {
    cachedManifests = [...registry().values()].sort((a, b) => a.kind.localeCompare(b.kind))
  }
  return cachedManifests
}

/** The bundled manifest for `kind`, or undefined when nothing implements it. */
export function getBundledAdapterManifest(kind: string): ConnectorManifest | undefined {
  return registry().get(kind)
}

/** Whether this package ships a real, executable adapter for `kind`. */
export function hasBundledAdapter(kind: string): boolean {
  return registry().has(kind)
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
 * treats "oauth2 without an authorizationUrl" as broken would wrongly condemn
 * these machine-to-machine providers.
 */
export type BundledAuthMode =
  | 'oauth2'
  | 'oauth2_client_credentials'
  | 'api_key'
  | 'hmac'
  | 'none'

/** The auth mode a connect flow would actually drive for this manifest,
 *  resolving `one_of` through its declared `preferred` mode. */
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

/** The authorization-code OAuth2 branch of a manifest's auth spec, if it has
 *  one. `one_of` manifests are resolved through their `preferred` mode, which
 *  is the mode a connect flow would actually drive. Returns undefined for
 *  api-key/hmac/none connectors and for `client_credentials` OAuth (which has
 *  no user-facing authorize step). */
export function bundledOAuth2Auth(manifest: ConnectorManifest):
  | {
      authorizationUrl: string
      tokenUrl: string
      scopes: string[]
      clientIdEnv: string
      clientSecretEnv: string
      extraAuthParams?: Record<string, string>
    }
  | undefined {
  const auth = manifest.auth
  const candidates =
    auth.kind === 'one_of'
      ? auth.options.filter((option) => option.kind === auth.preferred)
      : [auth]
  for (const candidate of candidates) {
    if (candidate.kind !== 'oauth2') continue
    if (candidate.grantType === 'client_credentials') continue
    if (!candidate.authorizationUrl) continue
    return {
      authorizationUrl: candidate.authorizationUrl,
      tokenUrl: candidate.tokenUrl,
      scopes: candidate.scopes,
      clientIdEnv: candidate.clientIdEnv,
      clientSecretEnv: candidate.clientSecretEnv,
      extraAuthParams: candidate.extraAuthParams,
    }
  }
  return undefined
}
