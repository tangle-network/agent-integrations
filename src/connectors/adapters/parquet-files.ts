import { parquetReadObjects, type AsyncBuffer } from 'hyparquet'
import { parquetWriteBuffer, type BasicType, type ColumnSource } from 'hyparquet-writer'
import type { ConnectorAdapter } from '../types.js'
import {
  MAX_RECORDS,
  encodeFile,
  jsonSafe,
  readBase64File,
  readBoundedInteger,
  readRecords,
} from './file-payload.js'

const MAX_COLUMNS = 256

export const parquetFilesConnector: ConnectorAdapter = {
  manifest: {
    kind: 'parquet-files',
    displayName: 'Parquet Files',
    description: 'Read bounded Apache Parquet files and create Parquet files from structured records.',
    auth: { kind: 'none' },
    defaultConsistencyModel: 'advisory',
    category: 'database',
    capabilities: [
      {
        name: 'parquet.read',
        class: 'read',
        description: 'Read selected columns and a bounded row range from a base64-encoded Parquet file.',
        parameters: {
          type: 'object',
          properties: {
            fileBase64: { type: 'string', description: 'Parquet file content encoded as canonical base64.' },
            columns: { type: 'array', maxItems: MAX_COLUMNS, items: { type: 'string', minLength: 1 } },
            rowStart: { type: 'integer', minimum: 0, default: 0 },
            rowLimit: { type: 'integer', minimum: 1, maximum: MAX_RECORDS, default: MAX_RECORDS },
          },
          required: ['fileBase64'],
          additionalProperties: false,
        },
      },
      {
        name: 'parquet.create',
        class: 'mutation',
        description: 'Create a base64-encoded Parquet file from object records with inferred column types.',
        parameters: {
          type: 'object',
          properties: {
            records: { type: 'array', minItems: 1, maxItems: MAX_RECORDS, items: { type: 'object' } },
          },
          required: ['records'],
          additionalProperties: false,
        },
        cas: 'none',
        externalEffect: true,
      },
    ],
  },

  async executeRead({ capabilityName, args }) {
    if (capabilityName !== 'parquet.read') throw new Error(`Unknown Parquet capability: ${capabilityName}`)
    const file = readBase64File(args.fileBase64)
    const columns = readColumns(args.columns)
    const rowStart = readBoundedInteger(args.rowStart, 0, 0, Number.MAX_SAFE_INTEGER, 'rowStart')
    const rowLimit = readBoundedInteger(args.rowLimit, MAX_RECORDS, 1, MAX_RECORDS, 'rowLimit')
    const records = await parquetReadObjects({
      file: asyncBuffer(file),
      columns,
      rowStart,
      rowEnd: rowStart + rowLimit,
    })
    return {
      data: { records: jsonSafe(records), recordCount: records.length, rowStart },
      fetchedAt: Date.now(),
    }
  },

  async executeMutation({ capabilityName, args }) {
    if (capabilityName !== 'parquet.create') throw new Error(`Unknown Parquet capability: ${capabilityName}`)
    const records = readRecords(args.records)
    const columnNames = [...new Set(records.flatMap((record) => Object.keys(record)))]
    if (columnNames.length === 0 || columnNames.length > MAX_COLUMNS) {
      throw new Error(`records must contain 1 through ${MAX_COLUMNS} columns`)
    }
    if (columnNames.some((name) => name.length === 0)) throw new Error('column names must not be empty')
    const columnData: ColumnSource[] = columnNames.map((name) => {
      const data = records.map((record) => parquetValue(record[name]))
      return { name, data, type: inferParquetType(data) }
    })
    const file = parquetWriteBuffer({ columnData })
    return {
      status: 'committed',
      data: { ...encodeFile(new Uint8Array(file)), columns: columnNames, recordCount: records.length },
      committedAt: Date.now(),
      idempotentReplay: false,
    }
  },

  async test() {
    return { ok: true }
  },
}

function asyncBuffer(file: Buffer): AsyncBuffer {
  return {
    byteLength: file.byteLength,
    slice(start, end) {
      const boundedEnd = end === undefined ? file.byteLength : Math.min(end, file.byteLength)
      return Uint8Array.from(file.subarray(start, boundedEnd)).buffer
    },
  }
}

function readColumns(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_COLUMNS) {
    throw new Error(`columns must contain 1 through ${MAX_COLUMNS} names`)
  }
  const columns = value.map((entry, index) => {
    if (typeof entry !== 'string' || entry.length === 0) throw new Error(`columns[${index}] must be a non-empty string`)
    return entry
  })
  if (new Set(columns).size !== columns.length) throw new Error('columns must not contain duplicates')
  return columns
}

function parquetValue(value: unknown): unknown {
  if (value === undefined) return null
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Parquet numeric values must be finite')
  return value
}

function inferParquetType(values: unknown[]): BasicType {
  const present = values.filter((value) => value !== null && value !== undefined)
  if (present.length === 0) return 'JSON'
  if (present.every((value) => typeof value === 'boolean')) return 'BOOLEAN'
  if (present.every((value) => typeof value === 'string')) return 'STRING'
  if (present.every((value) => typeof value === 'number')) return 'DOUBLE'
  if (present.every((value) => typeof value === 'bigint')) return 'INT64'
  if (present.every((value) => value instanceof Date)) return 'TIMESTAMP'
  return 'JSON'
}
