import { type InkboxIdentity, type InkboxNumber, InkboxProvisioner, MessagingProvisionError, type ManagedMessageTransport } from './inkbox.js'

export type NumberPhase = 'identity' | 'number' | 'credential' | 'connection' | 'complete'
export interface ManagedNumberOrder {
  id: string
  ownerId: string
  /** Unique to this order. After an attempt, an existing identity with this handle is adopted as the receipt. */
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
  // Set only when a provider mutation itself is definitively refused. A read
  // failing after a successful mutation must never re-open the purchase.
  let mutationRefused = false
  if (order.phase === 'complete' || order.status === 'cancelled') return order
  const now = (ports.now ?? Date.now)()
  if (order.nextAttemptAt && order.nextAttemptAt > now) return order
  async function save(patch: Partial<ManagedNumberOrder>): Promise<ManagedNumberOrder> {
    const before = order!
    const next = { ...before, ...patch, version: before.version + 1 }
    if (await ports.orders.saveIfVersion(next, before.version)) { order = next; return next }
    return recordReceipt(patch)
  }
  /**
   * The order changed underneath this tick, usually a cancellation racing a
   * provider call. Drop the patch, but keep any provider receipt it carried:
   * a purchased number no order records cannot be released by cleanup.
   */
  async function recordReceipt(patch: Partial<ManagedNumberOrder>): Promise<ManagedNumberOrder> {
    const receipt: Partial<ManagedNumberOrder> = {
      ...(patch.identityId ? { identityId: patch.identityId } : {}),
      ...(patch.number ? { number: patch.number } : {}),
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await ports.orders.get(orderId)
      if (!current) throw new Error('Managed number order disappeared')
      const missing = (receipt.identityId && !current.identityId) || (receipt.number && !current.number)
      if (!missing) return current
      const merged = {
        ...current,
        ...(current.identityId ? {} : { identityId: receipt.identityId }),
        ...(current.number ? {} : { number: receipt.number }),
        version: current.version + 1,
      }
      if (await ports.orders.saveIfVersion(merged, current.version)) return merged
    }
    throw new MessagingProvisionError('outcome_unknown')
  }
  async function mutate<T>(call: () => Promise<T>): Promise<T> {
    try { return await call() }
    catch (error) {
      if (error instanceof MessagingProvisionError && error.code === 'provider_rejected') mutationRefused = true
      throw error
    }
  }
  /** Journal the attempt, then recheck authority. Release the journal if no provider call follows. */
  async function claim(): Promise<boolean> {
    const before = order!
    const claimed = await save({ attempted: true, status: 'pending', errorCode: undefined, nextAttemptAt: undefined })
    if (claimed.version !== before.version + 1 || order !== claimed) return false
    let authorized = false
    try { authorized = await authorize() }
    finally {
      if (!authorized) await releaseClaim()
    }
    return authorized
  }
  async function releaseClaim(): Promise<void> {
    const current = await ports.orders.get(orderId)
    if (!current || !current.attempted || current.status === 'cancelled') return
    if (await ports.orders.saveIfVersion({ ...current, attempted: false, version: current.version + 1 }, current.version)) {
      order = { ...current, attempted: false, version: current.version + 1 }
    }
  }
  async function authorize(): Promise<boolean> {
    const current = await ports.orders.get(orderId)
    if (!current || current.version !== order!.version || current.status === 'cancelled') return false
    // Back off: an order that cannot be funded or activated must not stay due
    // and crowd other orders out of the host's bounded reconcile sweep.
    if (!await ports.canProvision(current)) { await save({ status: 'provider_pending', errorCode: 'activation_not_configured', nextAttemptAt: now + 60_000 }); return false }
    if (!await ports.authorizeFunding(current)) { await save({ status: 'provider_pending', errorCode: 'funding_required', nextAttemptAt: now + 60_000 }); return false }
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
        if (!await claim()) return (await ports.orders.get(orderId))!
        const handle = order.handle
        identity = await mutate(() => ports.provider.createIdentity(handle))
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
      // A recorded number is an ownership receipt. Its absence now is a provider
      // change to review, never a reason to buy another line.
      if (!number && order.number) return save({ status: 'needs_review', errorCode: 'number_missing' })
      if (!number) {
        // An accepted iMessage claim enables the identity before the provider attaches a line.
        if (order.attempted && order.transport === 'imessage' && identity.imessageEnabled) {
          return save({ status: 'provider_pending', errorCode: 'number_pending', nextAttemptAt: now + 30_000 })
        }
        if (order.attempted) return save({ status: 'needs_review', errorCode: 'number_outcome_unknown' })
        if (!await claim()) return (await ports.orders.get(orderId))!
        const { handle, state, id } = order
        if (order.transport === 'sms') {
          const purchased = await mutate(() => ports.provider.provisionSms(handle, `${id}:sms`, state))
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
          const receipt = await mutate(() => ports.provider.claimIMessage(handle, `${id}:imessage`))
          identityMatches(order, receipt); number = selectedNumber(order, receipt)
        }
      }
      if (!number) return save({ status: 'provider_pending', errorCode: 'number_pending', nextAttemptAt: now + 30_000 })
      if (order.number && (order.number.id !== number.id || order.number.number !== number.number)) throw new MessagingProvisionError('invalid_receipt')
      if (order.transport === 'sms' && (number.smsStatus !== 'ready' || number.status !== 'active')) {
        // The purchase has completed with an ownership receipt; nothing is in flight while SMS readiness settles.
        return save({ number, attempted: false, status: 'provider_pending', nextAttemptAt: now + 30_000, errorCode: 'sms_not_ready' })
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
        if (!await claim()) return (await ports.orders.get(orderId))!
        const { identityId, id } = order
        const minted = await mutate(() => ports.provider.mintIdentityKey(identityId!, `Tangle number ${id}`))
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
    const refused = mutationRefused && order.phase !== 'credential'
    return save({ status: code === 'invalid_receipt' ? 'needs_review' : 'provider_pending', errorCode: code,
      ...(refused ? { attempted: false } : {}),
      nextAttemptAt: now + Math.max(30, Math.min(retryAfter ?? 30, 86_400)) * 1000 })
  }
}
