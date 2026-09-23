const ATTACHMENT_PATH = /^\/v1\/attachments\/([A-Za-z0-9._~-]+)\/content$/

/** Only Linq's exact attachment route may receive the connected brand key. */
export function linqWhatsappAttachmentUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null
  try {
    const url = new URL(value)
    const match = ATTACHMENT_PATH.exec(url.pathname)
    if (url.origin !== 'https://whatsapp.messages.api.linqapp.com' || url.username || url.password ||
        url.search || url.hash || !match || match[1] === '.' || match[1] === '..') return null
    return url.href
  } catch {
    return null
  }
}
