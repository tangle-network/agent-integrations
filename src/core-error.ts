/**
 * IntegrationError — the runtime error class thrown by the hub, providers,
 * adapters, and runtime helpers. Lives in its own module so any source
 * file can import it without pulling the package barrel (`./index.ts`)
 * and forming a cycle.
 *
 * The richer {@link IntegrationRuntimeError} (in `./errors.ts`) is a
 * separate, structured error type used by consumers wiring custom
 * error → HTTP-status mappings. `IntegrationError` is the legacy/canonical
 * throw shape kept for back-compat with everything that already catches it.
 */

export type IntegrationErrorRuntimeCode =
  | 'provider_not_found'
  | 'connector_not_found'
  | 'connection_not_found'
  | 'connection_not_active'
  | 'auth_not_supported'
  | 'capability_invalid'
  | 'capability_expired'
  | 'scope_denied'
  | 'action_denied'
  | 'action_not_found'
  | 'trigger_not_found'
  | 'approval_required'
  | 'policy_denied'
  | 'config_missing'
  | 'provider_failure'

export class IntegrationError extends Error {
  constructor(
    message: string,
    readonly code: IntegrationErrorRuntimeCode,
  ) {
    super(message)
    this.name = 'IntegrationError'
  }
}
