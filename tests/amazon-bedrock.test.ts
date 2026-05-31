import { describe, expect, it } from 'vitest'
import { amazonBedrockConnector } from '../src/connectors/adapters/amazon-bedrock.js'

describe('amazon-bedrock adapter manifest', () => {
  it('exposes the amazon-bedrock kind, "other" category, and advisory consistency', () => {
    expect(amazonBedrockConnector.manifest.kind).toBe('amazon-bedrock')
    expect(amazonBedrockConnector.manifest.category).toBe('other')
    expect(amazonBedrockConnector.manifest.defaultConsistencyModel).toBe('advisory')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape; AWS keys signed at the gateway)', () => {
    const auth = amazonBedrockConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/aws/i)
  })

  it('covers model invocation, conversation, streaming, and foundation-model discovery', () => {
    const names = amazonBedrockConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'models.list',
        'models.get',
        'model.invoke',
        'model.converse',
        'model.invoke.stream',
      ].sort(),
    )
    const reads = amazonBedrockConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = amazonBedrockConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['models.get', 'models.list'].sort())
    expect(mutations).toEqual(
      ['model.converse', 'model.invoke', 'model.invoke.stream'].sort(),
    )
  })

  it('marks generative invocations as cas="none" with externalEffect (non-idempotent sampling)', () => {
    const byName = new Map(amazonBedrockConnector.manifest.capabilities.map((c) => [c.name, c]))
    const invoke = byName.get('model.invoke')
    const converse = byName.get('model.converse')
    const stream = byName.get('model.invoke.stream')
    if (
      !invoke ||
      invoke.class !== 'mutation' ||
      !converse ||
      converse.class !== 'mutation' ||
      !stream ||
      stream.class !== 'mutation'
    ) {
      throw new Error('expected mutation capabilities')
    }
    expect(invoke.cas).toBe('none')
    expect(converse.cas).toBe('none')
    expect(stream.cas).toBe('none')
  })
})
