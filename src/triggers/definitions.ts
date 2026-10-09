import type { HostedTriggerDefinition, HostedTriggerPerson, HostedTriggerRead, PolledRecord } from './types.js'

/**
 * The hosted triggers, one per (connector, event), each over that connector's
 * existing READ capabilities. A definition lists candidate records created at
 * or after `since`; `pollHostedTrigger` filters, orders and caps them.
 */

const EMAIL = /^[^\s@<>()[\]\\,;:"]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i
const POLL_SECONDS = 120

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(object) : []
}

function text(value: unknown, max = 500): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null
}

/** `Ada Lovelace <ada@example.com>` and bare addresses alike. */
function email(value: unknown): string | null {
  const raw = text(value, 400)
  if (!raw) return null
  const candidate = (/<([^<>]+)>/.exec(raw)?.[1] ?? raw).trim().toLowerCase()
  return EMAIL.test(candidate) ? candidate : null
}

function displayName(value: unknown): string | null {
  const raw = text(value, 400)
  return raw && raw.includes('<') ? text(raw.slice(0, raw.indexOf('<')).replace(/^"|"$/g, '')) : null
}

/** An ISO time from epoch seconds or milliseconds, a numeric string, or a date string. */
function isoTime(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value > 1e12 ? value : value * 1000).toISOString()
  const raw = text(value, 100)
  if (!raw) return null
  if (/^\d{10,13}$/.test(raw)) {
    const n = Number(raw)
    return new Date(n > 1e12 ? n : n * 1000).toISOString()
  }
  // Pipedrive writes UTC times without a zone: `2026-10-09 10:00:00`.
  const parsed = Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw) ? `${raw.replace(' ', 'T')}Z` : raw)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

function person(input: { email?: unknown; name?: unknown; company?: unknown }): HostedTriggerPerson | null {
  const address = email(input.email)
  const name = text(input.name, 200)
  const company = text(input.company, 200)
  return address || name || company ? { email: address, name, company } : null
}

function seconds(isoValue: string): number {
  return Math.floor(Date.parse(isoValue) / 1000)
}

/** Senders that are never a person writing in. */
const AUTOMATED_SENDER = /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|notifications?|bounces?)([+.\-_][^@]*)?@/i

function mailRecord(input: { key: string; at: unknown; from: unknown; fromName?: unknown; to: unknown; subject: unknown; preview: unknown; threadId?: unknown }): PolledRecord | null {
  const occurredAt = isoTime(input.at)
  const from = email(input.from)
  if (!occurredAt || !from || AUTOMATED_SENDER.test(from)) return null
  const subject = text(input.subject, 300)
  const to = (Array.isArray(input.to) ? input.to : typeof input.to === 'string' ? input.to.split(',') : []).map(email).filter((value): value is string => Boolean(value))
  return {
    key: input.key, occurredAt,
    person: { email: from, name: text(input.fromName, 200) ?? displayName(input.from), company: null },
    summary: subject ? `Email: ${subject}` : 'Email with no subject',
    record: { messageId: input.key, threadId: text(input.threadId, 200), from, to, subject, preview: text(input.preview, 1000) },
  }
}

const gmail: HostedTriggerDefinition = {
  provider: 'gmail',
  event: 'gmail.message.received',
  description: 'A new message arrived in the inbox from someone other than the account itself.',
  intervalSeconds: POLL_SECONDS,
  reads: ['list_messages'],
  async list({ read, since }) {
    const data = object(await read('list_messages', { query: `in:inbox -from:me after:${seconds(since)}`, maxResults: 50 }))
    return list(data.messages).flatMap((message) => {
      const id = text(message.id, 200)
      const record = id ? mailRecord({ key: id, at: message.internalDate, from: message.from, to: message.to, subject: message.subject, preview: message.snippet, threadId: message.threadId }) : null
      return record ? [record] : []
    })
  },
}

const outlook: HostedTriggerDefinition = {
  provider: 'outlook-mail',
  event: 'outlook-mail.message.received',
  description: 'A new message arrived in the inbox.',
  intervalSeconds: POLL_SECONDS,
  reads: ['list_messages'],
  async list({ read }) {
    const data = object(await read('list_messages', { folder: 'inbox', top: 50 }))
    return list(data.messages).flatMap((message) => {
      const id = text(message.id, 400)
      const record = id ? mailRecord({ key: id, at: message.receivedDateTime, from: message.from, fromName: message.fromName, to: message.to, subject: message.subject, preview: message.bodyPreview, threadId: message.conversationId }) : null
      return record ? [record] : []
    })
  },
}

