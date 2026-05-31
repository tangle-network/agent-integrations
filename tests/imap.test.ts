import { describe, expect, it } from 'vitest'
import { imapConnector } from '../src/connectors/adapters/imap.js'

describe('imap adapter manifest', () => {
  it('classifies itself as the database category and exposes the imap kind', () => {
    expect(imapConnector.manifest.kind).toBe('imap')
    expect(imapConnector.manifest.category).toBe('database')
    expect(imapConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = imapConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: mark as read, copy, move, delete', () => {
    const names = imapConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['emails.copy', 'emails.delete', 'emails.mark-as-read', 'emails.move'])
    const mutations = imapConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['emails.copy', 'emails.delete', 'emails.mark-as-read', 'emails.move'])
  })
})
