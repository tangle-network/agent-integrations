import { describe, expect, it } from 'vitest'
import { getIntegrationSpec } from '../src/specs/index.js'

describe('relationship launch provider packs', () => {
  it.each([
    'affinity',
    'zoom',
    'granola',
    'gong',
    'fathom',
    'fireflies-ai',
    'open-phone',
    'ringcentral',
    'dialpad',
    'aircall',
  ])('%s is executable with provider-backed actions', (kind) => {
    const spec = getIntegrationSpec(kind)
    expect(spec?.status).toBe('executable')
    expect(spec?.actions.length).toBeGreaterThan(0)
  })

  it.each(['dealcloud', 'otter'])('%s is an explicit non-executable commercial contract', (kind) => {
    const spec = getIntegrationSpec(kind)
    expect(spec?.status).toBe('catalog')
    expect(spec?.auth.mode).toBe('custom')
    expect(spec?.actions).toEqual([])
    expect(spec?.setup.knownQuirks).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'critical' }),
    ]))
  })

  it.each(['granola', 'gong', 'fathom', 'fireflies-ai', 'otter'])('%s declares normalized meeting events', (kind) => {
    expect(getIntegrationSpec(kind)?.triggers?.map((trigger) => trigger.id)).toEqual([
      'meeting.ended',
      'transcript.ready',
      'summary.ready',
    ])
  })

  it.each(['open-phone', 'ringcentral', 'dialpad', 'aircall'])('%s declares normalized phone events', (kind) => {
    expect(getIntegrationSpec(kind)?.triggers?.map((trigger) => trigger.id)).toEqual([
      'call.completed',
      'call.missed',
      'recording.ready',
      'transcript.ready',
      'message.received',
    ])
  })
})
