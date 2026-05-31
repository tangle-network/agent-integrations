import { declarativeRestConnector } from './declarative-rest.js'

// Amazon SNS uses the AWS Query Protocol (form/query string parameters with
// Action=<Op>&Version=2010-03-31). Region is bound into the host at
// credential-mint time; the `metadataKey: 'endpoint'` indirection lets a
// caller pin region per tenant without rewriting the manifest. SigV4 is
// performed by the credential layer; the api-key field carries the
// SigV4 credential bundle (accessKeyId + secretAccessKey + region).
export const amazonSnsConnector = declarativeRestConnector({
  kind: 'amazon-sns',
  displayName: 'Amazon SNS',
  description:
    'Publish messages to Amazon Simple Notification Service topics, manage topics, and manage subscriptions.',
  auth: {
    kind: 'api-key',
    hint: 'AWS access key id + secret access key + region (api-key field carries the SigV4 credential bundle).',
  },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: {
    metadataKey: 'endpoint',
    fallback: 'https://sns.us-east-1.amazonaws.com',
  },
  defaultHeaders: {
    'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
    Accept: 'application/json',
  },
  test: {
    method: 'GET',
    path: '/',
    query: {
      Action: 'ListTopics',
      Version: '2010-03-31',
    },
  },
  capabilities: [
    {
      name: 'topics.list',
      class: 'read',
      description: 'List Amazon SNS topics in the caller account. Paginated via NextToken.',
      parameters: {
        type: 'object',
        properties: {
          nextToken: {
            type: 'string',
            description: 'Continuation token returned by a prior ListTopics call.',
          },
        },
      },
      request: {
        method: 'GET',
        path: '/',
        query: {
          Action: 'ListTopics',
          Version: '2010-03-31',
          NextToken: '{nextToken}',
        },
      },
    },
    {
      name: 'topics.get-attributes',
      class: 'read',
      description: 'Get the attributes of an SNS topic (delivery policy, owner, subscription counts, etc.).',
      parameters: {
        type: 'object',
        properties: {
          topicArn: { type: 'string', description: 'ARN of the topic.' },
        },
        required: ['topicArn'],
      },
      request: {
        method: 'GET',
        path: '/',
        query: {
          Action: 'GetTopicAttributes',
          Version: '2010-03-31',
          TopicArn: '{topicArn}',
        },
      },
    },
    {
      name: 'subscriptions.list',
      class: 'read',
      description: 'List subscriptions, optionally filtered to a single topic.',
      parameters: {
        type: 'object',
        properties: {
          topicArn: {
            type: 'string',
            description: 'If set, list only subscriptions for this topic ARN.',
          },
          nextToken: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/',
        query: {
          Action: 'ListSubscriptionsByTopic',
          Version: '2010-03-31',
          TopicArn: '{topicArn}',
          NextToken: '{nextToken}',
        },
      },
    },
    {
      // Mirrors the upstream activepieces piece-amazon-sns "Send Message"
      // action (id: send.message, upstreamName: sendMessageAction).
      name: 'send.message',
      class: 'mutation',
      description:
        'Publish a message to an SNS topic. The message is fanned out to all topic subscribers.',
      parameters: {
        type: 'object',
        properties: {
          topicArn: {
            type: 'string',
            description: 'ARN of the destination SNS topic.',
          },
          message: {
            type: 'string',
            description: 'Message payload delivered to subscribers.',
          },
          subject: {
            type: 'string',
            description:
              'Optional subject line used by email-protocol subscribers (max 100 ASCII chars).',
          },
          messageStructure: {
            type: 'string',
            description:
              'Set to "json" to deliver protocol-specific payloads (e.g. APNS vs email).',
          },
          messageGroupId: {
            type: 'string',
            description: 'FIFO topic message group id. Required for FIFO topics.',
          },
          messageDeduplicationId: {
            type: 'string',
            description:
              'FIFO topic deduplication id. Defaults to the invocation idempotency key for FIFO topics.',
          },
        },
        required: ['topicArn', 'message'],
      },
      request: {
        method: 'POST',
        path: '/',
        query: {
          Action: 'Publish',
          Version: '2010-03-31',
          TopicArn: '{topicArn}',
          Message: '{message}',
          Subject: '{subject}',
          MessageStructure: '{messageStructure}',
          MessageGroupId: '{messageGroupId}',
          MessageDeduplicationId: '{messageDeduplicationId}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'topics.create',
      class: 'mutation',
      description:
        'Create an SNS topic. Idempotent: calling with the same Name returns the existing topic ARN.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Topic name (1-256 chars, alnum/_/-, FIFO topics end with .fifo).',
          },
          displayName: {
            type: 'string',
            description: 'Human-readable name used in SMS subscriber notifications.',
          },
          fifoTopic: {
            type: 'boolean',
            description: 'Set to true to create a FIFO topic (name must end with .fifo).',
          },
        },
        required: ['name'],
      },
      request: {
        method: 'POST',
        path: '/',
        query: {
          Action: 'CreateTopic',
          Version: '2010-03-31',
          Name: '{name}',
          'Attributes.entry.1.key': 'DisplayName',
          'Attributes.entry.1.value': '{displayName}',
          'Attributes.entry.2.key': 'FifoTopic',
          'Attributes.entry.2.value': '{fifoTopic}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'topics.delete',
      class: 'mutation',
      description: 'Delete an SNS topic and all of its subscriptions.',
      parameters: {
        type: 'object',
        properties: {
          topicArn: { type: 'string' },
        },
        required: ['topicArn'],
      },
      request: {
        method: 'POST',
        path: '/',
        query: {
          Action: 'DeleteTopic',
          Version: '2010-03-31',
          TopicArn: '{topicArn}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'subscriptions.subscribe',
      class: 'mutation',
      description:
        'Subscribe an endpoint (email, https, sqs, lambda, sms, application) to an SNS topic.',
      parameters: {
        type: 'object',
        properties: {
          topicArn: { type: 'string' },
          protocol: {
            type: 'string',
            description: 'http, https, email, email-json, sms, sqs, application, lambda, firehose.',
          },
          endpoint: {
            type: 'string',
            description:
              'URL / email address / ARN / phone number whose format depends on protocol.',
          },
          returnSubscriptionArn: {
            type: 'boolean',
            description:
              'Return the SubscriptionArn even when confirmation is still pending. Defaults to false.',
          },
        },
        required: ['topicArn', 'protocol', 'endpoint'],
      },
      request: {
        method: 'POST',
        path: '/',
        query: {
          Action: 'Subscribe',
          Version: '2010-03-31',
          TopicArn: '{topicArn}',
          Protocol: '{protocol}',
          Endpoint: '{endpoint}',
          ReturnSubscriptionArn: '{returnSubscriptionArn}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'subscriptions.unsubscribe',
      class: 'mutation',
      description: 'Delete an SNS subscription.',
      parameters: {
        type: 'object',
        properties: {
          subscriptionArn: { type: 'string' },
        },
        required: ['subscriptionArn'],
      },
      request: {
        method: 'POST',
        path: '/',
        query: {
          Action: 'Unsubscribe',
          Version: '2010-03-31',
          SubscriptionArn: '{subscriptionArn}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
