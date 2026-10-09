import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  HOSTED_TRIGGER_DEFINITIONS,
  HOSTED_TRIGGER_PROVIDER_IDS,
  MAX_EVENTS_PER_POLL,
  hostedTrigger,
  hostedTriggerEventCatalog,
  pollHostedTrigger,
  type HostedTriggerRead,
} from '../src/triggers/index'
import { buildRuntimeBundledAdapterManifests } from '../src/connectors/bundled-manifest-runtime'
import { clerkWebhookProvider } from '../src/webhooks/index'

const NOW = new Date('2026-10-09T12:00:00.000Z')
const SINCE = '2026-10-09T11:00:00.000Z'
const cursor = { since: SINCE, seen: [] as string[] }

/** A connector peer: each capability answers from a table, and every call is recorded. */
function reads(table: Record<string, (args: Record<string, unknown>) => unknown>) {
  const calls: Array<{ capability: string; args: Record<string, unknown> }> = []
  const read: HostedTriggerRead = async (capability, args) => {
    calls.push({ capability, args })
    const answer = table[capability]
    if (!answer) throw new Error(`unexpected read ${capability}`)
    return answer(args)
  }
  return { read, calls }
}

function trigger(provider: string, event: string) {
  const found = hostedTrigger(provider, event)
  if (!found) throw new Error(`no trigger ${provider} ${event}`)
  return found
}

describe('hosted trigger contract', () => {
  it('uses only READ capabilities that exist on each connector, with a closed per-provider catalog', () => {
    const manifests = new Map(buildRuntimeBundledAdapterManifests().map((manifest) => [manifest.kind, manifest]))
    for (const definition of HOSTED_TRIGGER_DEFINITIONS) {
      const manifest = manifests.get(definition.provider)
      expect(manifest, definition.provider).toBeDefined()
      for (const capability of definition.reads) {
        expect(manifest!.capabilities.find((item) => item.name === capability)?.class, `${definition.provider}.${capability}`).toBe('read')
      }
      expect(definition.event.startsWith(`${definition.provider}.`)).toBe(true)
      expect(hostedTriggerEventCatalog(definition.provider)).toMatchObject({ namespace: `${definition.provider}.`, closed: true })
    }
    expect(HOSTED_TRIGGER_PROVIDER_IDS).toEqual(expect.arrayContaining(['gmail', 'outlook-mail', 'hubspot', 'attio', 'pipedrive',
      'typeform', 'tally', 'webflow', 'calendly', 'cal-com', 'intercom']))
    expect(hostedTriggerEventCatalog('hubspot')!.events.map((event) => event.id)).toEqual(['hubspot.contact.created', 'hubspot.deal.created'])
  })

  it('records a baseline on the first poll and never replays history', async () => {
    const { read, calls } = reads({})
    const result = await pollHostedTrigger(trigger('typeform', 'typeform.response.submitted'), { read, cursor: null, now: NOW })
    expect(result).toEqual({ events: [], cursor: { since: NOW.toISOString(), seen: [] }, more: false })
    expect(calls).toEqual([])
  })

  it('emits each new record once, oldest first, capped per poll, and resumes from the cursor', async () => {
    const minute = 60_000
    const contacts = Array.from({ length: MAX_EVENTS_PER_POLL + 5 }, (_, index) => ({
      id: String(index + 1), email: `person${index + 1}@example.com`, name: `Person ${index + 1}`,
      createdAt: new Date(Date.parse(SINCE) + (MAX_EVENTS_PER_POLL + 5 - index) * minute).toISOString(),
    }))
    contacts.push({ id: 'old', email: 'old@example.com', name: 'Old', createdAt: '2026-10-09T10:59:59.000Z' })
    const { read } = reads({ list_new_contacts: () => ({ contacts, after: null }) })
    const first = await pollHostedTrigger(trigger('hubspot', 'hubspot.contact.created'), { read, cursor, now: NOW })
    expect(first.events).toHaveLength(MAX_EVENTS_PER_POLL)
    expect(first.more).toBe(true)
    expect(first.events[0]).toMatchObject({ id: `hubspot:contact:${MAX_EVENTS_PER_POLL + 5}`, type: 'hubspot.contact.created',
      person: { email: `person${MAX_EVENTS_PER_POLL + 5}@example.com`, name: `Person ${MAX_EVENTS_PER_POLL + 5}`, company: null } })
    const times = first.events.map((event) => Date.parse(event.occurredAt))
    expect([...times].sort((a, b) => a - b)).toEqual(times)
    expect(first.events.some((event) => event.id.endsWith(':old'))).toBe(false)

    const second = await pollHostedTrigger(trigger('hubspot', 'hubspot.contact.created'), { read, cursor: first.cursor, now: NOW })
    expect(second.events.map((event) => event.id)).toEqual(['hubspot:contact:5', 'hubspot:contact:4', 'hubspot:contact:3', 'hubspot:contact:2', 'hubspot:contact:1'])
    const third = await pollHostedTrigger(trigger('hubspot', 'hubspot.contact.created'), { read, cursor: second.cursor, now: NOW })
    expect(third.events).toEqual([])
    expect(third.cursor.since).toBe(second.cursor.since)
  })

  it('keeps the cursor when the connector read fails', async () => {
    const read: HostedTriggerRead = async () => { throw new Error('provider 503') }
    await expect(pollHostedTrigger(trigger('gmail', 'gmail.message.received'), { read, cursor, now: NOW })).rejects.toThrow('provider 503')
  })
})

