/**
 * RSS / Atom feed reader — a no-auth, read-only connector that pulls the most
 * recent entries from a public feed. Two capabilities:
 *
 *   - `feed.fetch` reads the feed URL pinned in DataSource.metadata at connect
 *     time (the canonical operator flow: "watch this blog").
 *   - `feed.lookup` reads any feed URL the agent constructs at request time
 *     (the planner flow: "search the comments feed at this URL").
 *
 * The adapter parses RSS 2.0 (`<rss><channel><item>`) and Atom 1.0
 * (`<feed><entry>`) without an XML library. Both shapes are tiny, regular,
 * and stable enough to walk with a small token scanner — the alternative
 * (fast-xml-parser, sax) drags in 50–200 KB of code and a transitive dep tree
 * for two element types. The scanner unwraps CDATA, decodes the five XML
 * entity refs (`amp lt gt quot apos`), and skips siblings it doesn't care
 * about. Anything the parser can't classify as an entry is ignored.
 *
 * Normalization: every entry is reduced to a `FeedEntry` —
 *   { id, title, link, summary, content, published, updated, author, categories }
 * — so callers don't branch on RSS-vs-Atom downstream. `published` and
 * `updated` are ISO-8601 strings when the upstream provided a parseable
 * date (RFC 822 for RSS, RFC 3339 for Atom), null otherwise.
 *
 * Consistency model: `cache`. Feeds are inherently caches of the publisher's
 * authoritative store — we forward the upstream ETag/Last-Modified for
 * conditional refetches but make no claim about staleness.
 */

import {
  type Capability,
  type CapabilityReadResult,
  type ConnectorAdapter,
  type ConnectorInvocation,
  type ResolvedDataSource,
} from '../types.js'

const ALLOWED_SCHEMES = new Set(['http:', 'https:'])
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 200
const DEFAULT_TIMEOUT_MS = 15_000
const MAX_BODY_BYTES = 5 * 1024 * 1024 // 5 MiB — well above any sane feed

export interface FeedEntry {
  /** Stable cross-fetch identifier (Atom `id`, RSS `guid`, or the entry link). */
  id: string
  title: string | null
  /** Canonical entry URL (RSS `link`, Atom `<link rel="alternate" href>`). */
  link: string | null
  /** Short HTML/text excerpt (RSS `description`, Atom `summary`). */
  summary: string | null
  /** Full HTML/text body when the feed includes it (RSS `content:encoded`, Atom `content`). */
  content: string | null
  /** ISO-8601 of first publication (RSS `pubDate`, Atom `published`), or null. */
  published: string | null
  /** ISO-8601 of last update (Atom `updated`), or null. */
  updated: string | null
  author: string | null
  categories: string[]
}

export interface FeedReadResult {
  /** Channel / feed-level title (RSS `<channel><title>`, Atom `<feed><title>`). */
  feedTitle: string | null
  feedUrl: string
  /** Atom only — when present, callers can refetch only what's newer. */
  feedUpdated: string | null
  entries: FeedEntry[]
  format: 'rss' | 'atom' | 'unknown'
}

const READ_CAPABILITIES: Capability[] = [
  {
    name: 'feed.fetch',
    class: 'read',
    description:
      'Fetch and parse the RSS/Atom feed URL pinned in DataSource.metadata.feedUrl. Returns normalized entries newest-first. Forwards the upstream ETag/Last-Modified so downstream conditional reads can avoid re-parsing unchanged feeds.',
    parameters: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: `Maximum entries to return, newest first. Defaults to ${DEFAULT_LIMIT}, capped at ${MAX_LIMIT}.`,
        },
        since: {
          type: 'string',
          description:
            'ISO-8601 timestamp. When set, entries with `published` (or `updated` for Atom) strictly older than this are dropped.',
        },
      },
    },
  },
  {
    name: 'feed.lookup',
    class: 'read',
    description:
      'Fetch and parse an arbitrary RSS/Atom feed URL the agent constructs at request time (e.g. search-result feeds, comment streams). Same normalization as `feed.fetch`.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Absolute http(s) URL of the feed to fetch.' },
        limit: {
          type: 'number',
          description: `Maximum entries to return, newest first. Defaults to ${DEFAULT_LIMIT}, capped at ${MAX_LIMIT}.`,
        },
        since: {
          type: 'string',
          description:
            'ISO-8601 timestamp. When set, entries with `published` (or `updated` for Atom) strictly older than this are dropped.',
        },
      },
      required: ['url'],
    },
  },
]

