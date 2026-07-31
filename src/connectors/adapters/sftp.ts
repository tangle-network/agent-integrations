import { lookup } from 'node:dns/promises'
import { timingSafeEqual } from 'node:crypto'
import { posix } from 'node:path'
import ipaddr from 'ipaddr.js'
import SftpClient from 'ssh2-sftp-client'
import type { ConnectorAdapter, ResolvedDataSource } from '../types.js'
import {
  MAX_FILE_BYTES,
  encodeFile,
  isPlainRecord,
  readBase64File,
  readBoolean,
  readBoundedInteger,
  readOptionalString,
} from './file-payload.js'

interface SftpClientLike {
  connect(options: Parameters<SftpClient['connect']>[0]): Promise<unknown>
  list(path: string): Promise<Array<{
    type: 'd' | '-' | 'l'
    name: string
    size: number
    modifyTime: number
    accessTime: number
    rights: { user: string; group: string; other: string }
    owner: number
    group: number
  }>>
  stat(path: string): Promise<{
    mode: number
    uid: number
    gid: number
    size: number
    accessTime: number
    modifyTime: number
    isDirectory: boolean
    isFile: boolean
    isSymbolicLink: boolean
  }>
  exists(path: string): Promise<false | 'd' | '-' | 'l'>
  realPath(path: string): Promise<string>
  get(path: string): Promise<string | NodeJS.WritableStream | Buffer>
  put(input: Buffer, path: string): Promise<string>
  delete(path: string, noErrorOK?: boolean): Promise<string>
  mkdir(path: string, recursive?: boolean): Promise<string>
  rename(source: string, destination: string): Promise<string>
  cwd(): Promise<string>
  end(): Promise<boolean>
}

export interface SftpConnectorOptions {
  createClient?: () => SftpClientLike
  lookupHost?: (hostname: string) => Promise<string[]>
}

interface SftpCredentials {
  host: string
  port: number
  username: string
  password?: string
  privateKey?: string
  passphrase?: string
  hostFingerprint: Buffer
  rootPath: string
}

const MAX_LIST_ENTRIES = 1_000
const MAX_PATH_LENGTH = 1_024

