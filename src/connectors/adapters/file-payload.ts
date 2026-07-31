export const MAX_FILE_BYTES = 10 * 1024 * 1024
export const MAX_RECORDS = 10_000

export function readBase64File(value: unknown, label = 'fileBase64'): Buffer {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} is required`)
  }
  if (value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error(`${label} must be canonical base64`)
  }
  const file = Buffer.from(value, 'base64')
  if (file.byteLength > MAX_FILE_BYTES) {
    throw new Error(`${label} exceeds the ${MAX_FILE_BYTES}-byte limit`)
  }
  return file
}

export function encodeFile(file: Uint8Array): {
  fileBase64: string
  byteLength: number
} {
  if (file.byteLength > MAX_FILE_BYTES) {
    throw new Error(`generated file exceeds the ${MAX_FILE_BYTES}-byte limit`)
  }
  return {
    fileBase64: Buffer.from(file).toString('base64'),
    byteLength: file.byteLength,
  }
}

export function readRecords(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('records must be a non-empty array of objects')
  }
  if (value.length > MAX_RECORDS) {
    throw new Error(`records exceeds the ${MAX_RECORDS}-record limit`)
  }
  assertStructuredInputSize(value, 'records')
  return value.map((entry, index) => {
    if (!isPlainRecord(entry)) {
      throw new Error(`records[${index}] must be an object`)
    }
    return entry
  })
}

export function readRows(value: unknown): unknown[][] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('rows must be a non-empty array of arrays')
  }
  if (value.length > MAX_RECORDS) {
    throw new Error(`rows exceeds the ${MAX_RECORDS}-row limit`)
  }
  assertStructuredInputSize(value, 'rows')
  return value.map((entry, index) => {
    if (!Array.isArray(entry)) throw new Error(`rows[${index}] must be an array`)
    return entry
  })
}

export function readOptionalString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a non-empty string`)
  return value
}

export function readBoolean(value: unknown, fallback: boolean, label: string): boolean {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`)
  return value
}

export function readBoundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (value === undefined || value === null) return fallback
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}`)
  }
  return value as number
}

export function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Uint8Array) return Buffer.from(value).toString('base64')
  if (Array.isArray(value)) return value.map(jsonSafe)
  if (isPlainRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, jsonSafe(entry)]))
  }
  return value
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

function assertStructuredInputSize(value: unknown, label: string): void {
  let serialized: string
  try {
    serialized = JSON.stringify(value, (_key, entry) => typeof entry === 'bigint' ? entry.toString() : entry)
  } catch {
    throw new Error(`${label} must be JSON-serializable`)
  }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_FILE_BYTES) {
    throw new Error(`${label} exceeds the ${MAX_FILE_BYTES}-byte input limit`)
  }
}
