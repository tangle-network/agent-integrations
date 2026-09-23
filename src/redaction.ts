const SENSITIVE_INPUT_KEY = /token|secret|password|authorization|api[_-]?key|credential|refresh|base64|bytes|binary|audio|attachment|media|payload/i
const MIN_OPAQUE_PREVIEW_VALUE_LENGTH = 16

function isEncodedPrivatePayload(value: string): boolean {
  // Below 16 characters, ordinary values and encoded bytes are indistinguishable; sensitive field names still redact them.
  if (value.length < MIN_OPAQUE_PREVIEW_VALUE_LENGTH) return false
  let padding = false
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code === 61) {
      if (i < value.length - 2) return false
      padding = true
      continue
    }
    if (padding) return false
    if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122) ||
        (code >= 48 && code <= 57) || code === 43 || code === 47 ||
        code === 45 || code === 95) continue
    return false
  }
  return true
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
