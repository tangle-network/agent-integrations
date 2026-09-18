import { type InkboxIdentity, type InkboxNumber, InkboxProvisioner, MessagingProvisionError, type ManagedMessageTransport } from './inkbox.js'

export type NumberPhase = 'identity' | 'number' | 'credential' | 'connection' | 'complete'
export interface ManagedNumberOrder {
  id: string
  ownerId: string
  handle: string
  organizationId: string
  transport: ManagedMessageTransport
  state?: string
  /** Immutable, server-created ledger authorization; never accept a browser-supplied paid flag. */
  fundingAuthorizationId: string
  version: number
  phase: NumberPhase
  attempted: boolean
  identityId?: string
  number?: InkboxNumber
  connectionId?: string
  status: 'pending' | 'provider_pending' | 'needs_review' | 'ready_for_setup' | 'cancelled'
  errorCode?: string
  nextAttemptAt?: number
}
export interface ManagedNumberOrderStore {
  get(id: string): Promise<ManagedNumberOrder | null>
  /** One atomic version check; preserve all rows across host/worker restarts. */
  saveIfVersion(order: ManagedNumberOrder, expectedVersion: number): Promise<boolean>
}
export interface ManagedNumberPorts {
  orders: ManagedNumberOrderStore
  provider: Pick<InkboxProvisioner, 'getIdentity' | 'createIdentity' | 'claimIMessage' | 'provisionSms' | 'mintIdentityKey' | 'verifyIdentityKey'>
  /** Validate/capture through the platform ledger with this order's stable reference. Must be idempotent. */
  authorizeFunding(order: Readonly<ManagedNumberOrder>): Promise<boolean>
  /** Re-read configuration and commercial permission before every mutation, including resumed work. */
  canProvision(order: Readonly<ManagedNumberOrder>): Promise<boolean>
  vault: {
    read(orderId: string): Promise<{ key: string; keyId: string; identityId: string } | null>
    /** Encrypt once under the order and identity; reject an existing, different credential. */
    putIfAbsent(orderId: string, value: { key: string; keyId: string; identityId: string }): Promise<void>
  }
  /** Create/recover exactly this order's owner-scoped Hub connection using the vault reference. Never return its key. */
  bindConnection(order: Readonly<ManagedNumberOrder>): Promise<string>
  now?: () => number
}

function identityMatches(order: ManagedNumberOrder, identity: InkboxIdentity): void {
  if (identity.handle !== order.handle || identity.organizationId !== order.organizationId || identity.status !== 'active' ||
    (order.identityId && identity.id !== order.identityId)) throw new MessagingProvisionError('invalid_receipt')
}
function selectedNumber(order: ManagedNumberOrder, identity: InkboxIdentity): InkboxNumber | null {
  return order.transport === 'sms' ? identity.sms : identity.imessageEnabled ? identity.imessage : null
}

/** One recoverable provisioning step, called by the host's EXISTING queue.
 * No agent loop, background worker, payment ledger or credential store lives here.
 * A journaled non-idempotent call is reconciled by reading provider state, never blindly repeated. */