export const rssConnector: ConnectorAdapter = {
  manifest: {
    kind: 'rss',
    displayName: 'RSS / Atom Feed',
    description:
      'Pull entries from any public RSS 2.0 or Atom 1.0 feed. No auth required — the operator pins one feed URL at connect time (`feed.fetch`), and the agent can also resolve ad-hoc feed URLs at request time (`feed.lookup`). The connector parses both formats and emits a normalized entry shape so downstream tools do not have to branch on the feed dialect.',
    auth: { kind: 'none' },
    category: 'webhook',
    defaultConsistencyModel: 'cache',
    capabilities: READ_CAPABILITIES,
  },

  async executeRead(inv: ConnectorInvocation): Promise<CapabilityReadResult> {
    const args = (inv.args ?? {}) as Record<string, unknown>
    const url =
      inv.capabilityName === 'feed.lookup'
        ? readUrl(args.url, 'feed.lookup.url')
        : readUrl(readPinnedFeedUrl(inv.source), 'DataSource.metadata.feedUrl')
    const limit = clampLimit(args.limit)
    const since = readSinceMs(args.since)

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.1',
        'user-agent': 'tangle-agent-integrations-rss/1.0',
      },
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    })

    if (!res.ok) {
      throw new Error(`rss fetch ${res.status} ${res.statusText} for ${url.toString()}`)
    }

    const body = await readBoundedText(res, MAX_BODY_BYTES)
    const parsed = parseFeed(body, url.toString())
    const filtered = filterAndLimit(parsed.entries, since, limit)

    const data: FeedReadResult = {
      feedTitle: parsed.feedTitle,
      feedUrl: url.toString(),
      feedUpdated: parsed.feedUpdated,
      entries: filtered,
      format: parsed.format,
    }

    return {
      data,
      etag: res.headers.get('etag') ?? res.headers.get('last-modified') ?? undefined,
      fetchedAt: Date.now(),
    }
  },

  async test(source: ResolvedDataSource) {
    const raw = source.metadata?.feedUrl
    if (typeof raw !== 'string' || raw.length === 0) {
      // No pinned URL — adapter is still healthy by construction; `feed.lookup`
      // works without one. The UI should surface "configure a feed URL" hint.
      return { ok: true }
    }
    let url: URL
    try {
      url = new URL(raw)
    } catch {
      return { ok: false, reason: `feedUrl is not a valid absolute URL: ${raw}` }
    }
    if (!ALLOWED_SCHEMES.has(url.protocol)) {
      return { ok: false, reason: `feedUrl scheme not allowed: ${url.protocol}` }
    }
    try {
      const res = await fetch(url.toString(), {
        method: 'HEAD',
        headers: { 'user-agent': 'tangle-agent-integrations-rss/1.0' },
        signal: AbortSignal.timeout(8_000),
      })
      // Some publishers return 405 for HEAD on feed endpoints — that's
      // still a sign of life. Anything in the 5xx range is a real failure.
      if (res.status >= 500) return { ok: false, reason: `feedUrl returned ${res.status}` }
      return { ok: true }
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) }
    }
  },
}

// ---------- argument readers ----------

function readPinnedFeedUrl(source: ResolvedDataSource): unknown {
  return source.metadata?.feedUrl
}

