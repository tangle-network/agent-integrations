import { lookup } from 'node:dns/promises'
import type { LookupFunction } from 'node:net'
import ipaddr from 'ipaddr.js'

export function isPublicNetworkAddress(value: string): boolean {
  if (!ipaddr.isValid(value)) return false
  let address = ipaddr.parse(value)
  if (address.kind() === 'ipv6' && (address as ipaddr.IPv6).isIPv4MappedAddress()) {
    address = (address as ipaddr.IPv6).toIPv4Address()
  }
  return address.range() === 'unicast'
}

export async function resolvePublicHostAddresses(host: string): Promise<string[]> {
  const addresses = ipaddr.isValid(host)
    ? [host]
    : (await lookup(host, { all: true, verbatim: true })).map((entry) => entry.address)
  if (addresses.length === 0 || addresses.some((address) => !isPublicNetworkAddress(address))) {
    throw new Error('host is not a public network target')
  }
  return addresses
}

export const publicDnsLookup: LookupFunction = (hostname, options, callback) => {
  const normalizedOptions = typeof options === 'number' ? { family: options } : options
  lookup(hostname, { ...normalizedOptions, all: true, verbatim: true })
    .then((entries) => {
      if (entries.length === 0 || entries.some((entry) => !isPublicNetworkAddress(entry.address))) {
        callback(new Error('host is not a public network target'), '', 0)
        return
      }
      if (normalizedOptions?.all) {
        callback(null, entries as never, undefined as never)
        return
      }
      callback(null, entries[0]!.address, entries[0]!.family)
    })
    .catch((error: unknown) => callback(error instanceof Error ? error : new Error('DNS lookup failed'), '', 0))
}
