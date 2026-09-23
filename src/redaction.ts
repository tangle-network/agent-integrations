const SENSITIVE_INPUT_KEY = /token|secret|password|authorization|api[_-]?key|credential|refresh|base64|bytes|binary|audio|attachment|media|payload/i
const MIN_OPAQUE_PREVIEW_VALUE_LENGTH = 16
const MAX_DATA_URL_HEADER_LENGTH = 256
const MAX_EDGE_WHITESPACE_LENGTH = 64

function isEncodedPrivatePayload(value: string): boolean {
  // Treat every data URL as private, including folded or oversized headers, without parsing its body.
  if (/^data:/i.test(value.slice(0, MAX_DATA_URL_HEADER_LENGTH).trimStart())) return true
  // Below 16 characters, ordinary values and encoded bytes are indistinguishable; sensitive field names still redact them.
  if (value.length < MIN_OPAQUE_PREVIEW_VALUE_LENGTH) return false
  let start = 0
  let end = value.length
  while (start < end && (value.charCodeAt(start) === 32 || value.charCodeAt(start) === 9)) {
    if (++start > MAX_EDGE_WHITESPACE_LENGTH) return true
  }
  while (end > start && (value.charCodeAt(end - 1) === 32 || value.charCodeAt(end - 1) === 9)) {
    if (value.length - --end > MAX_EDGE_WHITESPACE_LENGTH) return true
  }
  if (end - start < MIN_OPAQUE_PREVIEW_VALUE_LENGTH) return false
  let encodedLength = 0
  let paddingLength = 0
  let groupLength = 0
  let horizontalLength = 0
  let horizontalHasTab = false
  let spacedGroups = false
  let atLineStart = false
  for (let i = start; i < end; i++) {
    const code = value.charCodeAt(i)
    if (code === 10 || code === 13) {
      horizontalLength = 0
      horizontalHasTab = false
      atLineStart = true
      continue
    }
    if (code === 32 || code === 9) {
      if (atLineStart) continue
      horizontalLength++
      if (code === 9) horizontalHasTab = true
      continue
    }
    if (horizontalLength) {
      // MIME-style chunks have long, aligned groups; an ordinary single space stays visible.
      if (groupLength < MIN_OPAQUE_PREVIEW_VALUE_LENGTH || groupLength % 4 !== 0 ||
          (horizontalLength < 2 && !horizontalHasTab)) return false
      spacedGroups = true
      groupLength = 0
      horizontalLength = 0
      horizontalHasTab = false
    }
    atLineStart = false
    if (code === 61) {
      if (++paddingLength > 2) return false
      groupLength++
      continue
    }
    if (paddingLength) return false
    if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122) ||
        (code >= 48 && code <= 57) || code === 43 || code === 47 ||
        code === 45 || code === 95) {
      encodedLength++
      groupLength++
      continue
    }
    return false
  }
  if (horizontalLength || (spacedGroups && groupLength < 4)) return false
  return encodedLength >= MIN_OPAQUE_PREVIEW_VALUE_LENGTH
}

/** Keep private payloads out of approval, audit, sandbox, and error previews. */
export function redactUnknown(value: unknown): unknown {
  if (typeof value === 'string' && isEncodedPrivatePayload(value)) return '[REDACTED]'
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return '[REDACTED]'
  if (Array.isArray(value)) return value.map(redactUnknown)
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    out[key] = SENSITIVE_INPUT_KEY.test(key) ? '[REDACTED]' : redactUnknown(child)
  }
  return out
}
