import { createHmac } from 'node:crypto'

export interface OAuth1Credentials {
  consumerKey: string
  consumerSecret: string
  accessToken: string
  accessTokenSecret: string
}

/** RFC 5849 signature over the final URL and, only for form requests, the body. */
export function oauth1Authorization(input: {
  method: string
  url: URL
  formBody?: string
  credentials: OAuth1Credentials
  nonce: string
  timestamp: string
}): string {
  const { credentials, url } = input
  const oauth: Record<string, string> = {
    oauth_consumer_key: credentials.consumerKey,
    oauth_nonce: input.nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: input.timestamp,
    oauth_token: credentials.accessToken,
    oauth_version: '1.0',
  }
  const parameters = [
    ...url.searchParams.entries(),
    ...new URLSearchParams(input.formBody).entries(),
    ...Object.entries(oauth),
  ].map(([key, value]) => [encode(key!), encode(value!)] as const)
  parameters.sort(([ak, av], [bk, bv]) => ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0)
  const normalized = parameters.map(([key, value]) => `${key}=${value}`).join('&')
  const base = [input.method.toUpperCase(), `${url.origin}${url.pathname}`, normalized].map(encode).join('&')
  const key = `${encode(credentials.consumerSecret)}&${encode(credentials.accessTokenSecret)}`
  oauth.oauth_signature = createHmac('sha1', key).update(base).digest('base64')
  return `OAuth ${Object.entries(oauth).map(([name, value]) => `${encode(name)}="${encode(value)}"`).join(', ')}`
}

function encode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, character =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
}
