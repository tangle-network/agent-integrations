import { describe, expect, it } from 'vitest'
import {
  CONNECTOR_ADAPTER_FACTORIES,
  resolveConnectorAdapterFactoryOptions,
} from '../src/connectors/adapters/index.js'

const expectedProviders = {
  'amazon-s3': { actions: 9, env: [] },
  'google-cloud-storage': {
    actions: 12,
    env: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'],
  },
  backblaze: { actions: 5, env: [] },
  cloudinary: { actions: 5, env: [] },
  coda: { actions: 15, env: [] },
  confluence: {
    actions: 10,
    env: ['ATLASSIAN_OAUTH_CLIENT_ID', 'ATLASSIAN_OAUTH_CLIENT_SECRET'],
  },
  contentful: {
    actions: 7,
    env: ['CONTENTFUL_OAUTH_CLIENT_ID', 'CONTENTFUL_OAUTH_CLIENT_SECRET'],
  },
} as const

describe('knowledge and file-storage provider factories', () => {
  it('registers all seven direct adapters with their complete action surfaces', () => {
    for (const [kind, expected] of Object.entries(expectedProviders)) {
      const definition = CONNECTOR_ADAPTER_FACTORIES.find(
        (candidate) => candidate.kind === kind,
      )
      expect(definition, kind).toBeDefined()
      expect(
        definition!.factory({}).manifest.capabilities.length,
        kind,
      ).toBe(expected.actions)
      expect(Object.values(definition!.envMap), kind).toEqual(expected.env)
    }
  })

  it('registers connection-owned API credentials without deployment secrets', () => {
    for (const kind of ['amazon-s3', 'backblaze', 'cloudinary', 'coda']) {
      const definition = CONNECTOR_ADAPTER_FACTORIES.find(
        (candidate) => candidate.kind === kind,
      )
      expect(definition, kind).toBeDefined()
      expect(resolveConnectorAdapterFactoryOptions(definition!, {}), kind).toEqual({})
    }
  })

  it('fails closed when an OAuth provider has only one application credential', () => {
    for (const kind of ['google-cloud-storage', 'confluence', 'contentful']) {
      const definition = CONNECTOR_ADAPTER_FACTORIES.find(
        (candidate) => candidate.kind === kind,
      )
      const [clientIdEnv] = Object.values(definition!.envMap)
      expect(resolveConnectorAdapterFactoryOptions(definition!, {
        [String(clientIdEnv)]: 'client-id-only',
      }), kind).toBeNull()
    }
  })

  it('does not invent factories for providers without direct adapters', () => {
    const factoryKinds = new Set(
      CONNECTOR_ADAPTER_FACTORIES.map((definition) => definition.kind),
    )
    for (const kind of [
      'azure-blob-storage',
      'egnyte',
      'citrix-sharefile',
      'imanage',
      'netdocuments',
      'highq',
    ]) {
      expect(factoryKinds.has(kind), kind).toBe(false)
    }
  })
})
