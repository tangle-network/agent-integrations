import { describe, expect, it } from 'vitest'
import {
  InMemoryConnectionStore,
  InMemoryIntegrationGrantStore,
  InMemoryIntegrationWorkflowStore,
  IntegrationHub,
  createIntegrationRuntime,
  createIntegrationWorkflowRuntime,
  createMockIntegrationProvider,
  type IntegrationManifest,
} from '../src/index'

const owner = { type: 'user' as const, id: 'user_1' }
const app = { type: 'app' as const, id: 'github-pr-sync' }

describe('integration workflows', () => {
  it('installs non-agent trigger workflows using the same user grants', async () => {
    const connectionStore = new InMemoryConnectionStore()
    const grants = new InMemoryIntegrationGrantStore()
    const workflowStore = new InMemoryIntegrationWorkflowStore()
    const hub = new IntegrationHub({
      providers: [createMockIntegrationProvider()],
      store: connectionStore,
      capabilitySecret: 'secret',
    })
    const runtime = createIntegrationRuntime({ hub, grants })
    const workflows = createIntegrationWorkflowRuntime({
      runtime,
      hub,
      grants,
      store: workflowStore,
      now: () => new Date('2026-05-05T00:00:00.000Z'),
    })
    await hub.upsertConnection({
      id: 'conn_gmail',
      owner,
      providerId: 'mock',
      connectorId: 'gmail',
      status: 'active',
      grantedScopes: ['email.read'],
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    })

    const installed = await workflows.install({
      workflow: {
        id: 'email-to-ui-feed',
        manifest: emailTriggerManifest,
        trigger: {
          requirementId: 'gmail-trigger',
          triggerId: 'message.received',
          targetUrl: 'https://builder.example/events/email',
        },
      },
      owner,
      grantee: app,
    })

    expect(installed).toMatchObject({
      workflowId: 'email-to-ui-feed',
      manifestId: 'email-trigger-manifest',
      status: 'active',
      subscription: {
        connectionId: 'conn_gmail',
        trigger: 'message.received',
        targetUrl: 'https://builder.example/events/email',
      },
    })
    expect((await grants.listByManifest(emailTriggerManifest.id, app))[0]).toMatchObject({
      allowedTriggers: ['message.received'],
      allowedActions: [],
    })
  })

  it('dispatches normalized trigger events to installed workflows', async () => {
    const connectionStore = new InMemoryConnectionStore()
    const grants = new InMemoryIntegrationGrantStore()
    const workflowStore = new InMemoryIntegrationWorkflowStore()
    const hub = new IntegrationHub({
      providers: [createMockIntegrationProvider()],
      store: connectionStore,
      capabilitySecret: 'secret',
    })
    const runtime = createIntegrationRuntime({ hub, grants })
    const workflows = createIntegrationWorkflowRuntime({ runtime, hub, grants, store: workflowStore })
    await hub.upsertConnection({
      id: 'conn_gmail',
      owner,
      providerId: 'mock',
      connectorId: 'gmail',
      status: 'active',
      grantedScopes: ['email.read'],
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    })
    await workflows.install({
      workflow: {
        id: 'email-to-task-list',
        manifest: emailTriggerManifest,
        trigger: { requirementId: 'gmail-trigger', triggerId: 'message.received' },
      },
      owner,
      grantee: app,
    })
    const seen: string[] = []

    const result = await workflows.dispatchEvent({
      id: 'evt_1',
      providerId: 'mock',
      connectorId: 'gmail',
      connectionId: 'conn_gmail',
      trigger: 'message.received',
      occurredAt: new Date(0).toISOString(),
      payload: { subject: 'PR ready' },
    }, ({ workflows: matched }) => {
      seen.push(...matched.map((workflow) => workflow.workflowId))
    })

    expect(result.matched.map((workflow) => workflow.workflowId)).toEqual(['email-to-task-list'])
    expect(seen).toEqual(['email-to-task-list'])
  })
})

const emailTriggerManifest: IntegrationManifest = {
  id: 'email-trigger-manifest',
  requirements: [
    {
      id: 'gmail-trigger',
      connectorId: 'gmail',
      mode: 'trigger',
      reason: 'Wake a product workflow when new email arrives.',
      requiredTriggers: ['message.received'],
    },
  ],
}
