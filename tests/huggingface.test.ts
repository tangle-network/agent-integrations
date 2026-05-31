import { describe, expect, it } from 'vitest'
import { huggingfaceConnector } from '../src/connectors/adapters/huggingface.js'
import { validateConnectorManifest } from '../src/connectors/types.js'

describe('huggingface adapter manifest', () => {
  it('declares kind, category, and api-key auth', () => {
    expect(huggingfaceConnector.manifest.kind).toBe('huggingface')
    expect(huggingfaceConnector.manifest.category).toBe('other')
    expect(huggingfaceConnector.manifest.auth.kind).toBe('api-key')
  })

  it('points the api-key hint at the User Access Tokens settings page and lists the scope families the connector uses', () => {
    const auth = huggingfaceConnector.manifest.auth
    if (auth.kind !== 'api-key') throw new Error('expected api-key auth')
    expect(auth.hint).toMatch(/hf_/)
    expect(auth.hint).toMatch(/huggingface\.co\/settings\/tokens/)
    expect(auth.hint).toMatch(/read-repos/)
    expect(auth.hint).toMatch(/write-repos/)
    expect(auth.hint).toMatch(/inference-api/)
  })

  it('covers Hub catalog reads, repo lifecycle, discussions, and Inference Router chat completions', () => {
    const names = huggingfaceConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'auth.whoami',
        'datasets.get',
        'datasets.list',
        'discussions.comment',
        'discussions.create',
        'discussions.list',
        'inference.chat_completions',
        'inference.models.list',
        'models.get',
        'models.list',
        'repos.create',
        'repos.delete',
        'spaces.get',
        'spaces.list',
      ].sort(),
    )
  })

  it('marks every mutation as an external effect so hub replays are recorded, and sets non-idempotent generation to cas=none', () => {
    const mutations = huggingfaceConnector.manifest.capabilities.filter((c) => c.class === 'mutation')
    expect(mutations.length).toBeGreaterThanOrEqual(5)
    for (const m of mutations) {
      if (m.class !== 'mutation') throw new Error('unreachable')
      expect(m.externalEffect).toBe(true)
    }
    const chat = huggingfaceConnector.manifest.capabilities.find((c) => c.name === 'inference.chat_completions')
    if (!chat || chat.class !== 'mutation') throw new Error('expected chat_completions mutation')
    expect(chat.cas).toBe('none')
    const create = huggingfaceConnector.manifest.capabilities.find((c) => c.name === 'discussions.create')
    if (!create || create.class !== 'mutation') throw new Error('expected discussions.create mutation')
    expect(create.cas).toBe('none')
    const reposCreate = huggingfaceConnector.manifest.capabilities.find((c) => c.name === 'repos.create')
    if (!reposCreate || reposCreate.class !== 'mutation') throw new Error('expected repos.create mutation')
    expect(reposCreate.cas).toBe('native-idempotency')
  })

  it('requires the scope families documented in the hint on each capability', () => {
    const byName = new Map(huggingfaceConnector.manifest.capabilities.map((c) => [c.name, c]))
    expect(byName.get('auth.whoami')?.requiredScopes).toEqual(['read-repos'])
    expect(byName.get('models.list')?.requiredScopes).toEqual(['read-repos'])
    expect(byName.get('repos.create')?.requiredScopes).toEqual(['write-repos'])
    expect(byName.get('repos.delete')?.requiredScopes).toEqual(['write-repos'])
    expect(byName.get('discussions.create')?.requiredScopes).toEqual(['discussion'])
    expect(byName.get('inference.chat_completions')?.requiredScopes).toEqual(['inference-api'])
  })

  it('passes the shared manifest validator', () => {
    expect(validateConnectorManifest(huggingfaceConnector.manifest)).toEqual({ ok: true, issues: [] })
  })

  it('only ships read + mutation handlers when manifest declares them', () => {
    const hasReads = huggingfaceConnector.manifest.capabilities.some((c) => c.class === 'read')
    const hasMutations = huggingfaceConnector.manifest.capabilities.some((c) => c.class === 'mutation')
    expect(Boolean(huggingfaceConnector.executeRead)).toBe(hasReads)
    expect(Boolean(huggingfaceConnector.executeMutation)).toBe(hasMutations)
  })
})