export async function advanceManagedNumber(orderId: string, ports: ManagedNumberPorts): Promise<ManagedNumberOrder> {
  let order = await ports.orders.get(orderId)
  if (!order) throw new Error('Managed number order not found')
  if (!order.id || order.id.length > 128 || !/^[a-zA-Z0-9:._-]+$/.test(order.id) || order.id !== orderId ||
      !order.ownerId || !order.organizationId || !order.fundingAuthorizationId ||
      !['sms', 'imessage'].includes(order.transport) || !['identity', 'number', 'credential', 'connection', 'complete'].includes(order.phase) ||
      !Number.isSafeInteger(order.version) || order.version < 0) throw new MessagingProvisionError('invalid_input')
  let mutationInThisTick = false
  if (order.phase === 'complete' || order.status === 'cancelled') return order
  const now = (ports.now ?? Date.now)()
  if (order.nextAttemptAt && order.nextAttemptAt > now) return order
  async function save(patch: Partial<ManagedNumberOrder>): Promise<ManagedNumberOrder> {
    const before = order!
    const next = { ...before, ...patch, version: before.version + 1 }
    if (await ports.orders.saveIfVersion(next, before.version)) { order = next; return next }
    const current = await ports.orders.get(orderId)
    if (!current) throw new Error('Managed number order disappeared')
    return current
  }
  async function claim(): Promise<boolean> {
    const before = order!
    const claimed = await save({ attempted: true, status: 'pending', errorCode: undefined, nextAttemptAt: undefined })
    return claimed.version === before.version + 1 && order === claimed
  }
  async function authorize(): Promise<boolean> {
    const current = await ports.orders.get(orderId)
    if (!current || current.version !== order!.version || current.status === 'cancelled') return false
    if (!await ports.canProvision(current)) { await save({ status: 'provider_pending', errorCode: 'activation_not_configured' }); return false }
    if (!await ports.authorizeFunding(current)) { await save({ status: 'provider_pending', errorCode: 'funding_required' }); return false }
    // The checks above may wait on remote services. Do not act on a stale cancellation snapshot.
    const rechecked = await ports.orders.get(orderId)
    return rechecked?.version === order!.version && rechecked.status !== 'cancelled'
  }
  try {
    if (!await authorize()) return (await ports.orders.get(orderId))!
    if (order.phase === 'identity') {
      let identity = await ports.provider.getIdentity(order.handle)
      if (!identity) {
        if (order.attempted) return save({ status: 'needs_review', errorCode: 'identity_outcome_unknown' })
        if (!await claim() || !await authorize()) return (await ports.orders.get(orderId))!
        mutationInThisTick = true
        identity = await ports.provider.createIdentity(order.handle)
      } else if (!order.attempted && !order.identityId) {
        // A pre-existing handle is not evidence this order created the identity.
        return save({ status: 'needs_review', errorCode: 'identity_already_exists' })
      }
      identityMatches(order, identity)
      return save({ identityId: identity.id, phase: 'number', attempted: false, status: 'pending', errorCode: undefined })
    }
    if (!order.identityId) throw new MessagingProvisionError('invalid_receipt')
    const identity = await ports.provider.getIdentity(order.handle)
    if (!identity) return save({ status: 'needs_review', errorCode: 'identity_missing' })
    identityMatches(order, identity)
    if (order.phase === 'number') {
      let number = selectedNumber(order, identity)
      if (!number) {
        if (order.attempted) return save({ status: 'needs_review', errorCode: 'number_outcome_unknown' })
        if (!await claim() || !await authorize()) return (await ports.orders.get(orderId))!
        mutationInThisTick = true
        if (order.transport === 'sms') {
          const purchased = await ports.provider.provisionSms(order.handle, order.state)
          // A purchase response alone is not an ownership receipt. Read the
          // exact identity before the host can treat this number as billable.
          const receipt = await ports.provider.getIdentity(order.handle)
          if (!receipt) throw new MessagingProvisionError('invalid_receipt')
          identityMatches(order, receipt)
          number = selectedNumber(order, receipt)
          if (!number || purchased.id !== number.id || purchased.number !== number.number) {
            throw new MessagingProvisionError('invalid_receipt')
          }
        }
        else {
          const receipt = await ports.provider.claimIMessage(order.handle, `${order.id}:imessage`)
          identityMatches(order, receipt); number = selectedNumber(order, receipt)
        }
      }
      if (!number) return save({ status: 'provider_pending', errorCode: 'number_pending' })
      if (order.number && (order.number.id !== number.id || order.number.number !== number.number)) throw new MessagingProvisionError('invalid_receipt')
      if (order.transport === 'sms' && (number.smsStatus !== 'ready' || number.status !== 'active')) {
        return save({ number, status: 'provider_pending', nextAttemptAt: now + 30_000, errorCode: 'sms_not_ready' })
      }
      return save({ number, phase: 'credential', attempted: false, status: 'pending', errorCode: undefined, nextAttemptAt: undefined })
    }
    const number = selectedNumber(order, identity)
    if (!number || number.id !== order.number?.id || number.number !== order.number.number ||
        (order.transport === 'sms' && (number.smsStatus !== 'ready' || number.status !== 'active'))) throw new MessagingProvisionError('invalid_receipt')
    if (order.phase === 'credential') {
      let credential = await ports.vault.read(order.id)
      if (!credential) {
        if (order.attempted) return save({ status: 'needs_review', errorCode: 'credential_receipt_lost' })
        if (!await claim() || !await authorize()) return (await ports.orders.get(orderId))!
        mutationInThisTick = true
        const minted = await ports.provider.mintIdentityKey(order.identityId, `Tangle number ${order.id}`)
        credential = { ...minted, identityId: order.identityId }
        // No fallible provider read between receiving the secret and durable encryption.
        await ports.vault.putIfAbsent(order.id, credential)
      }
      if (credential.identityId !== order.identityId) throw new MessagingProvisionError('invalid_receipt')
      await ports.provider.verifyIdentityKey(credential.key, order.identityId, credential.keyId)
      return save({ phase: 'connection', attempted: false, status: 'pending', errorCode: undefined })
    }
    const credential = await ports.vault.read(order.id)
    if (!credential || credential.identityId !== order.identityId) throw new MessagingProvisionError('invalid_receipt')
    if (!await authorize()) return (await ports.orders.get(orderId))!
    const connectionId = await ports.bindConnection(order)
    if (!connectionId || connectionId.length > 256) throw new MessagingProvisionError('invalid_receipt')
    return save({ connectionId, phase: 'complete', status: 'ready_for_setup', attempted: false, errorCode: undefined })
  } catch (error) {
    const code = error instanceof MessagingProvisionError ? error.code : 'outcome_unknown'
    const retryAfter = error instanceof MessagingProvisionError ? error.retryAfterSeconds : undefined
    // A definitive 4xx refusal permits another attempt after account setup. An unknown outcome does not.
    const refused = mutationInThisTick && error instanceof MessagingProvisionError && error.code === 'provider_rejected' && order.phase !== 'credential'
    return save({ status: code === 'invalid_receipt' ? 'needs_review' : 'provider_pending', errorCode: code,
      ...(refused ? { attempted: false } : {}),
      nextAttemptAt: now + Math.max(30, Math.min(retryAfter ?? 30, 86_400)) * 1000 })
  }
}
