export {
  bundledApiKeyHint,
  bundledAuthMode,
  bundledOAuth2Auth,
  bundledOAuth2AuthContract,
  getBundledAdapterManifest,
  hasBundledAdapter,
  listBundledAdapterKinds,
  listBundledAdapterManifests,
} from './bundled-manifest-data.js'
export type {
  BundledAuthMode,
  BundledOAuth2AuthContract,
} from './bundled-manifest-data.js'

/**
 * Direct adapter instances that public catalog and action hosts may register.
 *
 * Factory adapters are intentionally absent: their construction requires
 * product-owned OAuth configuration. Inbound-only adapters remain available
 * as named exports for webhook hosts, but never compete with action adapters
 * for a public connector kind.
 */
export { listBundledConnectorAdapters } from './bundled-manifest-runtime.js'
