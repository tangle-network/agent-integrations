import { describe, expect, it } from 'vitest'
import { assemblyaiConnector } from '../src/connectors/adapters/assemblyai.js'

describe('assemblyai adapter manifest', () => {
  it('exposes the assemblyai kind, "other" category, and authoritative consistency', () => {
    expect(assemblyaiConnector.manifest.kind).toBe('assemblyai')
    expect(assemblyaiConnector.manifest.category).toBe('other')
    expect(assemblyaiConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth with an assemblyai-specific hint', () => {
    const auth = assemblyaiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/assemblyai/i)
  })

  it('covers the transcripts CRUD, derived views, and LeMUR generation surface', () => {
    const names = assemblyaiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'transcripts.submit',
        'transcripts.get',
        'transcripts.list',
        'transcripts.delete',
        'transcripts.paragraphs',
        'transcripts.sentences',
        'transcripts.subtitles',
        'transcripts.word_search',
        'transcripts.redacted_audio',
        'lemur.summary',
        'lemur.question_answer',
        'lemur.action_items',
        'lemur.task',
        'lemur.response',
        'lemur.purge',
      ].sort(),
    )
    const reads = assemblyaiConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = assemblyaiConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      [
        'lemur.response',
        'transcripts.get',
        'transcripts.list',
        'transcripts.paragraphs',
        'transcripts.redacted_audio',
        'transcripts.sentences',
        'transcripts.subtitles',
        'transcripts.word_search',
      ].sort(),
    )
    expect(mutations).toEqual(
      [
        'lemur.action_items',
        'lemur.purge',
        'lemur.question_answer',
        'lemur.summary',
        'lemur.task',
        'transcripts.delete',
        'transcripts.submit',
      ].sort(),
    )
  })

  it('marks transcript + LeMUR generation as cas="none" and delete/purge as native-idempotency', () => {
    const byName = new Map(assemblyaiConnector.manifest.capabilities.map((c) => [c.name, c]))
    const submit = byName.get('transcripts.submit')
    const deleteTranscript = byName.get('transcripts.delete')
    const lemurTask = byName.get('lemur.task')
    const lemurPurge = byName.get('lemur.purge')
    if (
      !submit ||
      submit.class !== 'mutation' ||
      !deleteTranscript ||
      deleteTranscript.class !== 'mutation' ||
      !lemurTask ||
      lemurTask.class !== 'mutation' ||
      !lemurPurge ||
      lemurPurge.class !== 'mutation'
    ) {
      throw new Error('expected mutation capabilities')
    }
    expect(submit.cas).toBe('none')
    expect(lemurTask.cas).toBe('none')
    expect(deleteTranscript.cas).toBe('native-idempotency')
    expect(lemurPurge.cas).toBe('native-idempotency')
  })
})