function readUrl(value: unknown, label: string): URL {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} is required`)
  }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${label} is not a valid absolute URL: ${value}`)
  }
  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    throw new Error(`${label} scheme not allowed: ${parsed.protocol} (only http: and https: are accepted)`)
  }
  return parsed
}

function clampLimit(value: unknown): number {
  if (value === undefined || value === null) return DEFAULT_LIMIT
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error('rss.limit must be a positive finite number')
  }
  return Math.min(Math.floor(value), MAX_LIMIT)
}

function readSinceMs(value: unknown): number | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') {
    throw new Error('rss.since must be an ISO-8601 string')
  }
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) {
    throw new Error(`rss.since is not a valid date: ${value}`)
  }
  return ms
}

async function readBoundedText(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) return await res.text()
  const decoder = new TextDecoder('utf-8', { fatal: false })
  let out = ''
  let total = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    if (!value) continue
    total += value.byteLength
    if (total > maxBytes) {
      try { await reader.cancel() } catch { /* ignore cancel race */ }
      throw new Error(`rss feed body exceeded ${maxBytes} bytes`)
    }
    out += decoder.decode(value, { stream: true })
  }
  out += decoder.decode()
  return out
}

function filterAndLimit(entries: FeedEntry[], sinceMs: number | null, limit: number): FeedEntry[] {
  let filtered = entries
  if (sinceMs !== null) {
    filtered = entries.filter((entry) => {
      const ts = entry.published ?? entry.updated
      if (!ts) return true // keep undated entries; callers can decide
      const ms = Date.parse(ts)
      if (!Number.isFinite(ms)) return true
      return ms >= sinceMs
    })
  }
  return filtered.slice(0, limit)
}

// ---------- feed parser ----------
//
// The parser walks tagged XML once. It is NOT a general XML parser — it
// recognizes a small fixed set of element names, ignores everything else,
// and refuses to attempt format detection on the basis of the prolog
// (publishers routinely omit it or pin the wrong charset). The dispatch is
// keyed off the first occurrence of `<rss` / `<feed`.

interface ParsedFeed {
  feedTitle: string | null
  feedUpdated: string | null
  entries: FeedEntry[]
  format: 'rss' | 'atom' | 'unknown'
}

export function parseFeed(body: string, feedUrl: string): ParsedFeed {
  // Strip the BOM and any leading whitespace so the format probe is robust.
  const text = body.replace(/^﻿/, '').trimStart()
  // Order matters: an Atom feed inside an RSS aggregator wrapper is so rare
  // we ignore it. Pick by which root element appears first.
  const rssIdx = text.search(/<rss\b/i)
  const atomIdx = text.search(/<feed\b/i)
  if (rssIdx === -1 && atomIdx === -1) {
    return { feedTitle: null, feedUpdated: null, entries: [], format: 'unknown' }
  }
  if (atomIdx !== -1 && (rssIdx === -1 || atomIdx < rssIdx)) {
    return parseAtom(text, feedUrl)
  }
  return parseRss(text)
}

function parseRss(text: string): ParsedFeed {
  const channelOuter = extractFirstElement(text, 'channel')
  if (!channelOuter) {
    return { feedTitle: null, feedUpdated: null, entries: [], format: 'rss' }
  }
  // Pull channel-level title from the channel block *outside* of any <item>,
  // otherwise the first <item><title> would shadow it.
  const channelInner = stripAllElements(channelOuter, 'item')
  const feedTitle = decodeXml(firstTagText(channelInner, 'title'))

  const items = collectElements(channelOuter, 'item')
  const entries: FeedEntry[] = items.map((item) => {
    const guid = firstTagText(item, 'guid')
    const link = firstTagText(item, 'link')
    const title = firstTagText(item, 'title')
    const description = firstTagText(item, 'description')
    const contentEncoded = firstTagText(item, 'content:encoded')
    const pubDate = firstTagText(item, 'pubDate')
    const author = firstTagText(item, 'author') ?? firstTagText(item, 'dc:creator')
    const categories = collectElements(item, 'category').map((cat) => decodeXml(stripTags(cat)) ?? '').filter(Boolean)
    const id = decodeXml(guid) ?? decodeXml(link) ?? hash(item)
    return {
      id,
      title: decodeXml(title),
      link: decodeXml(link),
      summary: decodeXml(description),
      content: decodeXml(contentEncoded),
      published: normalizeDate(decodeXml(pubDate)),
      updated: null,
      author: decodeXml(author),
      categories,
    }
  })

  return { feedTitle, feedUpdated: null, entries, format: 'rss' }
}

