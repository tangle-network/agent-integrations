import { describe, expect, it } from 'vitest'
import { kapsoConnector } from '../src/connectors/adapters/kapso.js'

describe('kapso adapter manifest', () => {
  it('classifies itself as the comms category and exposes the kapso kind', () => {
    expect(kapsoConnector.manifest.kind).toBe('kapso')
    expect(kapsoConnector.manifest.category).toBe('comms')
    expect(kapsoConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as the catalog says', () => {
    const auth = kapsoConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: text, media, interactive, template, and reaction ops', () => {
    const names = kapsoConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'messages.mark_as_read',
        'messages.request_location',
        'messages.send_audio',
        'messages.send_buttons',
        'messages.send_contact',
        'messages.send_document',
        'messages.send_image',
        'messages.send_list',
        'messages.send_location',
        'messages.send_reaction',
        'messages.send_sticker',
        'messages.send_template',
        'messages.send_text',
        'messages.send_video',
      ].sort(),
    )
    const reads = kapsoConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = kapsoConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual([])
    expect(mutations).toEqual(
      [
        'messages.mark_as_read',
        'messages.request_location',
        'messages.send_audio',
        'messages.send_buttons',
        'messages.send_contact',
        'messages.send_document',
        'messages.send_image',
        'messages.send_list',
        'messages.send_location',
        'messages.send_reaction',
        'messages.send_sticker',
        'messages.send_template',
        'messages.send_text',
        'messages.send_video',
      ].sort(),
    )
  })
})
