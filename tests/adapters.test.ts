import { describe, expect, it } from 'vitest'
import { validateConnectorManifest } from '../src/connectors/index'
import { listBundledAdapterManifests } from '../src/connectors/bundled-manifests'
import { listBundledConnectorAdapters } from '../src/connectors/bundled-manifests'
import { buildRuntimeBundledAdapterManifests } from '../src/connectors/bundled-manifest-runtime'
import { listIntegrationSpecs } from '../src/specs/index.js'

// These shipped manifests declare authoritative mutations with cas="none",
// which validateConnectorManifest rejects. The list may only shrink.
const KNOWN_INVALID_MANIFESTS = new Set([
  'aidbase',
  'aiprise',
  'amazon-sqs',
  'amplitude',
  'asknews',
  'assemblyai',
  'autocalls',
  'azure-blob-storage',
  'bamboohr',
  'baserow',
  'chat-data',
  'chatling',
  'chatnode',
  'chatwoot',
  'clicksend',
  'clickup',
  'cloudflare',
  'datadog',
  'digital-ocean',
  'discourse',
  'google-contacts',
  'google-meet',
  'google-my-business',
  'greenhouse',
  'jogg-ai',
  'kizeo-forms',
  'microsoft-power-bi',
  'okta',
  'pinecone',
  'reddit',
  'snowflake',
  'trello',
  'weaviate',
  'zoho-crm',
  'zoom',
])

// One sweep over every shipped adapter replaces per-connector tests that
// restated each manifest's literal fields.
describe('bundled adapters', () => {
  it('exposes model-safe property names in bundled and Hub spec tool schemas', () => {
    const invalid: string[] = []
    const allowed = /^[a-zA-Z0-9_.-]{1,64}$/
    const visit = (schema: unknown, path: string): void => {
      if (!schema || typeof schema !== 'object') return
      if (Array.isArray(schema)) {
        schema.forEach((entry, index) => visit(entry, `${path}[${index}]`))
        return
      }
      const object = schema as Record<string, unknown>
      if (object.properties && typeof object.properties === 'object' && !Array.isArray(object.properties)) {
        for (const key of Object.keys(object.properties)) {
          if (!allowed.test(key)) invalid.push(`${path}.properties[${JSON.stringify(key)}]`)
        }
      }
      for (const [key, value] of Object.entries(object)) visit(value, `${path}.${key}`)
    }
    for (const manifest of listBundledAdapterManifests()) {
      for (const capability of manifest.capabilities) {
        visit(capability.parameters, `${manifest.kind}.${capability.name}`)
      }
    }
    for (const spec of listIntegrationSpecs()) {
      for (const action of spec.actions) {
        visit(action.inputSchema, `Hub.${spec.kind}.${action.id}`)
      }
    }
    expect(invalid).toEqual([])
  })

  it('ship valid connector manifests', () => {
    const invalid = buildRuntimeBundledAdapterManifests()
      .filter((manifest) => !validateConnectorManifest(manifest).ok)
      .map((manifest) => manifest.kind)
      .filter((kind) => !KNOWN_INVALID_MANIFESTS.has(kind))
    expect(invalid).toEqual([])
  })

  it('only expose executable surfaces declared in the manifest', () => {
    for (const adapter of listBundledConnectorAdapters()) {
      const hasReads = adapter.manifest.capabilities.some((capability) => capability.class === 'read')
      const hasMutations = adapter.manifest.capabilities.some((capability) => capability.class === 'mutation')
      if (hasReads) expect(adapter.executeRead, `${adapter.manifest.kind} read handler`).toBeTypeOf('function')
      if (hasMutations) expect(adapter.executeMutation, `${adapter.manifest.kind} mutation handler`).toBeTypeOf('function')
    }
  })

  it('use unique adapter kind ids', () => {
    const kinds = listBundledConnectorAdapters().map((adapter) => adapter.manifest.kind)
    expect(new Set(kinds).size).toBe(kinds.length)
  })
})
