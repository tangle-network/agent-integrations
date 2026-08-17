import { describe, expect, it } from 'vitest'
import { slackHandshakeResponse } from '../src/webhooks/providers'

describe('slackHandshakeResponse', () => {
  it('echoes the challenge Slack requires to complete an app install', () => {
    expect(slackHandshakeResponse(JSON.stringify({ type: 'url_verification', challenge: 'abc' }))).toEqual({
      challenge: 'abc',
    })
  })

  it('answers an empty challenge rather than dropping the handshake', () => {
    expect(slackHandshakeResponse(JSON.stringify({ type: 'url_verification' }))).toEqual({ challenge: '' })
  })

  it('declines a workspace event so it reaches the router', () => {
    expect(slackHandshakeResponse(JSON.stringify({ type: 'event_callback', event_id: 'Ev1' }))).toBeNull()
  })

  it('declines a body that is not JSON', () => {
    expect(slackHandshakeResponse('not json')).toBeNull()
    expect(slackHandshakeResponse('null')).toBeNull()
  })
})
