const SENSITIVE_INPUT_KEY = /token|secret|password|authorization|api[_-]?key|credential|refresh|base64|bytes|binary/i

/** Keep private payloads out of approval, audit, sandbox, and error previews. */
export function redactUnknown(value: unknown): unknown {
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return '[REDACTED]'
  if (Array.isArray(value)) return value.map(redactUnknown)
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    out[key] = SENSITIVE_INPUT_KEY.test(key) ? '[REDACTED]' : redactUnknown(child)
  }
  return out
}