async function hubspotPages(read: HostedTriggerRead, capability: string, key: 'contacts' | 'deals', since: string): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = []
  let after: string | null = null
  for (let page = 0; page < 3; page++) {
    const data = object(await read(capability, { createdAfter: since, limit: 100, ...(after ? { after } : {}) }))
    rows.push(...list(data[key]))
    after = text(data.after, 200)
    if (!after) break
  }
  return rows
}

const hubspotContact: HostedTriggerDefinition = {
  provider: 'hubspot',
  event: 'hubspot.contact.created',
  description: 'A contact was created, from a form, an import or an integration.',
  intervalSeconds: POLL_SECONDS,
  reads: ['list_new_contacts'],
  async list({ read, since }) {
    return (await hubspotPages(read, 'list_new_contacts', 'contacts', since)).flatMap((contact) => {
      const id = text(contact.id, 100)
      const occurredAt = isoTime(contact.createdAt)
      if (!id || !occurredAt) return []
      return [{ key: `contact:${id}`, occurredAt, person: person({ email: contact.email, name: contact.name, company: contact.company }),
        summary: `New HubSpot contact${contact.source ? ` from ${String(contact.source).toLowerCase().replaceAll('_', ' ')}` : ''}`,
        record: { contactId: id, jobTitle: text(contact.jobTitle, 200), lifecycleStage: text(contact.lifecycleStage, 100), source: text(contact.source, 100) } }]
    })
  },
}

const hubspotDeal: HostedTriggerDefinition = {
  provider: 'hubspot',
  event: 'hubspot.deal.created',
  description: 'A deal was created.',
  intervalSeconds: POLL_SECONDS,
  reads: ['list_new_deals'],
  async list({ read, since }) {
    return (await hubspotPages(read, 'list_new_deals', 'deals', since)).flatMap((deal) => {
      const id = text(deal.id, 100)
      const occurredAt = isoTime(deal.createdAt)
      if (!id || !occurredAt) return []
      return [{ key: `deal:${id}`, occurredAt, person: null, summary: `New HubSpot deal: ${text(deal.name, 200) ?? id}`,
        record: { dealId: id, name: text(deal.name, 200), stage: text(deal.stage, 100), pipeline: text(deal.pipeline, 100), amount: deal.amount ?? null, ownerId: deal.ownerId ?? null } }]
    })
  },
}

function attioValue(values: Record<string, unknown>, slug: string, field: string): unknown {
  return object(list(values[slug])[0])[field]
}

const attioPerson: HostedTriggerDefinition = {
  provider: 'attio',
  event: 'attio.person.created',
  description: 'A person record was created.',
  intervalSeconds: POLL_SECONDS,
  reads: ['records.query'],
  async list({ read, since }) {
    const data = object(await read('records.query', { object: 'people', filter: { created_at: { $gte: since } },
      sorts: [{ attribute: 'created_at', direction: 'asc' }], limit: 100 }))
    return list(data.data).flatMap((row) => {
      const id = text(object(row.id).record_id, 100)
      const occurredAt = isoTime(row.created_at)
      if (!id || !occurredAt) return []
      const values = object(row.values)
      const name = attioValue(values, 'name', 'full_name')
      return [{ key: `person:${id}`, occurredAt,
        person: person({ email: attioValue(values, 'email_addresses', 'email_address'), name, company: null }),
        summary: `New Attio person${typeof name === 'string' ? `: ${name}` : ''}`,
        record: { recordId: id, jobTitle: text(attioValue(values, 'job_title', 'value'), 200) } }]
    })
  },
}

async function pipedriveRecent(read: HostedTriggerRead, capability: string, since: string): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = []
  const sinceMs = Date.parse(since)
  for (let start = 0; start < 300; start += 100) {
    const page = list(object(await read(capability, { sort: 'add_time DESC', start, limit: 100 })).data)
    rows.push(...page)
    const oldest = page.at(-1)
    if (page.length < 100 || !oldest || Date.parse(isoTime(oldest.add_time) ?? '') < sinceMs) break
  }
  return rows
}

function pipedriveEmail(value: unknown): unknown {
  const entries = list(value)
  return (entries.find((entry) => entry.primary === true) ?? entries[0])?.value
}

