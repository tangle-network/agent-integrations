const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export async function sha256Base64Url(value: string): Promise<string> {
  const crypto = requireWebCrypto()
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return bytesToBase64Url(new Uint8Array(digest))
}

export function createWebCryptoUuid(): string {
  const crypto = requireWebCrypto()
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()

  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  return [...bytes]
    .map((byte, index) => {
      const value = byte.toString(16).padStart(2, '0')
      return [4, 6, 8, 10].includes(index) ? `-${value}` : value
    })
    .join('')
}

function requireWebCrypto(): Crypto {
  const crypto = globalThis.crypto
  if (!crypto || !crypto.subtle || typeof crypto.getRandomValues !== 'function') {
    throw new Error('The Web Crypto API is required for integration security operations.')
  }
  return crypto
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let encoded = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]!
    const second = bytes[index + 1]
    const third = bytes[index + 2]
    encoded += BASE64_ALPHABET[first >> 2]
    encoded += BASE64_ALPHABET[((first & 0x03) << 4) | (second === undefined ? 0 : second >> 4)]
    encoded += second === undefined
      ? '='
      : BASE64_ALPHABET[((second & 0x0f) << 2) | (third === undefined ? 0 : third >> 6)]
    encoded += third === undefined ? '=' : BASE64_ALPHABET[third & 0x3f]
  }
  return encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}
