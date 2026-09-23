const SENSITIVE_INPUT_KEY = /token|secret|password|authorization|api[_-]?key|credential|refresh|base64|bytes|binary|audio|attachment|media|payload/i

function isEncodedPrivatePayload(value: string): boolean {
  if (value.length < 128 || value.length % 4 !== 0) return false
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122) ||
        (code >= 48 && code <= 57) || code === 43 || code === 47) continue
    if (code === 61 && i >= value.length - 2) continue
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