describe('hosted trigger definitions', () => {
  it('gmail: queries the inbox since the cursor and skips automated senders', async () => {
    const at = String(Date.parse(SINCE) + 1000)
    const { read, calls } = reads({ list_messages: () => ({ messages: [
      { id: 'm1', threadId: 't1', internalDate: at, from: 'Grace Hopper <grace@navy.example>', to: 'sales@tangle.tools', subject: 'Pricing for 40 seats?', snippet: 'Hi there' },
      { id: 'm2', internalDate: at, from: 'no-reply@stripe.com', to: 'sales@tangle.tools', subject: 'Receipt', snippet: '' },
    ] }) })
    const { events } = await pollHostedTrigger(trigger('gmail', 'gmail.message.received'), { read, cursor, now: NOW })
    expect(calls[0].args.query).toBe(`in:inbox -from:me after:${Math.floor(Date.parse(SINCE) / 1000)}`)
    expect(events).toEqual([{ id: 'gmail:m1', type: 'gmail.message.received', occurredAt: new Date(Number(at)).toISOString(),
      person: { email: 'grace@navy.example', name: 'Grace Hopper', company: null }, summary: 'Email: Pricing for 40 seats?',
      record: { messageId: 'm1', threadId: 't1', from: 'grace@navy.example', to: ['sales@tangle.tools'], subject: 'Pricing for 40 seats?', preview: 'Hi there' } }])
  })

  it('outlook-mail: keeps only messages received since the cursor', async () => {
    const { read } = reads({ list_messages: () => ({ messages: [
      { id: 'o1', conversationId: 'c1', receivedDateTime: '2026-10-09T11:30:00Z', from: 'ada@engines.io', fromName: 'Ada', to: ['hello@tangle.tools'], subject: 'Demo?', bodyPreview: 'Can we talk' },
      { id: 'o0', receivedDateTime: '2026-10-09T10:00:00Z', from: 'old@engines.io', to: [], subject: 'Old', bodyPreview: '' },
    ] }) })
    const { events } = await pollHostedTrigger(trigger('outlook-mail', 'outlook-mail.message.received'), { read, cursor, now: NOW })
    expect(events.map((event) => event.person?.email)).toEqual(['ada@engines.io'])
  })

  it('typeform: reads each form\'s completed responses since the cursor with question titles', async () => {
    const { read, calls } = reads({
      'forms.list': () => ({ items: [{ id: 'abc123', title: 'Demo request' }, { id: 'quiet1', title: 'Survey' }] }),
      'responses.list': (args) => args.form_id === 'abc123' ? { items: [{ token: 'r1', submitted_at: '2026-10-09T11:10:00Z', answers: [
        { type: 'email', email: 'bo@startup.dev', field: { id: 'f1', ref: 'email' } },
        { type: 'text', text: 'Bo Buyer', field: { id: 'f2', ref: 'name' } },
        { type: 'text', text: 'Startup Inc', field: { id: 'f3', ref: 'company' } },
        { type: 'choice', choice: { label: '50-200' }, field: { id: 'f4', ref: 'size' } },
      ] }] } : { items: [] },
      'forms.get': () => ({ fields: [{ id: 'f1', title: 'Work email' }, { id: 'f2', title: 'Your name' }, { id: 'f3', title: 'Company' }, { id: 'f4', title: 'Team size' }] }),
    })
    const { events } = await pollHostedTrigger(trigger('typeform', 'typeform.response.submitted'), { read, cursor, now: NOW })
    expect(calls.filter((call) => call.capability === 'responses.list').map((call) => call.args)).toEqual([
      { form_id: 'abc123', since: SINCE, completed: true, sort: 'submitted_at,asc', page_size: 50 },
      { form_id: 'quiet1', since: SINCE, completed: true, sort: 'submitted_at,asc', page_size: 50 },
    ])
    expect(calls.filter((call) => call.capability === 'forms.get')).toHaveLength(1)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ id: 'typeform:response:r1', person: { email: 'bo@startup.dev', name: 'Bo Buyer', company: 'Startup Inc' },
      summary: 'Typeform response to "Demo request"' })
    expect(events[0].record.answers).toContainEqual({ question: 'Team size', answer: '50-200' })
  })

  it('cal-com: turns new upcoming bookings into attendee events and pages the list', async () => {
    const { read, calls } = reads({ 'bookings.list': (args) => args.cursor
      ? { data: [{ uid: 'b2', title: '30 min', start: '2026-10-20T15:00:00Z', createdAt: '2026-10-09T11:40:00Z', attendees: [{ name: 'Linus', email: 'linus@kernels.example' }] }] }
      : { data: [{ uid: 'b1', title: 'Intro call', start: '2026-10-14T15:00:00Z', createdAt: '2026-10-09T11:20:00Z', attendees: [{ name: 'Ada', email: 'ada@engines.io' }] },
          { uid: 'b0', title: 'Old', start: '2026-10-12T15:00:00Z', createdAt: '2026-10-01T00:00:00Z', attendees: [{ email: 'old@x.example' }] }],
        pagination: { nextCursor: 'next' } } })
    const { events } = await pollHostedTrigger(trigger('cal-com', 'cal-com.booking.created'), { read, cursor, now: NOW })
    expect(calls).toHaveLength(2)
    expect(events.map((event) => [event.id, event.person?.email, event.summary])).toEqual([
      ['cal-com:booking:b1', 'ada@engines.io', 'Booked "Intro call" for 2026-10-14T15:00:00Z'],
      ['cal-com:booking:b2', 'linus@kernels.example', 'Booked "30 min" for 2026-10-20T15:00:00Z'],
    ])
  })

  it('calendly: reads the current user\'s new meetings and their invitees', async () => {
    const { read } = reads({
      'user.get-current': () => ({ resource: { uri: 'https://api.calendly.com/users/U1' } }),
      'scheduled-events.list': (args) => {
        expect(args).toMatchObject({ user: 'https://api.calendly.com/users/U1', min_start_time: SINCE })
        return { collection: [{ uri: 'https://api.calendly.com/scheduled_events/E1', name: 'Discovery', start_time: '2026-10-15T16:00:00Z', created_at: '2026-10-09T11:05:00Z' }] }
      },
      'scheduled-events.list-invitees': () => ({ collection: [{ uri: 'https://api.calendly.com/scheduled_events/E1/invitees/I1', email: 'grace@navy.example', name: 'Grace',
        created_at: '2026-10-09T11:05:00Z', questions_and_answers: [{ question: 'Company', answer: 'Navy' }] }] }),
    })
    const { events } = await pollHostedTrigger(trigger('calendly', 'calendly.invitee.created'), { read, cursor, now: NOW })
    expect(events[0]).toMatchObject({ person: { email: 'grace@navy.example', name: 'Grace', company: 'Navy' }, summary: 'Booked "Discovery" for 2026-10-15T16:00:00Z' })
  })

  it('pipedrive: reads newest persons first and stops paging once past the cursor', async () => {
    const { read, calls } = reads({ 'persons.list': () => ({ data: [
      { id: 7, name: 'Bo', email: [{ value: 'bo@startup.dev', primary: true }], org_name: 'Startup', add_time: '2026-10-09 11:30:00' },
      { id: 6, name: 'Old', email: [{ value: 'old@x.example' }], add_time: '2026-10-01 09:00:00' },
    ] }) })
    const { events } = await pollHostedTrigger(trigger('pipedrive', 'pipedrive.person.created'), { read, cursor, now: NOW })
    expect(calls).toHaveLength(1)
    expect(calls[0].args).toEqual({ sort: 'add_time DESC', start: 0, limit: 100 })
    expect(events.map((event) => [event.occurredAt, event.person])).toEqual([['2026-10-09T11:30:00.000Z', { email: 'bo@startup.dev', name: 'Bo', company: 'Startup' }]])
  })

  it('intercom: searches conversations created since the cursor and skips ones admins started', async () => {
    const { read, calls } = reads({ 'tickets.search': () => ({ conversations: [
      { id: 'c1', created_at: Math.floor(Date.parse(SINCE) / 1000) + 60, source: { subject: 'Question', body: '<p>Do you support SSO?</p>', author: { type: 'lead', email: 'q@co.example', name: 'Q' } } },
      { id: 'c2', created_at: Math.floor(Date.parse(SINCE) / 1000) + 90, source: { body: 'Hi', author: { type: 'admin', email: 'support@tangle.tools' } } },
    ] }) })
    const { events } = await pollHostedTrigger(trigger('intercom', 'intercom.conversation.created'), { read, cursor, now: NOW })
    expect(calls[0].args).toEqual({ body: { query: { field: 'created_at', operator: '>', value: Math.floor(Date.parse(SINCE) / 1000) - 1 }, pagination: { per_page: 50 } } })
    expect(events.map((event) => event.record.body)).toEqual(['Do you support SSO?'])
  })

  it('tally, webflow and attio: read form submissions and new people with their emails', async () => {
    const tally = reads({
      'forms.list': () => ({ items: [{ id: 'w1', name: 'Contact' }] }),
      'submissions.list': () => ({ questions: [{ id: 'q1', title: 'Email', type: 'INPUT_EMAIL' }, { id: 'q2', title: 'Name', type: 'INPUT_TEXT' }],
        submissions: [{ id: 's1', submittedAt: '2026-10-09T11:15:00Z', responses: [{ questionId: 'q1', value: 'ann@co.example' }, { questionId: 'q2', value: 'Ann' }] }] }),
    })
    expect((await pollHostedTrigger(trigger('tally', 'tally.submission.created'), { read: tally.read, cursor, now: NOW })).events[0].person)
      .toEqual({ email: 'ann@co.example', name: 'Ann', company: null })
    const webflow = reads({
      'sites.list': () => ({ sites: [{ id: 'site1', displayName: 'Tangle' }] }),
      'forms.list': () => ({ forms: [{ id: 'form1', displayName: 'Contact' }] }),
      'forms.submissions': () => ({ formSubmissions: [{ id: 'fs1', dateSubmitted: '2026-10-09T11:16:00Z', formResponse: { Email: 'web@co.example', Name: 'Web', Message: 'Hello' } }] }),
    })
    expect((await pollHostedTrigger(trigger('webflow', 'webflow.form.submitted'), { read: webflow.read, cursor, now: NOW })).events[0].person)
      .toEqual({ email: 'web@co.example', name: 'Web', company: null })
    const attio = reads({ 'records.query': () => ({ data: [{ id: { record_id: 'rec1' }, created_at: '2026-10-09T11:17:00Z',
      values: { name: [{ full_name: 'At Tio' }], email_addresses: [{ email_address: 'at@co.example' }] } }] }) })
    expect((await pollHostedTrigger(trigger('attio', 'attio.person.created'), { read: attio.read, cursor, now: NOW })).events[0].person)
      .toEqual({ email: 'at@co.example', name: 'At Tio', company: null })
    expect(attio.calls[0].args).toMatchObject({ object: 'people', filter: { created_at: { $gte: SINCE } } })
  })
})

