import { describe, expect, it } from 'vitest'
import { huggingfaceConnector } from '../src/connectors/adapters/huggingface.js'
import { validateConnectorManifest } from '../src/connectors/types.js'

describe('huggingface adapter manifest', () => {
  it('requires the scope families documented in the hint on each capability', () => {
    const byName = new Map(huggingfaceConnector.manifest.capabilities.map((c) => [c.name, c]))
    expect(byName.get('auth.whoami')?.requiredScopes).toEqual(['read-repos'])
    expect(byName.get('models.list')?.requiredScopes).toEqual(['read-repos'])
    expect(byName.get('repos.create')?.requiredScopes).toEqual(['write-repos'])
    expect(byName.get('repos.delete')?.requiredScopes).toEqual(['write-repos'])
    expect(byName.get('discussions.create')?.requiredScopes).toEqual(['discussion'])
    expect(byName.get('inference.chat_completions')?.requiredScopes).toEqual(['inference-api'])
  })

})
