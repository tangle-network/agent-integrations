import { declarativeRestConnector } from './declarative-rest.js'

// AWS SQS JSON protocol (sqs.<region>.amazonaws.com). All actions are POST to
// the service root with X-Amz-Target: AmazonSQS.<Action> and JSON body; the
// gateway signs requests with SigV4 using the credential bundle in the api-key
// field. Region is bound into the host via metadata.endpoint at credential-mint
// time so the same manifest targets any AWS region.
//
// The activepieces catalog surfaces only send.message, but a usable SQS adapter
// for an agent must cover the full messaging primitive: send / receive / delete
// / queue discovery. Receiving without deleting leaves the message redelivering
// after the visibility timeout, so receive + delete are mandatory companions to
// send (not optional polish).

export const amazonSqsConnector = declarativeRestConnector({
  kind: 'amazon-sqs',
  displayName: 'Amazon SQS',
  description:
    'Send, receive, and delete messages on AWS SQS queues, and discover queue URLs and attributes.',
  auth: {
    kind: 'api-key',
    hint: 'AWS access key id + secret access key + region (api-key field carries the SigV4 credential bundle; metadata.endpoint may override the regional host).',
  },
  category: 'other',
  // SQS is an at-least-once durable queue: sends, deletes, and queue-attribute
  // reads are authoritative against the service. Receive returns a transient
  // visibility-locked view, but the queue state itself is authoritative.
  defaultConsistencyModel: 'authoritative',
  baseUrl: {
    metadataKey: 'endpoint',
    fallback: 'https://sqs.us-east-1.amazonaws.com',
  },
  defaultHeaders: {
    'Content-Type': 'application/x-amz-json-1.0',
  },
  test: {
    method: 'POST',
    path: '/',
    headers: { 'X-Amz-Target': 'AmazonSQS.ListQueues' },
    body: { MaxResults: 1 },
  },
  capabilities: [
    {
      name: 'queues.list',
      class: 'read',
      description: 'List SQS queue URLs visible to the caller in the configured region.',
      parameters: {
        type: 'object',
        properties: {
          queueNamePrefix: {
            type: 'string',
            description: 'Only return queues whose name starts with this prefix.',
          },
          maxResults: {
            type: 'integer',
            description: 'Maximum number of queue URLs to return (1-1000).',
          },
          nextToken: {
            type: 'string',
            description: 'Pagination token from a previous ListQueues response.',
          },
        },
      },
      request: {
        method: 'POST',
        path: '/',
        headers: { 'X-Amz-Target': 'AmazonSQS.ListQueues' },
        body: {
          QueueNamePrefix: '{queueNamePrefix}',
          MaxResults: '{maxResults}',
          NextToken: '{nextToken}',
        },
      },
    },
    {
      name: 'queues.getUrl',
      class: 'read',
      description: 'Resolve a queue name to its URL (the canonical identifier used by every other SQS call).',
      parameters: {
        type: 'object',
        properties: {
          queueName: { type: 'string', description: 'Queue name (without the AWS account prefix).' },
          queueOwnerAWSAccountId: {
            type: 'string',
            description: 'AWS account id of the queue owner if not the caller.',
          },
        },
        required: ['queueName'],
      },
      request: {
        method: 'POST',
        path: '/',
        headers: { 'X-Amz-Target': 'AmazonSQS.GetQueueUrl' },
        body: {
          QueueName: '{queueName}',
          QueueOwnerAWSAccountId: '{queueOwnerAWSAccountId}',
        },
      },
    },
    {
      name: 'queues.getAttributes',
      class: 'read',
      description: 'Get queue attributes (e.g. ApproximateNumberOfMessages, VisibilityTimeout, RedrivePolicy).',
      parameters: {
        type: 'object',
        properties: {
          queueUrl: { type: 'string', description: 'Fully qualified SQS queue URL.' },
          attributeNames: {
            type: 'array',
            description: 'Attribute names to fetch (e.g. ["All"], ["ApproximateNumberOfMessages"]).',
          },
        },
        required: ['queueUrl'],
      },
      request: {
        method: 'POST',
        path: '/',
        headers: { 'X-Amz-Target': 'AmazonSQS.GetQueueAttributes' },
        body: {
          QueueUrl: '{queueUrl}',
          AttributeNames: '{attributeNames}',
        },
      },
    },
    {
      name: 'messages.send',
      class: 'mutation',
      description:
        'Send a message to an SQS queue. Maps to the activepieces send.message action. For FIFO queues, MessageGroupId is required and MessageDeduplicationId enables native deduplication.',
      parameters: {
        type: 'object',
        properties: {
          queueUrl: { type: 'string', description: 'Fully qualified SQS queue URL.' },
          messageBody: { type: 'string', description: 'Message payload (string; opaque to SQS).' },
          delaySeconds: {
            type: 'integer',
            description: 'Delay before the message becomes visible (0-900 seconds).',
          },
          messageAttributes: {
            type: 'object',
            description: 'Structured attributes (name -> { DataType, StringValue | BinaryValue }).',
          },
          messageSystemAttributes: {
            type: 'object',
            description: 'System attributes (e.g. AWSTraceHeader).',
          },
          messageGroupId: {
            type: 'string',
            description: 'FIFO queue ordering group; required for FIFO queues.',
          },
          messageDeduplicationId: {
            type: 'string',
            description: 'FIFO queue dedup token; suppresses redelivery of the same id within the 5-minute window.',
          },
        },
        required: ['queueUrl', 'messageBody'],
      },
      request: {
        method: 'POST',
        path: '/',
        headers: { 'X-Amz-Target': 'AmazonSQS.SendMessage' },
        body: {
          QueueUrl: '{queueUrl}',
          MessageBody: '{messageBody}',
          DelaySeconds: '{delaySeconds}',
          MessageAttributes: '{messageAttributes}',
          MessageSystemAttributes: '{messageSystemAttributes}',
          MessageGroupId: '{messageGroupId}',
          MessageDeduplicationId: '{messageDeduplicationId}',
        },
      },
      // FIFO queues dedupe natively via MessageDeduplicationId; standard queues
      // do not. We mark the capability as native-idempotency because the API
      // surface accepts a client-supplied dedup token even though enforcement is
      // queue-type dependent.
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'messages.sendBatch',
      class: 'mutation',
      description: 'Send up to 10 messages in one call. Each Entry needs a unique Id within the batch.',
      parameters: {
        type: 'object',
        properties: {
          queueUrl: { type: 'string' },
          entries: {
            type: 'array',
            description:
              'Array of { Id, MessageBody, DelaySeconds?, MessageAttributes?, MessageGroupId?, MessageDeduplicationId? }.',
          },
        },
        required: ['queueUrl', 'entries'],
      },
      request: {
        method: 'POST',
        path: '/',
        headers: { 'X-Amz-Target': 'AmazonSQS.SendMessageBatch' },
        body: {
          QueueUrl: '{queueUrl}',
          Entries: '{entries}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'messages.receive',
      class: 'mutation',
      description:
        'Receive up to MaxNumberOfMessages messages from a queue. Returns ReceiptHandles required for messages.delete. Long polling (WaitTimeSeconds > 0) reduces empty receives.',
      parameters: {
        type: 'object',
        properties: {
          queueUrl: { type: 'string' },
          maxNumberOfMessages: {
            type: 'integer',
            description: 'Maximum messages to return (1-10).',
          },
          waitTimeSeconds: {
            type: 'integer',
            description: 'Long-poll duration (0-20 seconds).',
          },
          visibilityTimeout: {
            type: 'integer',
            description: 'Seconds the message stays invisible to other receivers.',
          },
          attributeNames: {
            type: 'array',
            description: 'System attributes to include (e.g. ["All"]).',
          },
          messageAttributeNames: {
            type: 'array',
            description: 'User attribute names to include (e.g. ["All"]).',
          },
          receiveRequestAttemptId: {
            type: 'string',
            description: 'FIFO receive retry dedup token (5-minute window).',
          },
        },
        required: ['queueUrl'],
      },
      request: {
        method: 'POST',
        path: '/',
        headers: { 'X-Amz-Target': 'AmazonSQS.ReceiveMessage' },
        body: {
          QueueUrl: '{queueUrl}',
          MaxNumberOfMessages: '{maxNumberOfMessages}',
          WaitTimeSeconds: '{waitTimeSeconds}',
          VisibilityTimeout: '{visibilityTimeout}',
          AttributeNames: '{attributeNames}',
          MessageAttributeNames: '{messageAttributeNames}',
          ReceiveRequestAttemptId: '{receiveRequestAttemptId}',
        },
      },
      // Receive mutates visibility state on the queue (messages become invisible
      // for visibilityTimeout) and is non-idempotent: identical calls return
      // different message sets. Modeled as mutation with externalEffect so
      // callers cannot assume safe retry.
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'messages.delete',
      class: 'mutation',
      description:
        'Permanently delete a message from a queue using the ReceiptHandle returned by messages.receive. Required to acknowledge processing; otherwise the message redelivers after VisibilityTimeout.',
      parameters: {
        type: 'object',
        properties: {
          queueUrl: { type: 'string' },
          receiptHandle: {
            type: 'string',
            description: 'ReceiptHandle from the matching ReceiveMessage response.',
          },
        },
        required: ['queueUrl', 'receiptHandle'],
      },
      request: {
        method: 'POST',
        path: '/',
        headers: { 'X-Amz-Target': 'AmazonSQS.DeleteMessage' },
        body: {
          QueueUrl: '{queueUrl}',
          ReceiptHandle: '{receiptHandle}',
        },
      },
      // Delete is idempotent at the receipt-handle granularity: replaying the
      // same handle is a no-op (the message is already gone). Marked as
      // native-idempotency to surface that semantic to the caller.
      cas: 'native-idempotency',
    },
    {
      name: 'messages.deleteBatch',
      class: 'mutation',
      description: 'Delete up to 10 messages in one call. Each Entry needs a unique Id within the batch.',
      parameters: {
        type: 'object',
        properties: {
          queueUrl: { type: 'string' },
          entries: {
            type: 'array',
            description: 'Array of { Id, ReceiptHandle }.',
          },
        },
        required: ['queueUrl', 'entries'],
      },
      request: {
        method: 'POST',
        path: '/',
        headers: { 'X-Amz-Target': 'AmazonSQS.DeleteMessageBatch' },
        body: {
          QueueUrl: '{queueUrl}',
          Entries: '{entries}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'messages.changeVisibility',
      class: 'mutation',
      description:
        'Extend or shorten the visibility timeout of a received message. Use to keep a long-running handler from losing its lease.',
      parameters: {
        type: 'object',
        properties: {
          queueUrl: { type: 'string' },
          receiptHandle: { type: 'string' },
          visibilityTimeout: {
            type: 'integer',
            description: 'New visibility timeout in seconds (0-43200).',
          },
        },
        required: ['queueUrl', 'receiptHandle', 'visibilityTimeout'],
      },
      request: {
        method: 'POST',
        path: '/',
        headers: { 'X-Amz-Target': 'AmazonSQS.ChangeMessageVisibility' },
        body: {
          QueueUrl: '{queueUrl}',
          ReceiptHandle: '{receiptHandle}',
          VisibilityTimeout: '{visibilityTimeout}',
        },
      },
      cas: 'native-idempotency',
    },
  ],
})