const pipedrivePerson: HostedTriggerDefinition = {
  provider: 'pipedrive',
  event: 'pipedrive.person.created',
  description: 'A person was added.',
  intervalSeconds: POLL_SECONDS,
  reads: ['persons.list'],
  async list({ read, since }) {
    return (await pipedriveRecent(read, 'persons.list', since)).flatMap((row) => {
      const id = row.id !== undefined ? String(row.id) : null
      const occurredAt = isoTime(row.add_time)
      if (!id || !occurredAt) return []
      const company = text(row.org_name, 200) ?? text(object(row.org_id).name, 200)
      return [{ key: `person:${id}`, occurredAt, person: person({ email: pipedriveEmail(row.email), name: row.name, company }),
        summary: `New Pipedrive person${row.name ? `: ${String(row.name)}` : ''}`, record: { personId: id, ownerId: object(row.owner_id).id ?? row.owner_id ?? null } }]
    })
  },
}

const pipedriveDeal: HostedTriggerDefinition = {
  provider: 'pipedrive',
  event: 'pipedrive.deal.created',
  description: 'A deal was added.',
  intervalSeconds: POLL_SECONDS,
  reads: ['deals.list'],
  async list({ read, since }) {
    return (await pipedriveRecent(read, 'deals.list', since)).flatMap((row) => {
      const id = row.id !== undefined ? String(row.id) : null
      const occurredAt = isoTime(row.add_time)
      if (!id || !occurredAt) return []
      const contact = object(row.person_id)
      return [{ key: `deal:${id}`, occurredAt,
        person: person({ email: pipedriveEmail(contact.email), name: contact.name ?? row.person_name, company: text(object(row.org_id).name, 200) ?? row.org_name }),
        summary: `New Pipedrive deal: ${text(row.title, 200) ?? id}`,
        record: { dealId: id, title: text(row.title, 200), value: row.value ?? null, currency: text(row.currency, 10), stageId: row.stage_id ?? null } }]
    })
  },
}

/** A form answer's value as text, whatever its type. */
function answerText(answer: Record<string, unknown>): string | null {
  const choice = object(answer.choice)
  const choices = object(answer.choices)
  const value = answer.email ?? answer.text ?? answer.url ?? answer.phone_number ?? answer.number ?? answer.date ?? answer.boolean
    ?? choice.label ?? (Array.isArray(choices.labels) ? choices.labels.join(', ') : undefined)
  return value === undefined || value === null ? null : String(value).slice(0, 1000)
}

/** Name, company and title from a form's answers, matched on the question titles. */
function formPerson(fields: Array<{ title: string; value: string; isEmail: boolean }>): HostedTriggerPerson | null {
  const pick = (pattern: RegExp) => fields.find((field) => pattern.test(field.title))?.value ?? null
  return person({
    email: fields.find((field) => field.isEmail)?.value ?? fields.map((field) => email(field.value)).find(Boolean),
    name: pick(/\bname\b/i), company: pick(/company|organi[sz]ation|business|team/i),
  })
}

const typeform: HostedTriggerDefinition = {
  provider: 'typeform',
  event: 'typeform.response.submitted',
  description: 'A completed response was submitted to any of the account\'s forms.',
  intervalSeconds: POLL_SECONDS,
  reads: ['forms.list', 'forms.get', 'responses.list'],
  async list({ read, since }) {
    const forms = list(object(await read('forms.list', { page_size: 20 })).items).slice(0, 10)
    const records: PolledRecord[] = []
    for (const form of forms) {
      const formId = text(form.id, 100)
      if (!formId) continue
      const responses = list(object(await read('responses.list', { form_id: formId, since, completed: true, sort: 'submitted_at,asc', page_size: 50 })).items)
      if (responses.length === 0) continue
      const definition = object(await read('forms.get', { form_id: formId }))
      const titles = new Map(list(definition.fields).map((field) => [String(field.id), text(field.title, 200) ?? String(field.ref ?? '')]))
      for (const response of responses) {
        const token = text(response.token, 200) ?? text(response.response_id, 200)
        const occurredAt = isoTime(response.submitted_at)
        if (!token || !occurredAt) continue
        const fields = list(response.answers).flatMap((answer) => {
          const value = answerText(answer)
          const field = object(answer.field)
          return value ? [{ title: titles.get(String(field.id)) ?? String(field.ref ?? 'answer'), value, isEmail: answer.type === 'email' }] : []
        })
        records.push({ key: `response:${token}`, occurredAt, person: formPerson(fields),
          summary: `Typeform response to "${text(form.title, 200) ?? formId}"`,
          record: { formId, formTitle: text(form.title, 200), responseId: token, answers: fields.map(({ title, value }) => ({ question: title, answer: value })) } })
      }
    }
    return records
  },
}