export function createSftpConnector(options: SftpConnectorOptions = {}): ConnectorAdapter {
  const createClient = options.createClient ?? (() => new SftpClient())
  const lookupHost = options.lookupHost ?? resolvePublicAddresses

  return {
    manifest: {
      kind: 'sftp',
      displayName: 'SFTP',
      description: 'List, inspect, download, upload, move, and delete files over host-key-verified SFTP.',
      auth: {
        kind: 'api-key',
        hint: 'JSON with host, username, SHA-256 hostFingerprint, and password or privateKey; optional port, passphrase, and rootPath.',
      },
      defaultConsistencyModel: 'advisory',
      category: 'storage',
      rateLimit: { requests: 120, windowMs: 60_000, scope: 'data-source' },
      capabilities: [
        {
          name: 'sftp.list',
          class: 'read',
          description: 'List a directory within the connection root.',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', default: '/' },
              limit: { type: 'integer', minimum: 1, maximum: MAX_LIST_ENTRIES, default: MAX_LIST_ENTRIES },
            },
            additionalProperties: false,
          },
        },
        {
          name: 'sftp.stat',
          class: 'read',
          description: 'Read file or directory metadata within the connection root.',
          parameters: pathSchema(),
        },
        {
          name: 'sftp.download',
          class: 'read',
          description: `Download a file no larger than ${MAX_FILE_BYTES} bytes as base64.`,
          parameters: pathSchema(),
        },
        {
          name: 'sftp.upload',
          class: 'mutation',
          description: `Upload a base64 file no larger than ${MAX_FILE_BYTES} bytes within the connection root.`,
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', minLength: 1 },
              fileBase64: { type: 'string' },
              overwrite: { type: 'boolean', default: false },
            },
            required: ['path', 'fileBase64'],
            additionalProperties: false,
          },
          cas: 'none',
          externalEffect: true,
        },
        {
          name: 'sftp.mkdir',
          class: 'mutation',
          description: 'Create a directory within the connection root.',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', minLength: 1 },
              recursive: { type: 'boolean', default: true },
            },
            required: ['path'],
            additionalProperties: false,
          },
          cas: 'none',
          externalEffect: true,
        },
        {
          name: 'sftp.rename',
          class: 'mutation',
          description: 'Move or rename a file without overwriting the destination.',
          parameters: {
            type: 'object',
            properties: {
              sourcePath: { type: 'string', minLength: 1 },
              destinationPath: { type: 'string', minLength: 1 },
            },
            required: ['sourcePath', 'destinationPath'],
            additionalProperties: false,
          },
          cas: 'none',
          externalEffect: true,
        },
        {
          name: 'sftp.delete',
          class: 'mutation',
          description: 'Delete a file within the connection root. Repeated deletion is safe.',
          parameters: pathSchema(),
          cas: 'none',
          externalEffect: true,
        },
      ],
    },

    async executeRead({ source, capabilityName, args }) {
      const credentials = readCredentials(source)
      if (capabilityName === 'sftp.list') {
        const path = resolveRemotePath(credentials.rootPath, args.path ?? '/')
        const limit = readBoundedInteger(args.limit, MAX_LIST_ENTRIES, 1, MAX_LIST_ENTRIES, 'limit')
        return withSftp(credentials, createClient, lookupHost, async (client) => {
          const safePath = await canonicalizeExistingPath(client, credentials.rootPath, path)
          const allEntries = await client.list(safePath)
          const entries = allEntries.slice(0, limit)
          return { data: { path: safePath, entries, truncated: allEntries.length > limit }, fetchedAt: Date.now() }
        })
      }
      if (capabilityName === 'sftp.stat') {
        const path = resolveRemotePath(credentials.rootPath, args.path)
        return withSftp(credentials, createClient, lookupHost, async (client) => {
          const safePath = await canonicalizeExistingPath(client, credentials.rootPath, path)
          return { data: { path: safePath, stat: await client.stat(safePath) }, fetchedAt: Date.now() }
        })
      }
      if (capabilityName === 'sftp.download') {
        const path = resolveRemotePath(credentials.rootPath, args.path)
        return withSftp(credentials, createClient, lookupHost, async (client) => {
          const safePath = await canonicalizeExistingPath(client, credentials.rootPath, path)
          const stat = await client.stat(safePath)
          if (!stat.isFile) throw new Error('sftp.download path is not a file')
          if (stat.size > MAX_FILE_BYTES) throw new Error(`sftp.download file exceeds the ${MAX_FILE_BYTES}-byte limit`)
          const file = await client.get(safePath)
          if (!Buffer.isBuffer(file)) throw new Error('SFTP client returned a non-buffer download')
          return { data: { path: safePath, ...encodeFile(file), modifyTime: stat.modifyTime }, fetchedAt: Date.now() }
        })
      }
      throw new Error(`Unknown SFTP read capability: ${capabilityName}`)
    },

    async executeMutation({ source, capabilityName, args }) {
      const credentials = readCredentials(source)
      const prepared = prepareMutation(capabilityName, args, credentials.rootPath)
      return withSftp(credentials, createClient, lookupHost, async (client) => {
        let data: Record<string, unknown>
        if (prepared.kind === 'upload') {
          const path = await canonicalizeDestinationPath(client, credentials.rootPath, prepared.path)
          if (!prepared.overwrite && await client.exists(path)) throw new Error('sftp.upload destination already exists')
          await client.put(prepared.file, path)
          data = { path, byteLength: prepared.file.byteLength }
        } else if (prepared.kind === 'mkdir') {
          const path = await canonicalizeDestinationPath(client, credentials.rootPath, prepared.path)
          await client.mkdir(path, prepared.recursive)
          data = { path }
        } else if (prepared.kind === 'rename') {
          const sourcePath = await canonicalizeExistingPath(client, credentials.rootPath, prepared.sourcePath)
          const destinationPath = await canonicalizeDestinationPath(client, credentials.rootPath, prepared.destinationPath)
          if (await client.exists(destinationPath)) throw new Error('sftp.rename destination already exists')
          await client.rename(sourcePath, destinationPath)
          data = { sourcePath, destinationPath }
        } else {
          const path = await canonicalizeDestinationPath(client, credentials.rootPath, prepared.path)
          await client.delete(path, true)
          data = { path }
        }
        return {
          status: 'committed',
          data,
          committedAt: Date.now(),
          idempotentReplay: false,
        }
      })
    },

    async test(source) {
      try {
        const credentials = readCredentials(source)
        await withSftp(credentials, createClient, lookupHost, (client) => client.cwd())
        return { ok: true }
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : 'SFTP connection test failed' }
      }
    },
  }
}

