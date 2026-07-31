import SftpClient from 'ssh2-sftp-client'
import { describe, expect, it } from 'vitest'
import {
  createSftpConnector,
  csvFilesConnector,
  excelFilesConnector,
  parquetFilesConnector,
  sftpConnector,
} from '../src/connectors/adapters/index.js'
import { validateConnectorManifest, type ConnectorCredentials, type ResolvedDataSource } from '../src/connectors/types.js'
import { getIntegrationSpec } from '../src/specs/index.js'

describe('universal file and SFTP connectors', () => {
  it.each([
    csvFilesConnector,
    excelFilesConnector,
    parquetFilesConnector,
    sftpConnector,
  ])('$manifest.kind passes the shared manifest validator and exposes only confirmed writes', (connector) => {
    expect(validateConnectorManifest(connector.manifest)).toEqual({ ok: true, issues: [] })
    const mutations = connector.manifest.capabilities.filter((capability) => capability.class === 'mutation')
    expect(mutations.length).toBeGreaterThan(0)
    expect(mutations.every((mutation) => mutation.externalEffect)).toBe(true)
  })

  it.each(['csv-files', 'excel-files', 'parquet-files', 'sftp'])('%s becomes executable in the product spec', (kind) => {
    const spec = getIntegrationSpec(kind)
    expect(spec?.status).toBe('executable')
    expect(spec?.actions.length).toBeGreaterThan(0)
  })

  it('describes SFTP as an encrypted connection bundle instead of a bearer token', () => {
    const spec = getIntegrationSpec('sftp')
    expect(spec?.auth).toMatchObject({ mode: 'api_key', placement: undefined })
    expect(spec?.setup.credentialFields).toMatchObject([
      { label: 'SFTP connection JSON', secret: true },
    ])
    expect(spec?.setup.knownQuirks?.map((quirk) => quirk.id)).toEqual([
      'public-endpoint',
      'host-key',
      'root-scope',
    ])
  })

  it('round-trips quoted CSV records through the real parser and writer', async () => {
    const created = await csvFilesConnector.executeMutation!({
      source: source('csv-files', { kind: 'none' }),
      capabilityName: 'csv.create',
      args: { records: [{ name: 'Ada, Inc.', active: true }, { name: 'Linus', active: false }] },
      idempotencyKey: 'csv-create-1',
    })
    expect(created.status).toBe('committed')
    if (created.status !== 'committed') throw new Error('CSV creation was not committed')
    const parsed = await csvFilesConnector.executeRead!({
      source: source('csv-files', { kind: 'none' }),
      capabilityName: 'csv.parse',
      args: { fileBase64: (created.data as { fileBase64: string }).fileBase64 },
      idempotencyKey: 'csv-read-1',
    })
    expect(parsed.data).toMatchObject({
      recordCount: 2,
      records: [{ name: 'Ada, Inc.', active: 'true' }, { name: 'Linus', active: 'false' }],
    })
  })

  it('round-trips XLSX rows through the real workbook parser and writer', async () => {
    const created = await excelFilesConnector.executeMutation!({
      source: source('excel-files', { kind: 'none' }),
      capabilityName: 'excel.create',
      args: { sheetName: 'Pipeline', rows: [['Company', 'Amount'], ['Tangle', 42]] },
      idempotencyKey: 'excel-create-1',
    })
    expect(created.status).toBe('committed')
    if (created.status !== 'committed') throw new Error('Excel creation was not committed')
    const parsed = await excelFilesConnector.executeRead!({
      source: source('excel-files', { kind: 'none' }),
      capabilityName: 'excel.read',
      args: { fileBase64: (created.data as { fileBase64: string }).fileBase64, sheet: 'Pipeline' },
      idempotencyKey: 'excel-read-1',
    })
    expect(parsed.data).toEqual({
      sheets: [{ name: 'Pipeline', rows: [['Company', 'Amount'], ['Tangle', 42]] }],
      sheetCount: 1,
      rowCount: 2,
    })
  })

  it('round-trips Parquet rows through the real column encoder and decoder', async () => {
    const created = await parquetFilesConnector.executeMutation!({
      source: source('parquet-files', { kind: 'none' }),
      capabilityName: 'parquet.create',
      args: { records: [{ company: 'Tangle', amount: 42, active: true }, { company: 'Webb', amount: 7, active: false }] },
      idempotencyKey: 'parquet-create-1',
    })
    expect(created.status).toBe('committed')
    if (created.status !== 'committed') throw new Error('Parquet creation was not committed')
    const parsed = await parquetFilesConnector.executeRead!({
      source: source('parquet-files', { kind: 'none' }),
      capabilityName: 'parquet.read',
      args: { fileBase64: (created.data as { fileBase64: string }).fileBase64 },
      idempotencyKey: 'parquet-read-1',
    })
    expect(parsed.data).toEqual({
      records: [{ company: 'Tangle', amount: 42, active: true }, { company: 'Webb', amount: 7, active: false }],
      recordCount: 2,
      rowStart: 0,
    })
  })

  it('pins the SFTP host key and confines file writes to the configured root', async () => {
    let connectedHost: string | undefined
    let uploadedPath: string | undefined
    const fakeClient = {
      async connect(options: Parameters<SftpClient['connect']>[0]) {
        connectedHost = options.host
        const verify = options.hostVerifier as unknown as (key: string) => boolean
        expect(verify('11'.repeat(32))).toBe(true)
        return {} as never
      },
      async list() { return [] as never[] },
      async stat() { return {} as never },
      async exists() { return false as const },
      async realPath(path: string) { return path },
      async get() { return Buffer.from('download') },
      async put(_file: Buffer, path: string) { uploadedPath = path; return path },
      async delete(path: string) { return path },
      async mkdir(path: string) { return path },
      async rename(_source: string, destination: string) { return destination },
      async cwd() { return '/tenant' },
      async end() { return true },
    }
    const connector = createSftpConnector({
      createClient: () => fakeClient,
      lookupHost: async () => ['203.0.113.10'],
    })
    const result = await connector.executeMutation!({
      source: source('sftp', sftpCredentials({ rootPath: '/tenant' })),
      capabilityName: 'sftp.upload',
      args: { path: '/incoming/deals.csv', fileBase64: Buffer.from('a,b\n1,2\n').toString('base64') },
      idempotencyKey: 'sftp-upload-1',
    })
    expect(result.status).toBe('committed')
    expect(connectedHost).toBe('203.0.113.10')
    expect(uploadedPath).toBe('/tenant/incoming/deals.csv')
  })

  it('rejects private SFTP targets and root escapes before creating a client', async () => {
    let clientsCreated = 0
    const privateConnector = createSftpConnector({ createClient: () => { clientsCreated += 1; return {} as never } })
    await expect(privateConnector.executeRead!({
      source: source('sftp', sftpCredentials({ host: '127.0.0.1' })),
      capabilityName: 'sftp.list',
      args: { path: '/' },
      idempotencyKey: 'sftp-private-1',
    })).rejects.toThrow(/not a public network target/)
    expect(clientsCreated).toBe(0)

    const rootedConnector = createSftpConnector({
      createClient: () => { clientsCreated += 1; return {} as never },
      lookupHost: async () => ['198.51.100.10'],
    })
    await expect(rootedConnector.executeMutation!({
      source: source('sftp', sftpCredentials({ rootPath: '/tenant' })),
      capabilityName: 'sftp.delete',
      args: { path: '../../etc/passwd' },
      idempotencyKey: 'sftp-escape-1',
    })).rejects.toThrow(/escapes the configured SFTP root/)
    expect(clientsCreated).toBe(0)

    const symlinkClient = {
      async connect() { return {} as never },
      async list() { return [] as never[] },
      async stat() { return {} as never },
      async exists() { return '-' as const },
      async realPath(path: string) { return path === '/tenant' ? path : '/etc/secret' },
      async get() { return Buffer.alloc(0) },
      async put(_file: Buffer, path: string) { return path },
      async delete(path: string) { return path },
      async mkdir(path: string) { return path },
      async rename(_source: string, destination: string) { return destination },
      async cwd() { return '/tenant' },
      async end() { return true },
    }
    const symlinkConnector = createSftpConnector({
      createClient: () => { clientsCreated += 1; return symlinkClient },
      lookupHost: async () => ['198.51.100.10'],
    })
    await expect(symlinkConnector.executeRead!({
      source: source('sftp', sftpCredentials({ rootPath: '/tenant' })),
      capabilityName: 'sftp.stat',
      args: { path: '/link/secret' },
      idempotencyKey: 'sftp-symlink-1',
    })).rejects.toThrow(/resolves outside the configured root/)
    expect(clientsCreated).toBe(1)
  })
})

function source(kind: string, credentials: ConnectorCredentials): ResolvedDataSource {
  return {
    id: `${kind}-source`,
    projectId: 'project-1',
    publishedAgentId: null,
    kind,
    label: kind,
    consistencyModel: 'advisory',
    scopes: [],
    metadata: {},
    credentials,
    status: 'active',
  }
}

function sftpCredentials(overrides: Record<string, unknown> = {}): ConnectorCredentials {
  return {
    kind: 'custom',
    values: {
      host: 'sftp.example.com',
      username: 'tangle',
      password: 'encrypted-at-rest',
      hostFingerprint: '11'.repeat(32),
      ...overrides,
    },
  }
}
