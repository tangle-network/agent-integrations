import { describe, expect, it } from 'vitest'
import {
  buildActivepiecesConnectors,
  buildIntegrationToolCatalog,
  listActivepiecesCatalogEntries,
  searchIntegrationTools,
} from '../src/index'

describe('Activepieces community catalog import', () => {
  it('vendors the MIT community connector catalog as normalized metadata', () => {
    const entries = listActivepiecesCatalogEntries()
    const ids = entries.map((entry) => entry.id)

    expect(entries.length).toBeGreaterThanOrEqual(650)
    expect(new Set(ids).size).toBe(ids.length)
    expect(entries.find((entry) => entry.id === 'slack')).toMatchObject({
      title: 'Slack',
      source: {
        repository: 'https://github.com/activepieces/activepieces',
        license: 'MIT',
      },
    })
  })

  it('converts imported pieces into our standard IntegrationConnector contract', () => {
    const connectors = buildActivepiecesConnectors()
    const slack = connectors.find((connector) => connector.id === 'slack')

    expect(connectors.length).toBeGreaterThanOrEqual(650)
    expect(slack?.providerId).toBe('activepieces')
    expect(slack?.metadata).toMatchObject({
      source: 'activepieces-community',
      executable: false,
      runtime: 'activepieces-piece',
      catalogOnly: true,
      license: 'MIT',
    })
    expect(slack?.actions.some((action) => action.id.includes('send.message'))).toBe(true)
    expect(slack?.triggers?.length).toBeGreaterThan(0)
  })

  it('feeds the normal agent tool search path', () => {
    const tools = buildIntegrationToolCatalog(buildActivepiecesConnectors())
    const results = searchIntegrationTools(tools, 'send a slack message', { maxRisk: 'write' })

    expect(results[0].tool.connectorId).toBe('slack')
  })
})
