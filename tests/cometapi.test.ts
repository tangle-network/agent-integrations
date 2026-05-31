import { describe, expect, it } from 'vitest'
import { cometapiConnector } from '../src/connectors/adapters/cometapi.js'

describe('cometapi adapter manifest', () => {
  it('classifies itself as the other category and exposes the cometapi kind', () => {
    expect(cometapiConnector.manifest.kind).toBe('cometapi')
    expect(cometapiConnector.manifest.displayName).toBe('CometAPI')
    // 'workflow' from the activepieces catalog is not a connector category in
    // our type system; CometAPI is a unified AI inference gateway, so 'other'
    // is the honest bucket.
    expect(cometapiConnector.manifest.category).toBe('other')
    // Generation calls are non-idempotent at the model layer (replay yields a
    // fresh sample), so the only honest default consistency posture is
    // advisory, not authoritative.
    expect(cometapiConnector.manifest.defaultConsistencyModel).toBe('advisory')
  })

  it('declares api-key auth (CometAPI issues a long-lived bearer key, not OAuth)', () => {
    const auth = cometapiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('exhaustiveness check')
    expect(auth.hint).toMatch(/cometapi\.com/)
  })

  it('covers models discovery + the activepieces ask.comet.api action via chat.completions, plus the rest of the OpenAI-compatible surface', () => {
    const names = cometapiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'models.list',
        'models.get',
        'chat.completions.create',
        'completions.create',
        'embeddings.create',
        'images.generate',
      ].sort(),
    )

    const reads = cometapiConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = cometapiConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()

    expect(reads).toEqual(['models.get', 'models.list'])
    expect(mutations).toContain('chat.completions.create')
    expect(mutations).toContain('completions.create')
    expect(mutations).toContain('embeddings.create')
    expect(mutations).toContain('images.generate')
  })

  it('marks every mutation cas=none (CometAPI does not honour a server-side idempotency token; dedup is the caller MutationGuard concern)', () => {
    const mutations = cometapiConnector.manifest.capabilities.filter((c) => c.class === 'mutation')
    expect(mutations.length).toBeGreaterThan(0)
    for (const m of mutations) {
      if (m.class !== 'mutation') throw new Error('typing guard')
      expect(m.cas).toBe('none')
    }
  })
})
