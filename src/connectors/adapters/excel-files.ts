import readXlsxFile from 'read-excel-file/node'
import writeXlsxFile, { type SheetData } from 'write-excel-file/node'
import type { ConnectorAdapter } from '../types.js'
import {
  MAX_RECORDS,
  encodeFile,
  jsonSafe,
  readBase64File,
  readOptionalString,
  readRows,
} from './file-payload.js'

const MAX_COLUMNS = 256
const MAX_SHEETS = 50
const MAX_UNCOMPRESSED_WORKBOOK_BYTES = 50 * 1024 * 1024
const MAX_ZIP_ENTRIES = 1_000

export const excelFilesConnector: ConnectorAdapter = {
  manifest: {
    kind: 'excel-files',
    displayName: 'Excel Files',
    description: 'Read bounded XLSX workbooks and create XLSX files from structured rows.',
    auth: { kind: 'none' },
    defaultConsistencyModel: 'advisory',
    category: 'spreadsheet',
    capabilities: [
      {
        name: 'excel.read',
        class: 'read',
        description: 'Read every sheet, or one named sheet, from a base64-encoded XLSX workbook.',
        parameters: {
          type: 'object',
          properties: {
            fileBase64: { type: 'string', description: 'XLSX workbook content encoded as canonical base64.' },
            sheet: {
              description: 'Optional sheet name or one-based sheet number.',
              oneOf: [{ type: 'string', minLength: 1 }, { type: 'integer', minimum: 1 }],
            },
          },
          required: ['fileBase64'],
          additionalProperties: false,
        },
      },
      {
        name: 'excel.create',
        class: 'mutation',
        description: 'Create a single-sheet base64-encoded XLSX workbook from row arrays.',
        parameters: {
          type: 'object',
          properties: {
            rows: {
              type: 'array',
              minItems: 1,
              maxItems: MAX_RECORDS,
              items: { type: 'array', maxItems: MAX_COLUMNS },
            },
            sheetName: { type: 'string', minLength: 1, maxLength: 31, default: 'Sheet1' },
          },
          required: ['rows'],
          additionalProperties: false,
        },
        cas: 'none',
        externalEffect: true,
      },
    ],
  },

  async executeRead({ capabilityName, args }) {
    if (capabilityName !== 'excel.read') throw new Error(`Unknown Excel capability: ${capabilityName}`)
    const file = readBase64File(args.fileBase64)
    assertBoundedXlsxArchive(file)
    const requestedSheet = readSheetSelector(args.sheet)
    const workbook = await readXlsxFile(file)
    if (workbook.length > MAX_SHEETS) throw new Error(`workbook exceeds the ${MAX_SHEETS}-sheet limit`)
    const selected = requestedSheet === undefined
      ? workbook
      : workbook.filter((sheet, index) =>
          typeof requestedSheet === 'number'
            ? index + 1 === requestedSheet
            : sheet.sheet === requestedSheet,
        )
    if (requestedSheet !== undefined && selected.length === 0) {
      throw new Error(`sheet not found: ${requestedSheet}`)
    }
    let totalRows = 0
    const sheets = selected.map((sheet) => {
      totalRows += sheet.data.length
      if (totalRows > MAX_RECORDS) throw new Error(`workbook exceeds the ${MAX_RECORDS}-row limit`)
      for (const [rowIndex, row] of sheet.data.entries()) {
        if (row.length > MAX_COLUMNS) {
          throw new Error(`sheet ${sheet.sheet} row ${rowIndex + 1} exceeds the ${MAX_COLUMNS}-column limit`)
        }
      }
      return { name: sheet.sheet, rows: jsonSafe(sheet.data) }
    })
    return {
      data: { sheets, sheetCount: sheets.length, rowCount: totalRows },
      fetchedAt: Date.now(),
    }
  },

  async executeMutation({ capabilityName, args }) {
    if (capabilityName !== 'excel.create') throw new Error(`Unknown Excel capability: ${capabilityName}`)
    const rows = readRows(args.rows)
    for (const [index, row] of rows.entries()) {
      if (row.length > MAX_COLUMNS) throw new Error(`rows[${index}] exceeds the ${MAX_COLUMNS}-column limit`)
    }
    const sheetName = readOptionalString(args.sheetName, 'sheetName') ?? 'Sheet1'
    validateSheetName(sheetName)
    const sheetData: SheetData = rows.map((row) => row.map(excelCell))
    const file = await writeXlsxFile(sheetData, { sheet: sheetName }).toBuffer()
    return {
      status: 'committed',
      data: { ...encodeFile(file), sheetName, rowCount: rows.length },
      committedAt: Date.now(),
      idempotentReplay: false,
    }
  },

  async test() {
    return { ok: true }
  },
}

function readSheetSelector(value: unknown): string | number | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string' && value.length > 0) return value
  if (Number.isInteger(value) && (value as number) >= 1) return value as number
  throw new Error('sheet must be a non-empty name or a one-based integer')
}

function validateSheetName(value: string): void {
  if (value.length > 31 || /[\\/*?:[\]]/.test(value)) {
    throw new Error('sheetName must be at most 31 characters and contain no \\ / * ? : [ ] characters')
  }
}

function excelCell(value: unknown): string | number | boolean | Date | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'boolean' || value instanceof Date) return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Excel numeric values must be finite')
    return value
  }
  if (typeof value === 'bigint') return value.toString()
  return JSON.stringify(value)
}

function assertBoundedXlsxArchive(file: Buffer): void {
  const eocdSignature = 0x06054b50
  const centralEntrySignature = 0x02014b50
  if (file.byteLength < 22) throw new Error('XLSX file is missing its ZIP directory')
  const searchStart = Math.max(0, file.byteLength - 65_557)
  let eocdOffset = -1
  for (let offset = file.byteLength - 22; offset >= searchStart; offset -= 1) {
    if (file.readUInt32LE(offset) === eocdSignature) {
      eocdOffset = offset
      break
    }
  }
  if (eocdOffset < 0) throw new Error('XLSX file is missing its ZIP directory')
  const entryCount = file.readUInt16LE(eocdOffset + 10)
  const centralSize = file.readUInt32LE(eocdOffset + 12)
  const centralOffset = file.readUInt32LE(eocdOffset + 16)
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new Error('ZIP64 XLSX workbooks are not supported')
  }
  if (entryCount === 0 || entryCount > MAX_ZIP_ENTRIES || centralOffset + centralSize > file.byteLength) {
    throw new Error('XLSX ZIP directory is invalid or too large')
  }
  let offset = centralOffset
  let totalUncompressed = 0
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > file.byteLength || file.readUInt32LE(offset) !== centralEntrySignature) {
      throw new Error('XLSX ZIP directory entry is invalid')
    }
    const compressedSize = file.readUInt32LE(offset + 20)
    const uncompressedSize = file.readUInt32LE(offset + 24)
    const fileNameLength = file.readUInt16LE(offset + 28)
    const extraLength = file.readUInt16LE(offset + 30)
    const commentLength = file.readUInt16LE(offset + 32)
    totalUncompressed += uncompressedSize
    if (
      totalUncompressed > MAX_UNCOMPRESSED_WORKBOOK_BYTES ||
      (uncompressedSize > 0 && compressedSize === 0)
    ) {
      throw new Error('XLSX workbook expands beyond the safe processing limit')
    }
    offset += 46 + fileNameLength + extraLength + commentLength
  }
  if (offset > centralOffset + centralSize) throw new Error('XLSX ZIP directory length is invalid')
}
