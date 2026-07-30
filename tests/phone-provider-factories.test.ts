import { describe, expect, it } from 'vitest'
import {
  CONNECTOR_ADAPTER_FACTORIES,
  resolveConnectorAdapterFactoryOptions,
} from '../src/connectors/adapters/index'

describe('phone provider factory pack', () => {
  it('activates five executable phone providers', () => {
    const expected = {
      ringcentral: ['RINGCENTRAL_OAUTH_CLIENT_ID', 'RINGCENTRAL_OAUTH_CLIENT_SECRET'],
      dialpad: ['DIALPAD_OAUTH_CLIENT_ID', 'DIALPAD_OAUTH_CLIENT_SECRET'],
      aircall: [],
      'open-phone': [],
      'twilio-sms': [],
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

  it('fails closed when either OAuth application setting is missing', () => {
    for (const kind of ['ringcentral', 'dialpad']) {
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
