/**
 * Per-kind overrides on top of family defaults.
 *
 * The family layer (`families.ts`) carries the auth-shape defaults — generic
 * "API Key" or "Client ID + Client Secret" credential fields, generic console
 * steps. Most kinds are happy with that. But some have provider-specific
 * shape that the family can't capture: Twilio's auth is two-part (Account
 * SID + Auth Token); Stripe's preferred path is restricted keys with specific
 * granted permissions; SendGrid demands a verified sender domain in the
 * console before keys work.
 *
 * `INTEGRATION_OVERRIDES` is the seam for that. The registry merges the
 * override on top of the family defaults at spec-build time. Override
 * fields are purely additive — set what you want to customize, leave the
 * rest absent and the family defaults apply.
 *
 * Adding a new override:
 *   1. Author the override entry below.
 *   2. The next spec build picks it up automatically; no other registry
 *      change needed. Coverage catalog stays compact.
 *
 * Why a separate map and not inline on `IntegrationCoverageSpec`: the
 * coverage catalog is a flat tuple list optimized for fast iteration over
 * 142 specs. Bloating the tuple with optional override fields hurts
 * readability of the catalog AND scatters provider knowledge across two
 * data shapes. Keeping overrides in their own keyed map means contributors
 * looking for "how does Stripe credential setup work" find it in one place.
 */

import type {
  ConsoleStep,
  CredentialFieldSpec,
  HealthcheckSpec,
  PostSetupCheck,
  Quirk,
} from './types.js'

export interface IntegrationOverride {
  /** Replaces `setup.consoleUrl` from the family default. */
  consoleUrl?: string
  /** Replaces `setup.consoleSteps`. Specify the full list — overrides do
   *  not deep-merge step arrays because step ordering is meaningful. */
  consoleSteps?: ConsoleStep[]
  /** Replaces `setup.credentialFields`. Use to add a second field (e.g.
   *  Twilio Account SID + Auth Token), tighten validation regex, or
   *  enrich field descriptions with provider-specific guidance. */
  credentialFields?: CredentialFieldSpec[]
  /** Appended to `setup.knownQuirks`. */
  knownQuirks?: Quirk[]
  /** Replaces `setup.postSetup`. */
  postSetup?: PostSetupCheck[]
  /** Replaces the healthcheck the registry would otherwise infer. */
  healthcheck?: HealthcheckSpec
}

export const INTEGRATION_OVERRIDES: Record<string, IntegrationOverride> = {
  // ── Stripe pack ────────────────────────────────────────────────────
  // Stripe issues two key types: secret keys (sk_*) and restricted keys
  // (rk_*). For voice-agent workloads, restricted keys are the right call
  // — least-privilege scoped to the specific resources the agent can
  // touch. The hint nudges operators toward that path.
  'stripe-pack': {
    consoleUrl: 'https://dashboard.stripe.com/apikeys',
    credentialFields: [
      {
        label: 'Stripe secret key',
        description:
          'Restricted key recommended. Dashboard → Developers → API keys → Create restricted key. ' +
          'Grant write access on Customers, Invoices, and Checkout Sessions.',
        example: 'sk_live_… or rk_live_… (use sk_test_… / rk_test_… for staging)',
        regex: '^(sk|rk)_(live|test)_[A-Za-z0-9]+$',
        secret: true,
      },
    ],
    consoleSteps: [
      {
        id: 'open-keys',
        title: 'Open Stripe API keys',
        detail: 'Visit https://dashboard.stripe.com/apikeys',
        copyValue: 'https://dashboard.stripe.com/apikeys',
      },
      {
        id: 'create-restricted',
        title: 'Create a restricted key',
        detail:
          'Click "Create restricted key". Name it something descriptive ' +
          '(e.g. "ph0ny voice agent — prod"). Grant WRITE on Customers, ' +
          'Invoices, and Checkout Sessions. Leave everything else NONE.',
      },
      {
        id: 'paste',
        title: 'Paste the key',
        detail:
          'Copy the key Stripe shows once (rk_live_… or sk_live_…). ' +
          'Paste it into ph0ny. The key is sealed before persistence.',
      },
    ],
  },

  // ── Twilio SMS ─────────────────────────────────────────────────────
  // Twilio's REST API uses Basic auth with two parts: Account SID
  // (public-ish, AC…) + Auth Token (secret). The default api-key family
  // only exposes one field, which doesn't fit. Providing both fields
  // explicitly lets the consumer's UI render two inputs.
  'twilio-sms': {
    consoleUrl: 'https://console.twilio.com/',
    credentialFields: [
      {
        label: 'Account SID',
        description: 'Your Twilio Account SID. Console → Account → API keys & tokens.',
        example: 'AC… (34 hex chars)',
        regex: '^AC[a-f0-9]{32}$',
        secret: false,
      },
      {
        label: 'Auth Token',
        description:
          'Your Twilio Auth Token (or Standard API Key secret). ' +
          'Use a non-primary auth token in production so rotating it ' +
          "won't break other Twilio integrations.",
        secret: true,
      },
    ],
    consoleSteps: [
      {
        id: 'open',
        title: 'Open Twilio console',
        detail: 'Visit https://console.twilio.com/',
        copyValue: 'https://console.twilio.com/',
      },
      {
        id: 'find',
        title: 'Find your Account SID + Auth Token',
        detail:
          'Account info is on the dashboard home. For better security, ' +
          'create a Standard API Key (Account → API keys & tokens → Create ' +
          'API Key) and use the SID + Secret pair instead of the primary ' +
          'auth token.',
      },
      {
        id: 'paste',
        title: 'Paste both values',
        detail: 'Account SID is non-secret; Auth Token is sealed before persistence.',
      },
    ],
    knownQuirks: [
      {
        id: 'subaccount-tokens',
        severity: 'info',
        message:
          'If you use Twilio subaccounts, paste the SID/Token of the ' +
          'subaccount that owns the phone numbers your agent calls — not ' +
          'the master account.',
      },
    ],
  },
}

/** Public read — undefined when no override exists for the kind. */
export function getIntegrationOverride(kind: string): IntegrationOverride | undefined {
  return INTEGRATION_OVERRIDES[kind]
}
