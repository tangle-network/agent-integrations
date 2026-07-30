import { describe, expect, it } from 'vitest'
import {
  CONNECTOR_ADAPTER_FACTORIES,
  resolveConnectorAdapterFactoryOptions,
} from '../src/connectors/adapters/index'

describe('document signature factory pack', () => {
  it('preserves three existing packs and activates five additional providers', () => {
    const expected = {
      docuseal: [],
      hellosign: ['HELLOSIGN_OAUTH_CLIENT_ID', 'HELLOSIGN_OAUTH_CLIENT_SECRET'],
      pandadoc: ['PANDADOC_OAUTH_CLIENT_ID', 'PANDADOC_OAUTH_CLIENT_SECRET'],
      docusign: ['DOCUSIGN_OAUTH_CLIENT_ID', 'DOCUSIGN_OAUTH_CLIENT_SECRET'],
      'adobe-sign': ['ADOBE_SIGN_OAUTH_CLIENT_ID', 'ADOBE_SIGN_OAUTH_CLIENT_SECRET'],
      ironclad: ['IRONCLAD_OAUTH_CLIENT_ID', 'IRONCLAD_OAUTH_CLIENT_SECRET'],
      'sign-now': [],
      'onespan-sign': [],
    } as const

    for (const [kind, envNames] of Object.entries(expected)) {
      const definition = CONNECTOR_ADAPTER_FACTORIES.find(
        (candidate) => candidate.kind === kind,
      )
      expect(definition, kind).toBeDefined()
      expect(Object.values(definition!.envMap)).toEqual(envNames)
      const env = Object.fromEntries(envNames.map((name) => [name, `value-${name}`]))
      const options = resolveConnectorAdapterFactoryOptions(definition!, env)
      expect(options, kind).not.toBeNull()
      expect(definition!.factory(options ?? {}).manifest.capabilities.length).toBeGreaterThan(0)
    }
  })

  it('fails closed on incomplete OAuth application settings', () => {
    for (const kind of ['docusign', 'adobe-sign', 'ironclad']) {
      const definition = CONNECTOR_ADAPTER_FACTORIES.find(
        (candidate) => candidate.kind === kind,
      )!
      const [clientIdEnv] = Object.values(definition.envMap)
      expect(resolveConnectorAdapterFactoryOptions(definition, {
        [String(clientIdEnv)]: 'client-id',
      }), kind).toBeNull()
    }
  })
})