const tally: HostedTriggerDefinition = {
  provider: 'tally',
  event: 'tally.submission.created',
  description: 'A completed submission arrived on any of the account\'s forms.',
  intervalSeconds: POLL_SECONDS,
  reads: ['forms.list', 'submissions.list'],
  async list({ read, since }) {
    const forms = list(object(await read('forms.list', { limit: 20 })).items).slice(0, 10)
    const records: PolledRecord[] = []
    for (const form of forms) {
      const formId = text(form.id, 100)
      if (!formId) continue
      const data = object(await read('submissions.list', { formId, filter: 'completed', startDate: since, limit: 50 }))
      const questions = new Map(list(data.questions).map((question) => [String(question.id), { title: text(question.title, 200) ?? 'answer', type: String(question.type ?? '') }]))
      for (const submission of list(data.submissions)) {
        const id = text(submission.id, 100)
        const occurredAt = isoTime(submission.submittedAt ?? submission.createdAt)
        if (!id || !occurredAt) continue
        const fields = list(submission.responses).flatMap((response) => {
          const question = questions.get(String(response.questionId))
          const raw = response.value ?? response.answer
          const value = raw === undefined || raw === null ? null : (Array.isArray(raw) ? raw.join(', ') : typeof raw === 'object' ? JSON.stringify(raw) : String(raw)).slice(0, 1000)
          return value ? [{ title: question?.title ?? 'answer', value, isEmail: question?.type === 'INPUT_EMAIL' }] : []
        })
        records.push({ key: `submission:${id}`, occurredAt, person: formPerson(fields),
          summary: `Tally submission to "${text(form.name, 200) ?? formId}"`,
          record: { formId, formName: text(form.name, 200), submissionId: id, answers: fields.map(({ title, value }) => ({ question: title, answer: value })) } })
      }
    }
    return records
  },
}

const webflow: HostedTriggerDefinition = {
  provider: 'webflow',
  event: 'webflow.form.submitted',
  description: 'A form on any of the account\'s sites was submitted.',
  intervalSeconds: POLL_SECONDS,
  reads: ['sites.list', 'forms.list', 'forms.submissions'],
  async list({ read }) {
    const sites = list(object(await read('sites.list', {})).sites).slice(0, 5)
    const records: PolledRecord[] = []
    for (const site of sites) {
      const siteId = text(site.id, 100)
      if (!siteId) continue
      const forms = list(object(await read('forms.list', { siteId, limit: 20 })).forms).slice(0, 10)
      for (const form of forms) {
        const formId = text(form.id, 100)
        if (!formId) continue
        const submissions: Record<string, unknown>[] = []
        for (let offset = 0; offset < 1000; offset += 100) {
          const page = list(object(await read('forms.submissions', { formId, offset, limit: 100 })).formSubmissions)
          submissions.push(...page)
          if (page.length < 100) break
        }
        for (const submission of submissions) {
          const id = text(submission.id, 100)
          const occurredAt = isoTime(submission.dateSubmitted)
          if (!id || !occurredAt) continue
          const fields = Object.entries(object(submission.formResponse)).flatMap(([title, value]) =>
            value === null || value === undefined || value === '' ? [] : [{ title, value: String(value).slice(0, 1000), isEmail: /e-?mail/i.test(title) }])
          records.push({ key: `submission:${id}`, occurredAt, person: formPerson(fields),
            summary: `Webflow form "${text(form.displayName, 200) ?? formId}" submitted on ${text(site.displayName, 200) ?? siteId}`,
            record: { siteId, formId, submissionId: id, answers: fields.map(({ title, value }) => ({ question: title, answer: value })) } })
        }
      }
    }
    return records
  },
}

