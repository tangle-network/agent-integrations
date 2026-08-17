import { describe, expect, it } from 'vitest'
import { listIntegrationCoverageSpecs } from '../src/coverage-catalog.js'
import { getIntegrationSpec, resolveConnectorAuthSpec } from '../src/specs/registry.js'

describe('Nango coverage truth', () => {
  it('models Nango as an unconfigured gateway instead of an OAuth provider', () => {
    const coverage = listIntegrationCoverageSpecs().find((candidate) => candidate.id === 'nango')
    expect(coverage).toMatchObject({
      auth: 'custom',
      domains: ['integration-platform', 'gateway'],
    })

    const spec = getIntegrationSpec('nango')
    expect(spec).toMatchObject({
      kind: 'nango',
      status: 'catalog',
      auth: { mode: 'custom' },
      actions: [],
      setup: {
        credentialFields: [],
        healthcheck: { level: 'static' },
      },
    })
    expect(spec?.setup.knownQuirks?.map((quirk) => quirk.id)).toEqual(
      expect.arrayContaining(['gateway-not-provider', 'no-runtime']),
    )
    expect(resolveConnectorAuthSpec('nango')).toEqual({
      kind: 'nango',
      authKind: 'custom',
      requestedScopes: [],
    })
  })
})
