import { describe, expect, it } from 'vitest'
import {
  buildIntegrationCoverageConnectors,
  buildIntegrationToolCatalog,
  integrationCoverageChecklistMarkdown,
  listIntegrationCoverageSpecs,
  searchIntegrationTools,
} from '../src/index'

describe('integration coverage catalog', () => {
  it('covers 500+ high-value and long-tail integrations with unique ids', () => {
    const specs = listIntegrationCoverageSpecs()
    const ids = specs.map((spec) => spec.id)

    expect(specs.length).toBeGreaterThanOrEqual(500)
    expect(new Set(ids).size).toBe(ids.length)
    expect(specs.filter((spec) => spec.priority === 'tier_0').length).toBeGreaterThanOrEqual(25)
    expect(specs.filter((spec) => spec.priority === 'long_tail').length).toBeGreaterThanOrEqual(350)
  })

  it('builds normalized connector contracts without executable-provider claims', () => {
    const connectors = buildIntegrationCoverageConnectors()

    expect(connectors.length).toBe(listIntegrationCoverageSpecs().length)
    expect(connectors.every((connector) => connector.providerId === 'coverage')).toBe(true)
    expect(connectors.every((connector) => connector.actions.length >= 4)).toBe(true)
    expect(connectors.every((connector) => connector.metadata?.source === 'coverage-catalog')).toBe(true)
    expect(connectors.every((connector) => connector.metadata?.executable === false)).toBe(true)
  })

  it('filters the catalog by priority, category, and action pack', () => {
    const connectors = buildIntegrationCoverageConnectors({
      providerId: 'planning',
      priorities: ['tier_0'],
      categories: ['crm'],
      actionPacks: ['crm'],
    })

    expect(connectors.map((connector) => connector.id).sort()).toEqual(['hubspot', 'salesforce'])
    expect(connectors.every((connector) => connector.providerId === 'planning')).toBe(true)
  })

  it('feeds the existing tool catalog and search path', () => {
    const tools = buildIntegrationToolCatalog(buildIntegrationCoverageConnectors({
      priorities: ['tier_0'],
    }))
    const results = searchIntegrationTools(tools, 'search customer crm records', { maxRisk: 'read' })

    expect(results[0].tool.connectorId).toMatch(/hubspot|salesforce|zendesk|intercom/)
    expect(results[0].tool.risk).toBe('read')
  })

  it('renders a launch checklist from the same source of truth', () => {
    const markdown = integrationCoverageChecklistMarkdown()

    expect(markdown).toContain('# Agent Integrations Coverage Checklist')
    expect(markdown).toContain('Total cataloged integrations:')
    expect(markdown).toContain('Gmail (gmail)')
    expect(markdown).toContain('Salesforce (salesforce)')
    expect(markdown).toContain('Stripe (stripe)')
  })
})
