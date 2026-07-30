import { describe, expect, it } from 'vitest'
import {
  CONNECTOR_ADAPTER_FACTORIES,
  fathomConnector,
  resolveConnectorAdapterFactoryOptions,
} from '../src/connectors/adapters/index'

describe('meeting intelligence factory pack', () => {
  it('activates eight executable meeting providers', () => {
    const expected = {
      granola: [],
      'fireflies-ai': [],
      gong: ['GONG_OAUTH_CLIENT_ID', 'GONG_OAUTH_CLIENT_SECRET'],
      fathom: ['FATHOM_OAUTH_CLIENT_ID', 'FATHOM_OAUTH_CLIENT_SECRET'],
      avoma: [],
      'tl-dv': [],
      'meetgeek-ai': [],
      'recall-ai': [],
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

  it('keeps meeting products without a direct adapter out of the factory inventory', () => {
    for (const kind of ['otter', 'read-ai', 'grain']) {
      expect(
        CONNECTOR_ADAPTER_FACTORIES.some((candidate) => candidate.kind === kind),
        kind,
      ).toBe(false)
    }
  })

  it('fails closed when either OAuth application setting is missing', () => {
    for (const kind of ['gong', 'fathom']) {
      const definition = CONNECTOR_ADAPTER_FACTORIES.find(
        (candidate) => candidate.kind === kind,
      )!
      const [clientIdEnv] = Object.values(definition.envMap)
      expect(resolveConnectorAdapterFactoryOptions(definition, {
        [String(clientIdEnv)]: 'client-id',
      }), kind).toBeNull()
    }
  })

  it('requires IDs for Fathom team paths instead of advertising broken alternatives', () => {
    const teams = fathomConnector.manifest.capabilities.find(
      (capability) => capability.name === 'team.find',
    )
    const members = fathomConnector.manifest.capabilities.find(
      (capability) => capability.name === 'team.member.find',
    )
    expect(teams?.parameters).toMatchObject({ required: ['teamId'] })
    expect(members?.parameters).toMatchObject({ required: ['teamId', 'memberId'] })
  })
})
