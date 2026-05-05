import { StaticIntegrationPolicyEngine, type StaticIntegrationPolicyOptions } from './policy.js'

export interface PlatformIntegrationPolicyPresetOptions extends Omit<StaticIntegrationPolicyOptions, 'defaultReadEffect' | 'defaultWriteEffect' | 'defaultDestructiveEffect'> {
  allowWritesWithoutApproval?: boolean
  allowDestructiveActions?: boolean
  allowProviderPassthrough?: boolean
}

export function createPlatformIntegrationPolicyPreset(options: PlatformIntegrationPolicyPresetOptions = {}): StaticIntegrationPolicyEngine {
  return new StaticIntegrationPolicyEngine({
    ...options,
    defaultReadEffect: 'allow',
    defaultWriteEffect: options.allowWritesWithoutApproval ? 'allow' : 'require_approval',
    defaultDestructiveEffect: options.allowDestructiveActions ? 'require_approval' : 'deny',
    rules: [
      ...(options.allowProviderPassthrough ? [] : [{
        id: 'deny-provider-native-passthrough',
        action: 'provider.http.request',
        effect: 'deny' as const,
        reason: 'Provider-native passthrough is disabled by default. Promote the connector action or enable passthrough explicitly.',
      }]),
      ...(options.rules ?? []),
    ],
  })
}