const calendly: HostedTriggerDefinition = {
  provider: 'calendly',
  event: 'calendly.invitee.created',
  description: 'Someone booked a meeting.',
  intervalSeconds: POLL_SECONDS,
  reads: ['user.get-current', 'scheduled-events.list', 'scheduled-events.list-invitees'],
  async list({ read, since }) {
    const me = object(await read('user.get-current', {}))
    const user = text(object(me.resource).uri, 300) ?? text(me.uri, 300)
    if (!user) throw new Error('calendly.invitee.created: Calendly returned no current user')
    // A meeting starts at or after it is booked, so bookings made since `since` start after it too.
    const events = list(object(await read('scheduled-events.list', { user, status: 'active', min_start_time: since, count: 100 })).collection)
    const records: PolledRecord[] = []
    const sinceMs = Date.parse(since)
    for (const event of events) {
      const uri = text(event.uri, 300)
      const created = isoTime(event.created_at)
      if (!uri || !created || Date.parse(created) < sinceMs) continue
      const uuid = uri.split('/').pop()!
      for (const invitee of list(object(await read('scheduled-events.list-invitees', { uuid, count: 25 })).collection)) {
        const occurredAt = isoTime(invitee.created_at) ?? created
        const answers = list(invitee.questions_and_answers).map((qa) => ({ question: text(qa.question, 200) ?? '', answer: text(qa.answer, 1000) ?? '' }))
        const inviteeKey = text(invitee.uri, 300) ?? `${uuid}:${email(invitee.email) ?? ''}`
        records.push({ key: `invitee:${inviteeKey}`, occurredAt,
          person: person({ email: invitee.email, name: invitee.name, company: answers.find((qa) => /company|organi[sz]ation/i.test(qa.question))?.answer }),
          summary: `Booked "${text(event.name, 200) ?? 'a meeting'}" for ${text(event.start_time, 40) ?? 'a future time'}`,
          record: { eventUri: uri, start: text(event.start_time, 40), end: text(event.end_time, 40), answers } })
      }
    }
    return records
  },
}

const calCom: HostedTriggerDefinition = {
  provider: 'cal-com',
  event: 'cal-com.booking.created',
  description: 'Someone booked a meeting.',
  intervalSeconds: POLL_SECONDS,
  reads: ['bookings.list'],
  async list({ read }) {
    const bookings: Record<string, unknown>[] = []
    let cursor: string | null = null
    for (let page = 0; page < 3; page++) {
      const data = object(await read('bookings.list', { status: 'upcoming', limit: 100, ...(cursor ? { cursor } : {}) }))
      bookings.push(...list(Array.isArray(data.data) ? data.data : object(data.data).bookings ?? data.bookings))
      cursor = text(object(data.pagination).nextCursor, 500)
      if (!cursor) break
    }
    return bookings.flatMap((booking) => {
      const uid = text(booking.uid, 200) ?? (booking.id !== undefined ? String(booking.id) : null)
      const occurredAt = isoTime(booking.createdAt)
      if (!uid || !occurredAt) return []
      const attendee = list(booking.attendees)[0] ?? {}
      return [{ key: `booking:${uid}`, occurredAt, person: person({ email: attendee.email, name: attendee.name, company: null }),
        summary: `Booked "${text(booking.title, 200) ?? 'a meeting'}" for ${text(booking.start ?? booking.startTime, 40) ?? 'a future time'}`,
        record: { bookingUid: uid, start: text(booking.start ?? booking.startTime, 40), end: text(booking.end ?? booking.endTime, 40),
          description: text(booking.description, 2000), eventTypeId: booking.eventTypeId ?? object(booking.eventType).id ?? null } }]
    })
  },
}

const intercom: HostedTriggerDefinition = {
  provider: 'intercom',
  event: 'intercom.conversation.created',
  description: 'A customer or lead started a new conversation.',
  intervalSeconds: POLL_SECONDS,
  reads: ['tickets.search'],
  async list({ read, since }) {
    const data = object(await read('tickets.search', { body: {
      query: { field: 'created_at', operator: '>', value: seconds(since) - 1 },
      pagination: { per_page: 50 },
    } }))
    return list(data.conversations).flatMap((conversation) => {
      const id = text(conversation.id, 100)
      const occurredAt = isoTime(conversation.created_at)
      if (!id || !occurredAt) return []
      const source = object(conversation.source)
      const author = object(source.author)
      if (author.type === 'admin' || author.type === 'bot') return []
      const body = text(String(source.body ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '), 2000)
      return [{ key: `conversation:${id}`, occurredAt, person: person({ email: author.email, name: author.name, company: null }),
        summary: `New Intercom conversation${text(source.subject, 200) ? `: ${text(source.subject, 200)}` : ''}`,
        record: { conversationId: id, subject: text(source.subject, 300), body, deliveredAs: text(source.delivered_as, 50) } }]
    })
  },
}

export const HOSTED_TRIGGER_DEFINITIONS: readonly HostedTriggerDefinition[] = [
  gmail, outlook, hubspotContact, hubspotDeal, attioPerson, pipedrivePerson, pipedriveDeal,
  typeform, tally, webflow, calendly, calCom, intercom,
]
