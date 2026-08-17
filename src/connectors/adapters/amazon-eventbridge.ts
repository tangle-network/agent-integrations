import { declarativeRestConnector } from './declarative-rest.js'

// EventBridge uses the AWS JSON 1.1 protocol: every operation is a signed POST
// to the regional service root and X-Amz-Target selects the action. Keep every
// request body explicitly mapped so callers cannot pass undeclared AWS fields.
export const amazonEventBridgeConnector = declarativeRestConnector({
  kind: 'amazon-eventbridge',
  displayName: 'Amazon EventBridge',
  description:
    'Publish events and manage Amazon EventBridge event buses, rules, and rule targets.',
  auth: {
    kind: 'api-key',
    hint: 'AWS credentials as JSON: {"accessKeyId":"AKIA…","secretAccessKey":"…","region":"us-east-1"}. An optional "sessionToken" supports temporary STS credentials.',
  },
  category: 'other',
  // EventBridge accepts event batches asynchronously and may report per-entry
  // failures in a successful HTTP response. The connection therefore cannot
  // promise authoritative delivery or safe replay for publish operations.
  defaultConsistencyModel: 'advisory',
  credentialPlacement: { kind: 'aws-sigv4', service: 'events' },
  baseUrl: 'https://events.{region}.amazonaws.com',
  defaultHeaders: {
    'Content-Type': 'application/x-amz-json-1.1',
  },
  test: {
    method: 'POST',
    path: '/',
    headers: { 'X-Amz-Target': 'AWSEvents.ListEventBuses' },
    body: { Limit: 1 },
  },
  capabilities: [
    {
      name: 'events.publish',
      class: 'mutation',
      description: 'Publish up to 10 events to EventBridge event buses.',
      parameters: {
        type: 'object',
        properties: {
          entries: {
            type: 'array',
            description:
              'Event entries. Each entry may contain Time, Source, Resources, DetailType, Detail, EventBusName, and TraceHeader.',
          },
          endpointId: {
            type: 'string',
            description: 'Global endpoint identifier used for cross-region routing.',
          },
        },
        required: ['entries'],
      },
      request: {
        method: 'POST',
        path: '/',
        headers: { 'X-Amz-Target': 'AWSEvents.PutEvents' },
        body: {
          Entries: '{entries}',
          EndpointId: '{endpointId}',
        },
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'event-buses.list',
      class: 'read',
      description: 'List event buses in the configured AWS region.',
      parameters: {
        type: 'object',
        properties: {
          namePrefix: { type: 'string', description: 'Filter event bus names by prefix.' },
          nextToken: { type: 'string' },
          limit: { type: 'integer', description: 'Maximum results to return (1-100).' },
        },
      },
      request: {
        method: 'POST',
        path: '/',
        headers: { 'X-Amz-Target': 'AWSEvents.ListEventBuses' },
        body: {
          NamePrefix: '{namePrefix}',
          NextToken: '{nextToken}',
          Limit: '{limit}',
        },
      },
    },
    {
      name: 'event-buses.create',
      class: 'mutation',
      description: 'Create a custom EventBridge event bus.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Event bus name.' },
          eventSourceName: {
            type: 'string',
            description: 'Partner event source name to associate with the bus.',
          },
          description: { type: 'string' },
          kmsKeyIdentifier: {
            type: 'string',
            description: 'KMS key identifier used to encrypt events on this bus.',
          },
          deadLetterConfig: {
            type: 'object',
            description: 'Dead-letter queue configuration, for example { Arn }.',
          },
          tags: {
            type: 'array',
            description: 'AWS tags as an array of { Key, Value } objects.',
          },
        },
        required: ['name'],
      },
      request: {
        method: 'POST',
        path: '/',
        headers: { 'X-Amz-Target': 'AWSEvents.CreateEventBus' },
        body: {
          Name: '{name}',
          EventSourceName: '{eventSourceName}',
          Description: '{description}',
          KmsKeyIdentifier: '{kmsKeyIdentifier}',
          DeadLetterConfig: '{deadLetterConfig}',
          Tags: '{tags}',
        },
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'event-buses.delete',
      class: 'mutation',
      description: 'Delete a custom EventBridge event bus.',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string', description: 'Event bus name.' } },
        required: ['name'],
      },
      request: {
        method: 'POST',
        path: '/',
        headers: { 'X-Amz-Target': 'AWSEvents.DeleteEventBus' },
        body: { Name: '{name}' },
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'rules.list',
      class: 'read',
      description: 'List EventBridge rules, optionally filtered by event bus or name prefix.',
      parameters: {
        type: 'object',
        properties: {
          eventBusName: { type: 'string' },
          namePrefix: { type: 'string' },
          nextToken: { type: 'string' },
          limit: { type: 'integer', description: 'Maximum results to return (1-100).' },
        },
      },
      request: {
        method: 'POST',
        path: '/',
        headers: { 'X-Amz-Target': 'AWSEvents.ListRules' },
        body: {
          EventBusName: '{eventBusName}',
          NamePrefix: '{namePrefix}',
          NextToken: '{nextToken}',
          Limit: '{limit}',
        },
      },
    },
    {
      name: 'rules.get',
      class: 'read',
      description: 'Get one EventBridge rule by name and event bus.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          eventBusName: { type: 'string' },
        },
        required: ['name'],
      },
      request: {
        method: 'POST',
        path: '/',
        headers: { 'X-Amz-Target': 'AWSEvents.DescribeRule' },
        body: {
          Name: '{name}',
          EventBusName: '{eventBusName}',
        },
      },
    },
    {
      name: 'rules.put',
      class: 'mutation',
      description: 'Create or replace an EventBridge rule.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          eventBusName: { type: 'string' },
          eventPattern: { type: 'string', description: 'Event pattern as a JSON string.' },
          scheduleExpression: { type: 'string', description: 'Rate or cron expression.' },
          state: {
            type: 'string',
            enum: ['ENABLED', 'DISABLED', 'ENABLED_WITH_ALL_CLOUDTRAIL_MANAGEMENT_EVENTS'],
          },
          description: { type: 'string' },
          roleArn: { type: 'string' },
          tags: { type: 'array', description: 'AWS tags as { Key, Value } objects.' },
        },
        required: ['name'],
      },
      request: {
        method: 'POST',
        path: '/',
        headers: { 'X-Amz-Target': 'AWSEvents.PutRule' },
        body: {
          Name: '{name}',
          EventBusName: '{eventBusName}',
          EventPattern: '{eventPattern}',
          ScheduleExpression: '{scheduleExpression}',
          State: '{state}',
          Description: '{description}',
          RoleArn: '{roleArn}',
          Tags: '{tags}',
        },
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'rules.delete',
      class: 'mutation',
      description: 'Delete an EventBridge rule after its targets have been removed.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          eventBusName: { type: 'string' },
          force: { type: 'boolean', description: 'Force deletion of a managed rule.' },
        },
        required: ['name'],
      },
      request: {
        method: 'POST',
        path: '/',
        headers: { 'X-Amz-Target': 'AWSEvents.DeleteRule' },
        body: {
          Name: '{name}',
          EventBusName: '{eventBusName}',
          Force: '{force}',
        },
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'targets.list',
      class: 'read',
      description: 'List the targets attached to an EventBridge rule.',
      parameters: {
        type: 'object',
        properties: {
          rule: { type: 'string' },
          eventBusName: { type: 'string' },
          nextToken: { type: 'string' },
          limit: { type: 'integer', description: 'Maximum results to return (1-100).' },
        },
        required: ['rule'],
      },
      request: {
        method: 'POST',
        path: '/',
        headers: { 'X-Amz-Target': 'AWSEvents.ListTargetsByRule' },
        body: {
          Rule: '{rule}',
          EventBusName: '{eventBusName}',
          NextToken: '{nextToken}',
          Limit: '{limit}',
        },
      },
    },
    {
      name: 'targets.put',
      class: 'mutation',
      description: 'Add or update up to 10 targets on an EventBridge rule.',
      parameters: {
        type: 'object',
        properties: {
          rule: { type: 'string' },
          eventBusName: { type: 'string' },
          targets: {
            type: 'array',
            description: 'Target definitions. Each target requires Id and Arn.',
          },
        },
        required: ['rule', 'targets'],
      },
      request: {
        method: 'POST',
        path: '/',
        headers: { 'X-Amz-Target': 'AWSEvents.PutTargets' },
        body: {
          Rule: '{rule}',
          EventBusName: '{eventBusName}',
          Targets: '{targets}',
        },
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'targets.remove',
      class: 'mutation',
      description: 'Remove target IDs from an EventBridge rule.',
      parameters: {
        type: 'object',
        properties: {
          rule: { type: 'string' },
          eventBusName: { type: 'string' },
          ids: { type: 'array', description: 'Target IDs to remove (up to 10).' },
          force: { type: 'boolean', description: 'Force removal from a managed rule.' },
        },
        required: ['rule', 'ids'],
      },
      request: {
        method: 'POST',
        path: '/',
        headers: { 'X-Amz-Target': 'AWSEvents.RemoveTargets' },
        body: {
          Rule: '{rule}',
          EventBusName: '{eventBusName}',
          Ids: '{ids}',
          Force: '{force}',
        },
      },
      cas: 'none',
      externalEffect: true,
    },
  ],
})