describe('clerk signup webhooks', () => {
  const secret = `whsec_${Buffer.from('clerk-test-signing-key').toString('base64')}`
  function signed(body: string, at = Math.floor(Date.now() / 1000), key = secret) {
    const signature = createHmac('sha256', Buffer.from(key.slice('whsec_'.length), 'base64')).update(`msg_1.${at}.${body}`).digest('base64')
    return { 'svix-id': 'msg_1', 'svix-timestamp': String(at), 'svix-signature': `v1,bogus v1,${signature}` }
  }
  const body = JSON.stringify({ type: 'user.created', object: 'event', data: { id: 'user_1', email_addresses: [{ email_address: 'new@user.example' }] } })

  it('verifies the Svix signature and emits clerk.user.created', async () => {
    expect(clerkWebhookProvider.verifySignature({ rawBody: body, headers: signed(body), secret })).toEqual({ valid: true })
    const [envelope] = await clerkWebhookProvider.parse({ rawBody: body, headers: signed(body), now: 1 })
    expect(envelope).toMatchObject({ provider: 'clerk', eventType: 'clerk.user.created', providerEventId: 'msg_1' })
    expect(clerkWebhookProvider.eventCatalog?.events.map((event) => event.id)).toContain('clerk.user.created')
  })

  it('refuses a wrong key, a tampered body and a stale delivery', () => {
    const otherKey = `whsec_${Buffer.from('another-key').toString('base64')}`
    expect(clerkWebhookProvider.verifySignature({ rawBody: body, headers: signed(body, undefined, otherKey), secret }).valid).toBe(false)
    expect(clerkWebhookProvider.verifySignature({ rawBody: `${body} `, headers: signed(body), secret }).valid).toBe(false)
    expect(clerkWebhookProvider.verifySignature({ rawBody: body, headers: signed(body, Math.floor(Date.now() / 1000) - 3600), secret }))
      .toEqual({ valid: false, reason: 'stale_svix_timestamp' })
    expect(clerkWebhookProvider.verifySignature({ rawBody: body, headers: {}, secret })).toEqual({ valid: false, reason: 'missing_svix_headers' })
  })
})
