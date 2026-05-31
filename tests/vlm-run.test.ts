import { describe, expect, it } from 'vitest'
import { vlmRunConnector } from '../src/connectors/adapters/vlm-run.js'

describe('vlm-run adapter manifest', () => {
  it('classifies itself as the database category and exposes the vlm-run kind', () => {
    expect(vlmRunConnector.manifest.kind).toBe('vlm-run')
    expect(vlmRunConnector.manifest.category).toBe('database')
    expect(vlmRunConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with VLM Run hint', () => {
    const auth = vlmRunConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/VLM Run/i)
  })

  it('exposes analyze and file operations', () => {
    const names = vlmRunConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('analyze.audio')
    expect(names).toContain('analyze.document')
    expect(names).toContain('analyze.image')
    expect(names).toContain('analyze.video')
    expect(names).toContain('file.get')
  })

  it('marks analysis operations as mutations and file.get as read', () => {
    const mutations = vlmRunConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
    expect(mutations).toContain('analyze.audio')
    expect(mutations).toContain('analyze.document')
    expect(mutations).toContain('analyze.image')
    expect(mutations).toContain('analyze.video')

    const reads = vlmRunConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
    expect(reads).toContain('file.get')
  })
})