type PreparedMutation =
  | { kind: 'upload'; path: string; file: Buffer; overwrite: boolean }
  | { kind: 'mkdir'; path: string; recursive: boolean }
  | { kind: 'rename'; sourcePath: string; destinationPath: string }
  | { kind: 'delete'; path: string }

function prepareMutation(
  capabilityName: string,
  args: Record<string, unknown>,
  rootPath: string,
): PreparedMutation {
  if (capabilityName === 'sftp.upload') {
    return {
      kind: 'upload',
      path: mutablePath(rootPath, args.path),
      file: readBase64File(args.fileBase64),
      overwrite: readBoolean(args.overwrite, false, 'overwrite'),
    }
  }
  if (capabilityName === 'sftp.mkdir') {
    return {
      kind: 'mkdir',
      path: mutablePath(rootPath, args.path),
      recursive: readBoolean(args.recursive, true, 'recursive'),
    }
  }
  if (capabilityName === 'sftp.rename') {
    return {
      kind: 'rename',
      sourcePath: mutablePath(rootPath, args.sourcePath),
      destinationPath: mutablePath(rootPath, args.destinationPath),
    }
  }
  if (capabilityName === 'sftp.delete') {
    return { kind: 'delete', path: mutablePath(rootPath, args.path) }
  }
  throw new Error(`Unknown SFTP mutation capability: ${capabilityName}`)
}

export const sftpConnector = createSftpConnector()

function pathSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: { path: { type: 'string', minLength: 1 } },
    required: ['path'],
    additionalProperties: false,
  }
}

async function withSftp<T>(
  credentials: SftpCredentials,
  createClient: () => SftpClientLike,
  lookupHost: (hostname: string) => Promise<string[]>,
  run: (client: SftpClientLike) => Promise<T>,
): Promise<T> {
  const addresses = await lookupHost(credentials.host)
  if (addresses.length === 0) throw new Error('SFTP host did not resolve')
  const client = createClient()
  try {
    await client.connect({
      host: addresses[0],
      port: credentials.port,
      username: credentials.username,
      password: credentials.password,
      privateKey: credentials.privateKey,
      passphrase: credentials.passphrase,
      readyTimeout: 10_000,
      retries: 1,
      hostHash: 'sha256',
      hostVerifier: (hashedKey: string | Buffer) => fingerprintMatches(credentials.hostFingerprint, hashedKey),
    })
    return await run(client)
  } finally {
    await client.end().catch(() => false)
  }
}

function readCredentials(source: ResolvedDataSource): SftpCredentials {
  let raw: unknown
  if (source.credentials.kind === 'custom') raw = source.credentials.values
  else if (source.credentials.kind === 'api-key') {
    try {
      raw = JSON.parse(source.credentials.apiKey)
    } catch {
      throw new Error('SFTP credential must be valid JSON')
    }
  } else {
    throw new Error('SFTP requires a structured credential bundle')
  }
  if (!isPlainRecord(raw)) throw new Error('SFTP credential must be a JSON object')
  const host = requiredCredentialString(raw.host, 'host')
  validateHostname(host)
  const username = requiredCredentialString(raw.username, 'username')
  const password = readOptionalString(raw.password, 'password')
  const privateKey = readOptionalString(raw.privateKey, 'privateKey')
  if (!password && !privateKey) throw new Error('SFTP credential requires password or privateKey')
  const rootPath = normalizeRootPath(readOptionalString(raw.rootPath, 'rootPath') ?? '/')
  return {
    host,
    port: readBoundedInteger(raw.port, 22, 1, 65_535, 'port'),
    username,
    password,
    privateKey,
    passphrase: readOptionalString(raw.passphrase, 'passphrase'),
    hostFingerprint: parseFingerprint(requiredCredentialString(raw.hostFingerprint, 'hostFingerprint')),
    rootPath,
  }
}

function requiredCredentialString(value: unknown, label: string): string {
  const parsed = readOptionalString(value, label)
  if (!parsed) throw new Error(`SFTP credential ${label} is required`)
  return parsed
}

function validateHostname(host: string): void {
  if (
    host.length > 253 ||
    host.includes('://') ||
    /[\s/@]/.test(host) ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local')
  ) {
    throw new Error('SFTP host must be a public hostname or IP address without a scheme')
  }
}