function parseAtom(text: string, feedUrl: string): ParsedFeed {
  const feedOuter = extractFirstElement(text, 'feed') ?? text
  const feedInner = stripAllElements(feedOuter, 'entry')
  const feedTitle = decodeXml(firstTagText(feedInner, 'title'))
  const feedUpdated = normalizeDate(decodeXml(firstTagText(feedInner, 'updated')))

  const items = collectElements(feedOuter, 'entry')
  const entries: FeedEntry[] = items.map((item) => {
    const id = decodeXml(firstTagText(item, 'id'))
    const title = decodeXml(firstTagText(item, 'title'))
    const summary = decodeXml(firstTagText(item, 'summary'))
    const contentNode = firstTagText(item, 'content')
    const published = normalizeDate(decodeXml(firstTagText(item, 'published')))
    const updated = normalizeDate(decodeXml(firstTagText(item, 'updated')))
    const author =
      decodeXml(firstTagText(extractFirstElement(item, 'author') ?? '', 'name')) ??
      decodeXml(firstTagText(item, 'author'))
    const link = pickAtomLink(item)
    const categories = collectAtomCategories(item)
    return {
      id: id ?? link ?? hash(item),
      title,
      link,
      summary,
      content: decodeXml(contentNode),
      published,
      updated,
      author,
      categories,
    }
  })

  return { feedTitle, feedUpdated, entries, format: 'atom' }
}

// ---------- tiny XML helpers ----------

/** Find the first `<tag ...>...</tag>` block and return its outer text.
 *  Handles attributes and self-closing tags; returns null if not found. */
function extractFirstElement(text: string, tag: string): string | null {
  const escaped = escapeRegex(tag)
  const openRe = new RegExp(`<${escaped}\\b([^>]*)>`, 'i')
  const m = openRe.exec(text)
  if (!m) return null
  const openEnd = m.index + m[0].length
  // Self-closing variant.
  if (m[0].endsWith('/>')) return m[0]
  const closeRe = new RegExp(`</${escaped}\\s*>`, 'gi')
  closeRe.lastIndex = openEnd
  const close = closeRe.exec(text)
  if (!close) return text.slice(m.index)
  return text.slice(m.index, close.index + close[0].length)
}

/** Collect every `<tag>...</tag>` block in `text` as outer text. */
function collectElements(text: string, tag: string): string[] {
  const escaped = escapeRegex(tag)
  const out: string[] = []
  // Walk linearly; for each opening tag find its matching close. We don't
  // recurse — RSS items and Atom entries are not nested inside each other.
  const openRe = new RegExp(`<${escaped}\\b([^>]*)>`, 'gi')
  let m: RegExpExecArray | null
  while ((m = openRe.exec(text)) !== null) {
    const start = m.index
    if (m[0].endsWith('/>')) {
      out.push(m[0])
      continue
    }
    const after = m.index + m[0].length
    const closeRe = new RegExp(`</${escaped}\\s*>`, 'gi')
    closeRe.lastIndex = after
    const close = closeRe.exec(text)
    if (!close) break
    out.push(text.slice(start, close.index + close[0].length))
    openRe.lastIndex = close.index + close[0].length
  }
  return out
}

/** Remove every `<tag>...</tag>` block. Used to keep channel-level fields
 *  from being shadowed by item-level fields. */
