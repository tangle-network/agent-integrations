import { describe, expect, it } from 'vitest'
import {
  amzDateNow,
  hashSha256Hex,
  parseAwsCredentialBundle,
  signSigV4,
} from '../src/connectors/adapters/aws-sigv4.js'

// SHA-256 of the empty string — the documented payload hash for a GET / no-body
// request, and a building block of both vectors below.
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

describe('AWS SigV4 signer — known-answer vectors', () => {
  // Vector 1 — AWS docs "Signature Version 4" canonical example: GET ListUsers
  // against IAM. Exercises the non-S3 canonical URI ('/'), query canonicalization,
  // and a signed content-type. Documented intermediate + final values are
  // asserted exactly so the whole chain (canonical request → string-to-sign →
  // signature) is pinned.
  // https://docs.aws.amazon.com/IAM/latest/UserGuide/create-signed-request.html
  it('matches the AWS-documented IAM ListUsers GET example', () => {
    const signed = signSigV4({
      method: 'GET',
      url: new URL('https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08'),
      headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' },
      body: '',
      service: 'iam',
      region: 'us-east-1',
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      amzDate: '20150830T123600Z',
    })

    expect(signed.signedHeaders).toBe('content-type;host;x-amz-date')
    expect(signed.canonicalRequest).toBe(
      [
        'GET',
        '/',
        'Action=ListUsers&Version=2010-05-08',
        'content-type:application/x-www-form-urlencoded; charset=utf-8',
        'host:iam.amazonaws.com',
        'x-amz-date:20150830T123600Z',
        '',
        'content-type;host;x-amz-date',
        EMPTY_SHA256,
      ].join('\n'),
    )
    expect(hashSha256Hex(signed.canonicalRequest)).toBe(
      'f536975d06c0309214f805bb90ccff089219ecd68b2577efef23edd43b7e1a59',
    )
    expect(signed.stringToSign).toBe(
      [
        'AWS4-HMAC-SHA256',
        '20150830T123600Z',
        '20150830/us-east-1/iam/aws4_request',
        'f536975d06c0309214f805bb90ccff089219ecd68b2577efef23edd43b7e1a59',
      ].join('\n'),
    )
    expect(signed.signature).toBe('5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7')
    expect(signed.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, ' +
        'SignedHeaders=content-type;host;x-amz-date, ' +
        'Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7',
    )
  })

  // Vector 2 — AWS docs S3 "GET Object" example. Exercises the S3-specific
  // verbatim canonical URI ('/test.txt', no double-encoding) and a signed
  // x-amz-content-sha256 header alongside a non-AWS header (range). Note the S3
  // secret key differs from the IAM example (slash vs plus) — that is the real
  // documented credential, not a typo.
  // https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html
  it('matches the AWS-documented S3 GetObject example', () => {
    const signed = signSigV4({
      method: 'GET',
      url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
      headers: {
        range: 'bytes=0-9',
        'x-amz-content-sha256': EMPTY_SHA256,
      },
      body: '',
      service: 's3',
      region: 'us-east-1',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      amzDate: '20130524T000000Z',
    })

    expect(signed.signedHeaders).toBe('host;range;x-amz-content-sha256;x-amz-date')
    expect(signed.canonicalRequest).toBe(
      [
        'GET',
        '/test.txt',
        '',
        'host:examplebucket.s3.amazonaws.com',
        'range:bytes=0-9',
        `x-amz-content-sha256:${EMPTY_SHA256}`,
        'x-amz-date:20130524T000000Z',
        '',
        'host;range;x-amz-content-sha256;x-amz-date',
        EMPTY_SHA256,
      ].join('\n'),
    )
    expect(hashSha256Hex(signed.canonicalRequest)).toBe(
      '7344ae5b7ee6c3e7e6b0fe0640412a37625d1fbfff95c48bbb2dc43964946972',
    )
    expect(signed.signature).toBe('f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41')
    expect(signed.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
        'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, ' +
        'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    )
  })
})

describe('AWS SigV4 signer — behavior', () => {
  it('hashes a non-empty payload into the last line of the canonical request', () => {
    const body = JSON.stringify({ QueueUrl: 'https://q', MessageBody: 'hello' })
    const signed = signSigV4({
      method: 'POST',
      url: new URL('https://sqs.us-east-1.amazonaws.com/'),
      headers: {
        'content-type': 'application/x-amz-json-1.0',
        'x-amz-target': 'AmazonSQS.SendMessage',
        'x-amz-content-sha256': hashSha256Hex(body),
      },
      body,
      service: 'sqs',
      region: 'us-east-1',
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      amzDate: '20150830T123600Z',
    })

    expect(signed.canonicalRequest.split('\n').at(-1)).toBe(hashSha256Hex(body))
    // every passed header plus host + x-amz-date is signed, sorted
    expect(signed.signedHeaders).toBe('content-type;host;x-amz-content-sha256;x-amz-date;x-amz-target')
    expect(signed.signature).toMatch(/^[0-9a-f]{64}$/)
  })

  it('signs x-amz-security-token when a session token is present', () => {
    const signed = signSigV4({
      method: 'GET',
      url: new URL('https://sqs.us-east-1.amazonaws.com/'),
      headers: {},
      body: '',
      service: 'sqs',
      region: 'us-east-1',
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: 'secret',
      sessionToken: 'FQoGZXIvYXdzEXAMPLETOKEN',
      amzDate: '20150830T123600Z',
    })
    expect(signed.signedHeaders).toBe('host;x-amz-date;x-amz-security-token')
    expect(signed.canonicalRequest).toContain('x-amz-security-token:FQoGZXIvYXdzEXAMPLETOKEN')
  })

  it('never signs the authorization header even if passed in', () => {
    const signed = signSigV4({
      method: 'GET',
      url: new URL('https://sqs.us-east-1.amazonaws.com/'),
      headers: { authorization: 'Bearer stale' },
      body: '',
      service: 'sqs',
      region: 'us-east-1',
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: 'secret',
      amzDate: '20150830T123600Z',
    })
    expect(signed.signedHeaders).toBe('host;x-amz-date')
  })

  it("strict-encodes !*'() in a non-S3 canonical path (AWS UriEncode, not bare encodeURIComponent)", () => {
    const signed = signSigV4({
      method: 'GET',
      url: new URL("https://api.execute-api.us-east-1.amazonaws.com/prod/o'brien(1)!*"),
      headers: {},
      body: '',
      service: 'execute-api',
      region: 'us-east-1',
      accessKeyId: 'AKID',
      secretAccessKey: 'secret',
      amzDate: '20150830T123600Z',
    })
    // line 2 of the canonical request is the canonical URI; ' ( ) ! * must be
    // percent-escaped or AWS's server-side UriEncode would compute a different one.
    expect(signed.canonicalRequest.split('\n')[1]).toBe('/prod/o%27brien%281%29%21%2A')
  })

  it('formats amzDateNow as YYYYMMDDTHHMMSSZ', () => {
    expect(amzDateNow(new Date('2015-08-30T12:36:00.000Z'))).toBe('20150830T123600Z')
  })
})

describe('parseAwsCredentialBundle', () => {
  it('parses a JSON bundle with camelCase keys', () => {
    const bundle = parseAwsCredentialBundle({
      kind: 'api-key',
      apiKey: JSON.stringify({
        accessKeyId: 'AKIA',
        secretAccessKey: 'sk',
        region: 'eu-west-1',
        sessionToken: 'tok',
        endpoint: 'https://s3.example.com',
      }),
    })
    expect(bundle).toEqual({
      accessKeyId: 'AKIA',
      secretAccessKey: 'sk',
      region: 'eu-west-1',
      sessionToken: 'tok',
      endpoint: 'https://s3.example.com',
    })
  })

  it('accepts snake_case aliases', () => {
    const bundle = parseAwsCredentialBundle({
      kind: 'api-key',
      apiKey: JSON.stringify({ access_key_id: 'AKIA', secret_access_key: 'sk', region: 'us-east-2' }),
    })
    expect(bundle.accessKeyId).toBe('AKIA')
    expect(bundle.secretAccessKey).toBe('sk')
    expect(bundle.region).toBe('us-east-2')
  })

  it('throws a clear error for a non-JSON api key', () => {
    expect(() => parseAwsCredentialBundle({ kind: 'api-key', apiKey: 'AKIAplainstring' })).toThrow(/non-JSON/)
  })

  it('throws when the access-key pair is missing', () => {
    expect(() =>
      parseAwsCredentialBundle({ kind: 'api-key', apiKey: JSON.stringify({ region: 'us-east-1' }) }),
    ).toThrow(/accessKeyId/)
  })

  it('rejects non-api-key credentials', () => {
    expect(() => parseAwsCredentialBundle({ kind: 'oauth2', accessToken: 'x' })).toThrow(/api-key/)
  })
})
