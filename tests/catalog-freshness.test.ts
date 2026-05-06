import { describe, expect, it } from 'vitest'
import {
  auditIntegrationCatalogFreshness,
  auditTangleIntegrationCatalogFreshness,
  extractActivepiecesPublicPieceCount,
  extractExternalCatalogPublicCount,
} from '../src/index'

describe('integration catalog freshness audit', () => {
  it('reports local catalog breadth, support tiers, and dedupe conflict samples', async () => {
    const result = await auditIntegrationCatalogFreshness()

    expect(result.ok).toBe(true)
    expect(result.local.activepiecesEntries).toBeGreaterThanOrEqual(650)
    expect(result.local.activepiecesConnectors).toBe(result.local.activepiecesEntries)
    expect(result.local.activepiecesActions).toBeGreaterThan(3_000)
    expect(result.local.activepiecesTriggers).toBeGreaterThan(500)
    expect(result.local.executableActivepiecesConnectors).toBe(result.local.activepiecesEntries)
    expect(result.local.executableActivepiecesActions).toBeGreaterThan(3_000)
    expect(result.local.executableToolDefinitions).toBeGreaterThan(3_000)
    expect(result.local.unsupportedExecutableConnectorIds).toEqual([])
    expect(result.local.registrySummary.totalEntries).toBeGreaterThanOrEqual(650)
    expect(result.local.registrySummary.bySupportTier.catalogOnly).toBeGreaterThan(500)
    expect(result.local.conflictSamples.length).toBeGreaterThan(0)
  })

  it('parses public Activepieces catalog counts from current page copy', () => {
    expect(extractActivepiecesPublicPieceCount('Showing 701 pieces')).toBe(701)
    expect(extractExternalCatalogPublicCount('Showing 701 pieces')).toBe(701)
    expect(extractActivepiecesPublicPieceCount('701+ Integrations')).toBe(701)
  })

  it('warns when the public Activepieces catalog is ahead of the vendored catalog', async () => {
    const fetchImpl = async () =>
      new Response('<main>Showing 750 pieces</main>', { status: 200 })

    const result = await auditIntegrationCatalogFreshness({
      liveActivepieces: true,
      staleConnectorDelta: 25,
      fetchImpl,
    })

    expect(result.ok).toBe(false)
    expect(result.upstream?.activepiecesPieces).toBe(750)
    expect(result.upstream?.activepiecesDelta).toBeGreaterThan(25)
    expect(result.warnings[0]).toContain('Activepieces upstream appears')
  })

  it('exposes a Tangle-named freshness report for public release gates', async () => {
    const result = await auditTangleIntegrationCatalogFreshness()

    expect(result.ok).toBe(true)
    expect(result.local.catalogEntries).toBeGreaterThanOrEqual(650)
    expect(result.local.executableCatalogActions).toBeGreaterThan(3_000)
    expect(JSON.stringify(result)).not.toContain('activepiecesEntries')
  })
})
