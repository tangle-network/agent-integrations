import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { googleDrive, type ResolvedDataSource } from '../src/connectors/index.js'
import { hostedTrigger, hostedTriggerEventCatalog, MAX_EVENTS_PER_POLL, pollHostedTrigger, type HostedTriggerCursor } from '../src/triggers/index.js'

const READONLY = 'https://www.googleapis.com/auth/drive.readonly'
const NOW = new Date('2026-01-01T00:00:00.000Z')
const change = (index: number) => ({ changeType: 'file', fileId: `file-${index}`, time: NOW.toISOString(),
  file: { id: `file-${index}`, name: `File ${index}`, mimeType: 'text/plain', content: 'must never escape' } })

describe('Drive changes through the public connector and real HTTP transport', () => {
  const networkFetch = globalThis.fetch
  const adapter = googleDrive({ clientId: 'test-client', clientSecret: 'test-secret' })
  const definition = hostedTrigger('google-drive', 'google-drive.file.changed')!
  let peer: ReturnType<typeof createServer>
  let origin: string
  let directory: string
  let pages: Map<string, unknown>
  let requests: URL[]
  let status: number
  const source: ResolvedDataSource = { id: 'drive-owner', projectId: 'test', publishedAgentId: null, kind: 'google-drive',
    label: 'Drive', consistencyModel: 'authoritative', scopes: [READONLY], metadata: {}, status: 'active',
    credentials: { kind: 'oauth2', accessToken: 'owner-token', expiresAt: Date.now() + 3_600_000 } }
  const read = async (capabilityName: string, args: Record<string, unknown>) => (await adapter.executeRead!({
    source, capabilityName, args, idempotencyKey: 'metadata-read',
  })).data
  const checkpoint = async (cursor: HostedTriggerCursor) => { await writeFile(join(directory, 'cursor.json'), JSON.stringify(cursor)) }
  const recover = async () => JSON.parse(await readFile(join(directory, 'cursor.json'), 'utf8')) as HostedTriggerCursor
  const poll = (cursor: HostedTriggerCursor | null, retain = true) => pollHostedTrigger(definition, { read, cursor, now: NOW, ...(retain ? { checkpoint } : {}) })

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'drive-cursor-'))
    pages = new Map(); requests = []; status = 200
    peer = createServer((request, response) => {
      const url = new URL(request.url!, 'http://peer')
      requests.push(url)
      expect(request.headers.authorization).toBe('Bearer owner-token')
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify(url.pathname.endsWith('/startPageToken') ? { startPageToken: 'baseline' } : pages.get(url.searchParams.get('pageToken')!)))
    })
    await new Promise<void>((resolve) => peer.listen(0, '127.0.0.1', resolve))
    const address = peer.address() as { port: number }
    origin = `http://127.0.0.1:${address.port}`
    // Only substitute routing: requests and responses use a real socket and the public connector's auth/serialization.
    globalThis.fetch = (input, init) => {
      const url = new URL(String(input))
      if (url.origin !== 'https://www.googleapis.com') throw new Error(`unexpected outbound request: ${url.origin}`)
      return networkFetch(new URL(`${url.pathname}${url.search}`, origin), init)
    }
  })
  afterEach(async () => {
    globalThis.fetch = networkFetch
    peer.closeAllConnections()
    await new Promise<void>((resolve, reject) => peer.close((error) => error ? reject(error) : resolve()))
    await rm(directory, { recursive: true, force: true })
  })

  it('baselines without history, pages beyond the cap, retains removals and equal timestamps with readonly metadata', async () => {
    const baseline = await poll(null)
    expect(baseline.events).toEqual([])
    expect(requests.map((url) => url.pathname)).toEqual(['/drive/v3/changes/startPageToken'])
    pages.set('baseline', { changes: Array.from({ length: MAX_EVENTS_PER_POLL }, (_, i) => change(i)), nextPageToken: 'page-two' })
    pages.set('page-two', { changes: [change(50), { changeType: 'file', fileId: 'deleted', time: NOW.toISOString(), removed: true }], newStartPageToken: 'settled' })
    const first = await poll(baseline.cursor)
    expect(first.events).toHaveLength(MAX_EVENTS_PER_POLL)
    expect(first.more).toBe(true)
    const second = await poll(first.cursor)
    expect(second.events).toHaveLength(2)
    expect(second.more).toBe(false)
    expect(new Set([...first.events, ...second.events].map((event) => event.id)).size).toBe(52)
    expect(second.events[1].record).toEqual({ fileId: 'deleted', time: NOW.toISOString(), removed: true, file: null })
    expect(JSON.stringify(first.events)).not.toContain('must never escape')
    for (const url of requests.slice(1)) {
      expect(url.searchParams.get('pageSize')).toBe(String(MAX_EVENTS_PER_POLL))
      expect(url.searchParams.get('includeRemoved')).toBe('true')
      expect(url.searchParams.get('fields')).not.toMatch(/content|permissions|export|media/)
    }
    for (const name of definition.reads) expect(adapter.manifest.capabilities.find((capability) => capability.name === name)).toMatchObject({ class: 'read', requiredScopes: [READONLY] })
    expect(hostedTriggerEventCatalog('google-drive')).toEqual({ namespace: 'google-drive.', closed: true, events: [{ id: definition.event }] })
  })

  it('retains the exact page before admission and replays it after restart despite upstream mutation', async () => {
    const baseline = await poll(null)
    pages.set('baseline', { changes: [change(1), change(2)], newStartPageToken: 'settled' })
    const first = await poll(baseline.cursor)
    const staged = await recover() // Process can fail after admitting only the first event.
    expect(staged.state).toMatchObject({ pageToken: 'baseline', pending: { records: [{}, {}] } })
    pages.set('baseline', { changes: [change(999)], newStartPageToken: 'wrong' })
    const calls = requests.length
    const replay = await poll(staged)
    expect(replay).toEqual(first)
    expect(requests).toHaveLength(calls)
    const admitted = new Set([first.events[0].id])
    for (const event of replay.events) admitted.add(event.id)
    expect(admitted.size).toBe(2)
    expect(replay.cursor.state).toEqual({ kind: 'google-drive-changes-v1', pageToken: 'settled' })
    await expect(poll(baseline.cursor, false)).rejects.toThrow('durable page checkpoint')
    await expect(pollHostedTrigger(definition, { read, cursor: baseline.cursor, now: NOW, checkpoint: async () => { throw new Error('disk unavailable') } })).rejects.toThrow('disk unavailable')
    expect(await recover()).toEqual(staged)
  })

  it('refuses uncertain feeds/cursors and upstream failures without advancing stored progress', async () => {
    const baseline = await poll(null)
    await checkpoint(baseline.cursor)
    const invalid = [
      {}, { changes: [] }, { changes: [], nextPageToken: 'baseline' },
      { changes: [], nextPageToken: 'two', newStartPageToken: 'three' },
      { changes: Array.from({ length: MAX_EVENTS_PER_POLL + 1 }, (_, i) => change(i)), nextPageToken: 'two' },
      { changes: [{ ...change(1), time: 'invalid' }], newStartPageToken: 'two' },
      { changes: [{ ...change(1), file: { id: 'wrong' } }], newStartPageToken: 'two' },
    ]
    for (const page of invalid) {
      pages.set('baseline', page)
      await expect(poll(baseline.cursor)).rejects.toThrow(/google-drive/)
      expect(await recover()).toEqual(baseline.cursor)
    }
    for (const state of [undefined, {}, { kind: 'wrong', pageToken: 'baseline' }, { kind: 'google-drive-changes-v1', pageToken: '' },
      { kind: 'google-drive-changes-v1', pageToken: 'baseline', pending: {} }]) {
      await expect(poll({ ...baseline.cursor, state })).rejects.toThrow(/google-drive/)
    }
    status = 503
    pages.set('baseline', { error: { message: 'unavailable' } })
    await expect(poll(baseline.cursor)).rejects.toThrow()
    expect(await recover()).toEqual(baseline.cursor)
    status = 403
    await expect(poll(null)).rejects.toThrow()
  })
})