async function resolvePublicAddresses(host: string): Promise<string[]> {
  const addresses = ipaddr.isValid(host)
    ? [host]
    : (await lookup(host, { all: true, verbatim: true })).map((entry) => entry.address)
  if (addresses.length === 0 || addresses.some((address) => !isPublicAddress(address))) {
    throw new Error('SFTP host is not a public network target')
  }
  return addresses
}

function isPublicAddress(value: string): boolean {
  if (!ipaddr.isValid(value)) return false
  let address = ipaddr.parse(value)
  if (address.kind() === 'ipv6' && (address as ipaddr.IPv6).isIPv4MappedAddress()) {
    address = (address as ipaddr.IPv6).toIPv4Address()
  }
  return address.range() === 'unicast'
}

function parseFingerprint(value: string): Buffer {
  if (/^[a-fA-F0-9]{64}$/.test(value)) return Buffer.from(value, 'hex')
  const match = /^SHA256:([A-Za-z0-9+/]{43}=?)$/.exec(value)
  if (!match) throw new Error('hostFingerprint must be 64 hex characters or an SHA256: base64 fingerprint')
  const parsed = Buffer.from(match[1], 'base64')
  if (parsed.byteLength !== 32) throw new Error('hostFingerprint must contain a 32-byte SHA-256 digest')
  return parsed
}

function fingerprintMatches(expected: Buffer, actual: string | Buffer): boolean {
  const parsed = Buffer.isBuffer(actual)
    ? actual
    : /^[a-fA-F0-9]{64}$/.test(actual)
      ? Buffer.from(actual, 'hex')
      : Buffer.from(actual.replace(/^SHA256:/, ''), 'base64')
  return parsed.byteLength === expected.byteLength && timingSafeEqual(parsed, expected)
}

function normalizeRootPath(value: string): string {
  if (!value.startsWith('/') || value.includes('\0') || value.length > MAX_PATH_LENGTH) {
    throw new Error('rootPath must be an absolute SFTP path')
  }
  return posix.normalize(value)
}

function resolveRemotePath(rootPath: string, value: unknown): string {
  const requested = readOptionalString(value, 'path')
  if (!requested || requested.includes('\0') || requested.length > MAX_PATH_LENGTH) {
    throw new Error('path must be a non-empty SFTP path')
  }
  const resolved = posix.resolve(rootPath, requested.replace(/^\/+/, ''))
  if (rootPath !== '/' && resolved !== rootPath && !resolved.startsWith(`${rootPath}/`)) {
    throw new Error('path escapes the configured SFTP root')
  }
  return resolved
}

function mutablePath(rootPath: string, value: unknown): string {
  const path = resolveRemotePath(rootPath, value)
  if (path === rootPath) throw new Error('mutation path cannot target the configured SFTP root')
  return path
}

async function canonicalizeExistingPath(
  client: SftpClientLike,
  configuredRoot: string,
  path: string,
): Promise<string> {
  const root = posix.normalize(await client.realPath(configuredRoot))
  const target = posix.normalize(await client.realPath(path))
  assertWithinCanonicalRoot(root, target)
  return target
}

async function canonicalizeDestinationPath(
  client: SftpClientLike,
  configuredRoot: string,
  path: string,
): Promise<string> {
  const root = posix.normalize(await client.realPath(configuredRoot))
  if (await client.exists(path)) {
    const existing = posix.normalize(await client.realPath(path))
    assertWithinCanonicalRoot(root, existing)
    return existing
  }
  let ancestor = posix.dirname(path)
  const missingSegments = [posix.basename(path)]
  while (!await client.exists(ancestor)) {
    if (ancestor === configuredRoot || ancestor === '/') break
    missingSegments.unshift(posix.basename(ancestor))
    ancestor = posix.dirname(ancestor)
  }
  const canonicalAncestor = posix.normalize(await client.realPath(ancestor))
  assertWithinCanonicalRoot(root, canonicalAncestor)
  const destination = posix.join(canonicalAncestor, ...missingSegments)
  assertWithinCanonicalRoot(root, destination)
  return destination
}

function assertWithinCanonicalRoot(root: string, target: string): void {
  if (root !== '/' && target !== root && !target.startsWith(`${root}/`)) {
    throw new Error('SFTP path resolves outside the configured root')
  }
}
