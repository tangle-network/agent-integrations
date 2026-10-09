import { createHmac } from 'node:crypto'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { createWhatsappWebhookProvider } from '../src/webhooks/whatsapp.js'
import { normalizeConversationEvent, buildMessagingReply, conversationEndpointOptions } from '../src/conversation-events/index.js'
import { whatsappConnector } from '../src/connectors/adapters/whatsapp.js'
import { whatsappBusiness } from '../src/connectors/adapters/whatsapp-business.js'

const provider = createWhatsappWebhookProvider({ providerId: 'whatsapp', wabaId: '10001', phoneNumberId: '20001' })
const message = { id: 'wamid.incoming', from: '14155550123', timestamp: '1791493200', type: 'text', text: { body: 'Hello' } }
const payload = (m: unknown = message, waba = '10001', phone = '20001') => ({ object: 'whatsapp_business_account', entry: [{ id: waba, changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: phone }, messages: [m] } }] }] })
const inbound = (m: unknown = message) => ({ provider: 'whatsapp', type: 'whatsapp.message.received', payload: { wabaId: '10001', phoneNumberId: '20001', message: m } })
describe('Meta signed incoming message to bound reply', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('authenticates exact raw body and pins account/number before deriving a reply', async () => {
    const rawBody = JSON.stringify(payload())
    const signature = 'sha256=' + createHmac('sha256', 'test-app-secret').update(rawBody).digest('hex')
    expect(provider.verifySignature({ rawBody, headers: { 'x-hub-signature-256': signature }, secret: 'test-app-secret' })).toEqual({ valid: true })
    expect(provider.verifySignature({ rawBody: rawBody+' ', headers: { 'x-hub-signature-256': signature }, secret: 'test-app-secret' }).valid).toBe(false)
    expect(provider.verifySignature({ rawBody, headers: { 'x-hub-signature-256': signature }, secret: 'wrong-secret' }).valid).toBe(false)
    const [event] = await provider.parse({ rawBody, headers: {} })
    expect(event!.providerEventId).toBe('20001:wamid.incoming')
    const reply = buildMessagingReply({ provider: event!.provider, type: event!.eventType, payload: event!.payload }, 'Reply', 'stable-reply')
    expect(reply).toEqual({ ok: true, reply: { action: 'whatsapp.messages.reply', idempotencyKey: 'stable-reply', input: { phoneNumberId: '20001', to: '14155550123', text: 'Reply', replyToMessageId: 'wamid.incoming' } } })
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => Response.json({ messages: [{ id: 'wamid.outgoing' }] }))
    vi.stubGlobal('fetch', fetchMock)
    if (!reply.ok) throw new Error('Expected reply')
    const result = await whatsappConnector.executeMutation!({ source: { id:'s',projectId:'p',publishedAgentId:null,kind:'whatsapp',label:'QA',consistencyModel:'advisory',scopes:[],metadata:{},credentials:{kind:'api-key',apiKey:'test-token'},status:'active' }, capabilityName:'messages.reply',args:reply.reply.input,idempotencyKey:reply.reply.idempotencyKey })
    expect(result.status).toBe('committed')
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://graph.facebook.com/v21.0/20001/messages')
  })
  it.each([['10002','20001'],['10001','20002']])('does not route another account or number (%s/%s)', async (waba, phone) => {
    expect(await provider.parse({ rawBody: JSON.stringify(payload(message,waba,phone)), headers:{} })).toEqual([])
  })
  it('does not turn status callbacks into commands', async () => {
    const p=payload(); const v=p.entry[0]!.changes[0]!.value as Record<string,unknown>; delete v.messages; v.statuses=[{id:'wamid.outgoing',status:'delivered'}]
    expect(await provider.parse({rawBody:JSON.stringify(p),headers:{}})).toEqual([])
  })
  it('rejects group impersonation, oversized input and missing identity', () => {
    for(const m of [{...message,group_id:'g'},{...message,from:'group@g.us'},{...message,id:''},{...message,text:{body:'x'.repeat(4097)}}]) expect(normalizeConversationEvent(inbound(m)).ok).toBe(false)
  })
  it('retains media identity without fetching URLs or treating captions as complete input', () => {
    const event=normalizeConversationEvent(inbound({...message,type:'image',image:{id:'media-1',mime_type:'image/png',caption:'Look'}}))
    expect(event.ok).toBe(true)
    if(event.ok) expect(event.event.attachments).toEqual([{id:'media-1',name:null,contentType:'image/png',size:null,url:null,contentBase64:null}])
  })
  it('rejects ambiguous or incomplete owned inventory', () => {
    const row={id:'20001',display_phone_number:'+1 415 555 0123'}
    expect(conversationEndpointOptions('whatsapp',{data:[row]})[0]?.id).toBe('20001')
    expect(()=>conversationEndpointOptions('whatsapp',{data:[row,row]})).toThrow()
    expect(()=>conversationEndpointOptions('whatsapp',{data:[row],paging:{next:'https://graph.facebook.com/next'}})).toThrow()
  })
  it('declares no provider idempotency for API-key and OAuth replies', () => {
    for(const adapter of [whatsappConnector,whatsappBusiness({clientId:'test',clientSecret:'test'})]) {
      expect(adapter.manifest.capabilities.find(c=>c.name==='messages.reply')).toMatchObject({cas:'none'})
    }
  })
})
