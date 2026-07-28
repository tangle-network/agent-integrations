import { describe, expect, it } from 'vitest'
import {
  MICROSOFT_TEAMS_MESSAGE_EVENT,
  MICROSOFT_TEAMS_PROVIDER_ID,
  MICROSOFT_TEAMS_TRIGGER_EVENT_CATALOG,
  normalizeConversationEvent,
  resolveMicrosoftTeamsTenantId,
  type InboundEmailPayload,
} from '../src/conversation-events/index'

describe('normalizeConversationEvent', () => {
  it('projects inbound email into bounded provider-neutral message data', () => {
    const payload: InboundEmailPayload = {
      messageId: '<message-2@example.test>',
      from: 'Broker@Example.Test',
      to: 'Relationships-ABC@Tangle.sh',
      subject: 'Re: West LA portfolio',
      text: 'The seller can share trailing financials tomorrow.',
      html: '<p>The seller can share trailing financials tomorrow.</p>',
      headers: {
        'In-Reply-To': '<message-1@example.test>',
        References:
          '<message-0@example.test> <message-1@example.test>',
      },
      attachments: [
        {
          filename: 'financials.pdf',
          contentType: 'application/pdf',
          contentBase64: 'cGRm',
          size: 3,
        },
      ],
      receivedAt: 1_785_105_660_000,
    }

    expect(
      normalizeConversationEvent({
        provider: 'email',
        type: 'email.received',
        deliveryId: 'edge-delivery-1',
        payload,
      }),
    ).toEqual({
      ok: true,
      event: {
        version: 1,
        provider: 'email',
        eventType: 'email.received',
        operation: 'created',
        eventId: 'message-2@example.test',
        conversationId: null,
        parentEventIds: [
          'message-1@example.test',
          'message-0@example.test',
        ],
        sender: {
          id: null,
          address: 'Broker@Example.Test',
          displayName: null,
        },
        destinations: [
          {
            kind: 'mailbox',
            id: null,
            address: 'relationships-abc@tangle.sh',
            displayName: null,
          },
        ],
        subject: 'Re: West LA portfolio',
        text: 'The seller can share trailing financials tomorrow.',
        html: '<p>The seller can share trailing financials tomorrow.</p>',
        attachments: [
          {
            id: null,
            name: 'financials.pdf',
            contentType: 'application/pdf',
            size: 3,
            contentBase64: 'cGRm',
            url: null,
          },
        ],
        occurredAt: 1_785_105_660_000,
      },
    })
  })

  it('falls back to the provider delivery id when email has no Message-ID', () => {
    const result = normalizeConversationEvent({
      provider: 'email',
      type: 'email.received',
      deliveryId: 'delivery-123',
      payload: {
        from: 'automation@example.test',
        to: 'intake@tangle.sh',
        text: 'Automated delivery',
      },
    })
    expect(result).toMatchObject({
      ok: true,
      event: {
        eventId: 'delivery-123',
        sender: { address: 'automation@example.test' },
      },
    })
  })

  it('fails closed on malformed or oversized email data', () => {
    expect(
      normalizeConversationEvent({
        provider: 'email',
        type: 'email.received',
        payload: { from: 'a@example.test' },
      }),
    ).toEqual({
      ok: false,
      code: 'invalid_payload',
      message: 'Email payload requires non-empty string from and to',
    })
    expect(
      normalizeConversationEvent({
        provider: 'email',
        type: 'email.received',
        payload: {
          from: ' ',
          to: 'intake@tangle.sh',
        },
      }),
    ).toEqual({
      ok: false,
      code: 'invalid_payload',
      message: 'Email payload requires non-empty string from and to',
    })
    expect(
      normalizeConversationEvent({
        provider: 'email',
        type: 'email.received',
        payload: {
          from: 'a@example.test',
          to: 'intake@tangle.sh',
          text: 'x'.repeat(1_000_001),
        },
      }),
    ).toMatchObject({ ok: false, code: 'invalid_payload' })
  })

  it('projects a Slack thread reply with sender, channel, files, and time', () => {
    const result = normalizeConversationEvent({
      provider: 'slack',
      type: 'slack.message',
      deliveryId: 'slack-delivery-1',
      payload: {
        type: 'event_callback',
        event_id: 'Ev01',
        team_id: 'T01',
        event_time: 1_785_105_660,
        event: {
          type: 'message',
          user: 'U01',
          text: 'The seller approved the package.',
          channel: 'C01',
          ts: '1785105660.123400',
          thread_ts: '1785105600.000100',
          files: [
            {
              id: 'F01',
              name: 'approval.pdf',
              mimetype: 'application/pdf',
              size: 1_024,
              url_private: 'https://files.slack.com/files-pri/F01',
            },
          ],
        },
      },
    })

    expect(result).toEqual({
      ok: true,
      event: {
        version: 1,
        provider: 'slack',
        eventType: 'slack.message',
        operation: 'created',
        eventId: 'Ev01',
        conversationId: 'T01:C01:1785105600.000100',
        parentEventIds: ['1785105600.000100'],
        sender: { id: 'U01', address: null, displayName: null },
        destinations: [
          {
            kind: 'channel',
            id: 'C01',
            address: null,
            displayName: null,
          },
        ],
        subject: null,
        text: 'The seller approved the package.',
        html: null,
        attachments: [
          {
            id: 'F01',
            name: 'approval.pdf',
            contentType: 'application/pdf',
            size: 1_024,
            contentBase64: null,
            url: null,
          },
        ],
        occurredAt: 1_785_105_660_123,
      },
    })
  })

  it('marks Slack edits and rejects malformed Teams activities', () => {
    expect(
      normalizeConversationEvent({
        provider: 'slack',
        type: 'slack.message',
        payload: {
          event_id: 'Ev02',
          team_id: 'T01',
          event: {
            type: 'message',
            subtype: 'message_changed',
            channel: 'C01',
            event_ts: '1785105661.000000',
            message: {
              type: 'message',
              user: 'U01',
              text: 'Corrected',
              ts: '1785105660.123400',
            },
          },
        },
      }),
    ).toMatchObject({
      ok: true,
      event: { operation: 'updated', text: 'Corrected' },
    })
    expect(
      normalizeConversationEvent({
        provider: 'microsoft-teams',
        type: 'teams.message',
        payload: {},
      }),
    ).toEqual({
      ok: false,
      code: 'invalid_payload',
      message: 'Teams payload requires a message activity',
    })
  })

  it('projects an authenticated Teams activity into a stable conversation event', () => {
    expect(
      normalizeConversationEvent({
        provider: 'microsoft-teams',
        type: 'teams.message',
        deliveryId: 'activity-1',
        payload: {
          type: 'message',
          id: 'activity-1',
          timestamp: '2026-07-27T06:01:00.000Z',
          channelId: 'msteams',
          from: {
            id: '29:opaque-user',
            aadObjectId: 'entra-user-1',
            name: 'Jordan Lee',
          },
          conversation: {
            id: '19:conversation@thread.tacv2',
            conversationType: 'channel',
            tenantId: 'tenant-1',
          },
          channelData: {
            tenant: { id: 'tenant-1' },
            team: { id: 'team-1', name: 'Acme Capital' },
            channel: { id: 'channel-1', name: 'Deals' },
          },
          replyToId: 'activity-root',
          text: 'Find the best buyers for this package.',
          attachments: [
            {
              id: 'attachment-1',
              name: 'package.pdf',
              contentType: 'application/vnd.microsoft.teams.file.download.info',
              contentUrl: 'https://files.example.test/private',
            },
          ],
        },
      }),
    ).toEqual({
      ok: true,
      event: {
        version: 1,
        provider: 'teams',
        eventType: 'teams.message',
        operation: 'created',
        eventId: 'activity-1',
        conversationId: 'tenant-1:19:conversation@thread.tacv2',
        parentEventIds: ['activity-root'],
        sender: {
          id: 'entra-user-1',
          address: null,
          displayName: 'Jordan Lee',
        },
        destinations: [
          {
            kind: 'channel',
            id: 'channel-1',
            address: null,
            displayName: 'Deals',
          },
          {
            kind: 'channel',
            id: 'team-1',
            address: null,
            displayName: 'Acme Capital',
          },
        ],
        subject: null,
        text: 'Find the best buyers for this package.',
        html: null,
        attachments: [
          {
            id: 'attachment-1',
            name: 'package.pdf',
            contentType:
              'application/vnd.microsoft.teams.file.download.info',
            size: null,
            contentBase64: null,
            url: null,
          },
        ],
        occurredAt: 1_785_132_060_000,
      },
    })
  })

  it('rejects malformed Teams attachment metadata', () => {
    expect(
      normalizeConversationEvent({
        provider: 'microsoft-teams',
        type: 'teams.message',
        payload: {
          type: 'message',
          id: 'activity-1',
          channelId: 'msteams',
          conversation: {
            id: '19:conversation@thread.tacv2',
            tenantId: 'tenant-1',
          },
          channelData: { tenant: { id: 'tenant-1' } },
          attachments: [{ id: { unexpected: true } }],
        },
      }),
    ).toEqual({
      ok: false,
      code: 'invalid_payload',
      message: 'Teams attachment contains an invalid field',
    })
  })

  it('rejects conflicting Teams tenant identities', () => {
    expect(
      normalizeConversationEvent({
        provider: 'microsoft-teams',
        type: 'teams.message',
        payload: {
          type: 'message',
          channelId: 'msteams',
          conversation: {
            id: '19:conversation@thread.tacv2',
            tenantId: 'tenant-a',
          },
          channelData: {
            tenant: { id: 'tenant-b' },
          },
          text: 'hello',
        },
      }),
    ).toEqual({
      ok: false,
      code: 'invalid_payload',
      message: 'Teams activity contains conflicting tenant ids',
    })
  })

  it('shares one closed Teams event contract and tenant resolver', () => {
    expect(MICROSOFT_TEAMS_PROVIDER_ID).toBe('microsoft-teams')
    expect(MICROSOFT_TEAMS_MESSAGE_EVENT).toBe('teams.message')
    expect(MICROSOFT_TEAMS_TRIGGER_EVENT_CATALOG).toEqual({
      namespace: 'teams.',
      closed: true,
      events: [{ id: 'teams.message' }],
    })
    expect(
      resolveMicrosoftTeamsTenantId({
        conversation: { tenantId: 'tenant-1' },
        channelData: { tenant: { id: 'tenant-1' } },
      }),
    ).toEqual({ ok: true, tenantId: 'tenant-1' })
    expect(resolveMicrosoftTeamsTenantId({})).toEqual({
      ok: false,
      message: 'Teams message requires a tenant id',
    })
  })
})
