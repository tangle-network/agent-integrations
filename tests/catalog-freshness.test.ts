import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  auditIntegrationCatalogFreshness,
  auditTangleIntegrationCatalogFreshness,
  extractActivepiecesPublicPieceCount,
  extractExternalCatalogPublicCount,
} from '../src/index'
import { buildRuntimeBundledAdapterManifests } from '../src/connectors/bundled-manifest-runtime'
import { assertBundledManifestSnapshotFresh } from '../scripts/bundled-manifest-snapshot.mjs'

describe('integration catalog freshness audit', () => {
  it('reports local catalog breadth, support tiers, and dedupe conflict samples', async () => {
    const result = await auditIntegrationCatalogFreshness()

    expect(result.ok).toBe(true)
    expect(result.local.activepiecesEntries).toBeGreaterThanOrEqual(650)
    expect(result.local.activepiecesConnectors).toBe(result.local.activepiecesEntries)
    expect(result.local.activepiecesActions).toBeGreaterThan(3_000)
    expect(result.local.activepiecesTriggers).toBeGreaterThan(500)
    // The provider lists every catalog connector, but tools and actions are
    // built only from entries with real catalog actions. The trigger-only /
    // framework-internal entries surface as unsupportedExecutableConnectorIds
    // rather than being fabricated into executable records.
    expect(result.local.executableActivepiecesConnectors).toBe(result.local.activepiecesEntries)
    expect(result.local.executableActivepiecesActions).toBeGreaterThan(3_000)
    expect(result.local.executableToolDefinitions).toBe(result.local.executableActivepiecesActions)
    expect(result.local.unsupportedExecutableConnectorIds.length).toBeGreaterThan(0)
    expect(result.local.unsupportedExecutableConnectorIds.length).toBeLessThan(
      result.local.activepiecesEntries,
    )
    expect(result.local.registrySummary.totalEntries).toBeGreaterThanOrEqual(650)
    expect(result.local.registrySummary.bySupportTier.catalogOnly).toBeGreaterThan(
      result.local.registrySummary.bySupportTier.setupReady,
    )
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

  it('rejects mutated bundled metadata before packaging', () => {
    const snapshot = JSON.parse(readFileSync(new URL('../data/bundled-adapter-manifests.json', import.meta.url), 'utf8')) as Array<Record<string, unknown>>
    snapshot[0] = { ...snapshot[0], description: `${String(snapshot[0]?.description ?? '')} stale` }

    expect(() => assertBundledManifestSnapshotFresh({
      snapshot: `${JSON.stringify(snapshot)}\n`,
      manifests: buildRuntimeBundledAdapterManifests(),
    })).toThrow(/snapshot is stale/i)
  })
})
