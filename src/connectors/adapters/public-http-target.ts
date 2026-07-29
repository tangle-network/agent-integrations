/** Reject literal local/private HTTP targets before a universal connector calls fetch. */
export function assertPublicHttpTarget(url: URL, label: string): void {
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname === 'metadata.google.internal'
  ) {
    throw new Error(`${label} host is not a public network target`)
  }
  if (isPrivateIpv4(hostname) || isPrivateIpv6(hostname)) {
    throw new Error(`${label} host is not a public network target`)
  }
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.')
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false
  const octets = parts.map(Number)
  if (octets.some((octet) => octet > 255)) return false
  const [a, b] = octets
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  )
}

function isPrivateIpv6(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  if (normalized === '::' || normalized === '::1') return true
  if (/^f[cd]/.test(normalized) || /^fe[89ab]/.test(normalized)) return true
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  return mapped ? isPrivateIpv4(mapped[1]) : false
}
