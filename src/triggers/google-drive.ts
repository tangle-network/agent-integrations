import { createHash } from 'node:crypto'
import type { HostedTriggerDefinition, PolledRecord } from './types.js'

const KIND = 'google-drive-changes-v1'
interface Position { kind: typeof KIND; pageToken: string }
interface Pending extends Position { pending: { records: PolledRecord[]; next: Position; more: boolean } }

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('google-drive: malformed change feed or cursor')
  return value as Record<string, unknown>
}
function token(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('google-drive: missing change-feed continuation; refusing to reset')
  return value
}
function position(value: unknown): Position {
  const state = object(value)
  if (state.kind !== KIND) throw new Error('google-drive: unknown cursor; refusing to reset its baseline')
  return { kind: KIND, pageToken: token(state.pageToken) }
}
function record(value: unknown): PolledRecord {
  const entry = object(value)
  if (typeof entry.key !== 'string' || !entry.key || typeof entry.occurredAt !== 'string' || !Number.isFinite(Date.parse(entry.occurredAt)) ||
    typeof entry.summary !== 'string' || entry.person !== null) throw new Error('google-drive: malformed pending change')
  return { key: entry.key, occurredAt: entry.occurredAt, person: null, summary: entry.summary, record: object(entry.record) }
}

/** Drive v3 has no change id: persist each page before admission, with identities bound to its position and ordinal. */
export const googleDriveChanged: HostedTriggerDefinition = {
  provider: 'google-drive',
  event: 'google-drive.file.changed',
  description: 'A visible Drive file changed or was removed; includes current metadata, never document contents.',
  intervalSeconds: 120,
  reads: ['get_start_page_token', 'list_changes'],
  async initialize({ read }) {
    const baseline = object(await read('get_start_page_token', {}))
    return { kind: KIND, pageToken: token(baseline.startPageToken) }
  },
  async list({ read, progress }) {
    if (!progress) throw new Error('google-drive: change feeds require pollHostedTrigger progress')
    const current = position(progress.state)
    const state = object(progress.state)
    if (state.pending !== undefined) {
      const pending = object(state.pending)
      if (!Array.isArray(pending.records) || pending.records.length > progress.limit || typeof pending.more !== 'boolean') throw new Error('google-drive: malformed pending page')
      const next = position(pending.next)
      if (pending.more && next.pageToken === current.pageToken) throw new Error('google-drive: change-feed cursor did not advance')
      const records = pending.records.map(record)
      progress.set({ state: next, more: pending.more, checkpoint: state })
      return records
    }
    const page = object(await read('list_changes', { pageToken: current.pageToken, pageSize: progress.limit }))
    if (!Array.isArray(page.changes) || page.changes.length > progress.limit) throw new Error('google-drive: missing or oversized change page')
    const more = page.nextPageToken !== undefined
    if (more && page.newStartPageToken !== undefined) throw new Error('google-drive: ambiguous change-feed continuation')
    const next: Position = { kind: KIND, pageToken: token(more ? page.nextPageToken : page.newStartPageToken) }
    if (more && next.pageToken === current.pageToken) throw new Error('google-drive: change-feed cursor did not advance')
    const records = page.changes.flatMap((value, index): PolledRecord[] => {
      const change = object(value)
      if (change.changeType === 'drive') return []
      if (change.changeType !== 'file' || typeof change.fileId !== 'string' || !change.fileId || typeof change.time !== 'string' ||
        !Number.isFinite(Date.parse(change.time)) || (change.removed !== undefined && typeof change.removed !== 'boolean')) throw new Error('google-drive: malformed file change')
      const removed = change.removed === true
      const file = removed ? null : object(change.file)
      if (file && file.id !== change.fileId) throw new Error('google-drive: file metadata identity mismatch')
      const metadata: Record<string, unknown> | null = file ? {} : null
      if (file && metadata) {
        for (const field of ['id', 'name', 'mimeType', 'modifiedTime', 'trashed', 'parents', 'version', 'size', 'webViewLink']) {
          if (file[field] !== undefined) metadata[field] = file[field]
        }
      }
      return [{ key: `change:${createHash('sha256').update(JSON.stringify([current.pageToken, index])).digest('hex')}`,
        occurredAt: change.time, person: null,
        summary: `Drive file ${removed ? 'removed' : 'changed'}: ${typeof file?.name === 'string' ? file.name : change.fileId}`,
        record: { fileId: change.fileId, time: change.time, removed, file: metadata } }]
    })
    const checkpoint: Pending = { ...current, pending: { records, next, more } }
    progress.set({ state: next, more, checkpoint })
    return records
  },
}