function stripAllElements(text: string, tag: string): string {
  const escaped = escapeRegex(tag)
  // Greedy-but-non-overlapping: replace until none remain.
  let out = text
  const re = new RegExp(`<${escaped}\\b[^>]*>[\\s\\S]*?<\/${escaped}\\s*>`, 'gi')
  out = out.replace(re, '')
  const selfRe = new RegExp(`<${escaped}\\b[^>]*/>`, 'gi')
  out = out.replace(selfRe, '')
  return out
}

/** Inner text of the first `<tag>...</tag>` (returns null if missing). */
function firstTagText(text: string, tag: string): string | null {
  const escaped = escapeRegex(tag)
  const re = new RegExp(`<${escaped}\\b([^>]*)>([\\s\\S]*?)<\/${escaped}\\s*>`, 'i')
  const m = re.exec(text)
  if (m) return unwrapCdata(m[2])
  // Atom links are usually self-closing — `<link href="..." />` — fall back
  // to attribute extraction.
  const selfRe = new RegExp(`<${escaped}\\b([^>]*)/>`, 'i')
  const sm = selfRe.exec(text)
  if (sm) return null
  return null
}

function pickAtomLink(entryOuter: string): string | null {
  // Prefer `rel="alternate"` self-closing or block links; fall back to the
  // first link tag of any kind.
  const linkRe = /<link\b([^>]*)\/?>(?:([\s\S]*?)<\/link\s*>)?/gi
  let bestHref: string | null = null
  let fallback: string | null = null
  let m: RegExpExecArray | null
  while ((m = linkRe.exec(entryOuter)) !== null) {
    const attrs = m[1] ?? ''
    const href = readAttr(attrs, 'href')
    if (!href) continue
    const rel = readAttr(attrs, 'rel')
    if (!fallback) fallback = href
    if (!rel || rel === 'alternate') {
      bestHref = href
      break
    }
  }
  return bestHref ?? fallback
}

function collectAtomCategories(entryOuter: string): string[] {
  const out: string[] = []
  const re = /<category\b([^>]*)(?:\/>|>([\s\S]*?)<\/category\s*>)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(entryOuter)) !== null) {
    const term = readAttr(m[1] ?? '', 'term')
    if (term) out.push(decodeXml(term) ?? '')
    else if (m[2]) {
      const inner = decodeXml(stripTags(m[2]))
      if (inner) out.push(inner)
    }
  }
  return out.filter(Boolean)
}

function readAttr(attrs: string, name: string): string | null {
  const re = new RegExp(`\\b${escapeRegex(name)}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i')
  const m = re.exec(attrs)
  if (!m) return null
  return m[2] ?? m[3] ?? null
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, '')
}

function unwrapCdata(value: string): string {
  const cdata = /<!\[CDATA\[([\s\S]*?)\]\]>/g
  let out = ''
  let lastIdx = 0
  let m: RegExpExecArray | null
  while ((m = cdata.exec(value)) !== null) {
    out += value.slice(lastIdx, m.index)
    out += m[1]
    lastIdx = m.index + m[0].length
  }
  out += value.slice(lastIdx)
  return out
}

function decodeXml(value: string | null): string | null {
  if (value === null) return null
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  return trimmed
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => {
      const code = Number(d)
      return Number.isFinite(code) ? String.fromCodePoint(code) : _
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => {
      const code = parseInt(h, 16)
      return Number.isFinite(code) ? String.fromCodePoint(code) : _
    })
    .replace(/&amp;/g, '&')
}

function normalizeDate(value: string | null): string | null {
  if (!value) return null
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) return null
  return new Date(ms).toISOString()
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function hash(value: string): string {
  // Non-crypto FNV-1a 32-bit: stable per-entry id when neither GUID nor
  // link is available. Hex-formatted to keep it printable in the agent's
  // tool output.
  let h = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i)
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  return `rss-${h.toString(16).padStart(8, '0')}`
}
