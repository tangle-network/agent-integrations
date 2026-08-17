import { parse } from 'csv-parse/sync'
import { stringify } from 'csv-stringify/sync'
import type { ConnectorAdapter } from '../types.js'
import {
  MAX_RECORDS,
  encodeFile,
  readBase64File,
  readBoolean,
  readOptionalString,
  readRecords,
} from './file-payload.js'

const MAX_COLUMNS = 256
const MAX_RECORD_SIZE = 1024 * 1024

export const csvFilesConnector: ConnectorAdapter = {
  manifest: {
    kind: 'csv-files',
    displayName: 'CSV Files',
    description: 'Parse bounded CSV files into records and create CSV files from structured records.',
    auth: { kind: 'none' },
    defaultConsistencyModel: 'advisory',
    category: 'database',
    capabilities: [
      {
        name: 'csv.parse',
        class: 'read',
        description: 'Parse a base64-encoded CSV file into object records or row arrays.',
        parameters: {
          type: 'object',
          properties: {
            fileBase64: { type: 'string', description: 'CSV file content encoded as canonical base64.' },
            delimiter: { type: 'string', minLength: 1, maxLength: 1, default: ',' },
            header: { type: 'boolean', default: true },
          },
          required: ['fileBase64'],
          additionalProperties: false,
        },
      },
      {
        name: 'csv.create',
        class: 'mutation',
        description: 'Create a base64-encoded CSV file from object records.',
        parameters: {
          type: 'object',
          properties: {
            records: { type: 'array', minItems: 1, maxItems: MAX_RECORDS, items: { type: 'object' } },
            columns: { type: 'array', maxItems: MAX_COLUMNS, items: { type: 'string', minLength: 1 } },
            delimiter: { type: 'string', minLength: 1, maxLength: 1, default: ',' },
            header: { type: 'boolean', default: true },
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
    if (capabilityName !== 'csv.parse') throw new Error(`Unknown CSV capability: ${capabilityName}`)
    const file = readBase64File(args.fileBase64)
    const delimiter = readDelimiter(args.delimiter)
    const header = readBoolean(args.header, true, 'header')
    let recordCount = 0
    const records = parse(file, {
      bom: true,
      columns: header,
      delimiter,
      max_record_size: MAX_RECORD_SIZE,
      skip_empty_lines: true,
      on_record(record) {
        recordCount += 1
        if (recordCount > MAX_RECORDS) throw new Error(`CSV exceeds the ${MAX_RECORDS}-record limit`)
        return record
      },
    }) as unknown[]
    if (records.some((record) =>
      header
        ? Object.keys(record as Record<string, unknown>).length > MAX_COLUMNS
        : Array.isArray(record) && record.length > MAX_COLUMNS,
    )) {
      throw new Error(`CSV exceeds the ${MAX_COLUMNS}-column limit`)
    }
    return {
      data: { records, recordCount: records.length, header },
      fetchedAt: Date.now(),
    }
  },

  async executeMutation({ capabilityName, args }) {
    if (capabilityName !== 'csv.create') throw new Error(`Unknown CSV capability: ${capabilityName}`)
    const records = readRecords(args.records)
    const columns = readColumns(args.columns, records)
    const delimiter = readDelimiter(args.delimiter)
    const header = readBoolean(args.header, true, 'header')
    const csv = stringify(
      records.map((record) => Object.fromEntries(columns.map((column) => [column, csvValue(record[column])]))),
      { columns, delimiter, header },
    )
    return {
      status: 'committed',
      data: { ...encodeFile(Buffer.from(csv, 'utf8')), text: csv, columns, recordCount: records.length },
      committedAt: Date.now(),
      idempotentReplay: false,
    }
  },

  async test() {
    return { ok: true }
  },
}

function readDelimiter(value: unknown): string {
  const delimiter = readOptionalString(value, 'delimiter') ?? ','
  if ([...delimiter].length !== 1 || delimiter === '\r' || delimiter === '\n' || delimiter === '"') {
    throw new Error('delimiter must be one non-newline character other than a double quote')
  }
  return delimiter
}

function readColumns(value: unknown, records: Record<string, unknown>[]): string[] {
  const columns = value === undefined
    ? [...new Set(records.flatMap((record) => Object.keys(record)))]
    : value
  if (!Array.isArray(columns) || columns.length === 0 || columns.length > MAX_COLUMNS) {
    throw new Error(`columns must contain 1 through ${MAX_COLUMNS} names`)
  }
  const parsed = columns.map((column, index) => {
    if (typeof column !== 'string' || column.length === 0) throw new Error(`columns[${index}] must be a non-empty string`)
    return column
  })
  if (new Set(parsed).size !== parsed.length) throw new Error('columns must not contain duplicates')
  return parsed
}

function csvValue(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('CSV numeric values must be finite')
    return value
  }
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date) return value.toISOString()
  return JSON.stringify(value)
}
