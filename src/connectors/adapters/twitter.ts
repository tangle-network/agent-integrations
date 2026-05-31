import { declarativeRestConnector } from './declarative-rest.js'

export const twitterConnector = declarativeRestConnector({
  kind: 'twitter',
  displayName: 'Twitter',
  description: 'Post tweets and reply to tweets on Twitter.',
  auth: { kind: 'api-key', hint: 'Twitter API key and access tokens.' },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.twitter.com/2',
  test: { method: 'GET', path: '/tweets/search/recent' },
  capabilities: [
    {
      name: 'tweets.create',
      class: 'mutation',
      description: 'Post a new tweet.',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
      request: { method: 'POST', path: '/tweets', body: { text: '{text}' } },
      cas: 'native-idempotency',
    },
    {
      name: 'tweets.reply',
      class: 'mutation',
      description: 'Reply to an existing tweet.',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string' }, replyTo: { type: 'string' } },
        required: ['text', 'replyTo'],
      },
      request: { method: 'POST', path: '/tweets', body: { text: '{text}', reply: { in_reply_to_tweet_id: '{replyTo}' } } },
      cas: 'native-idempotency',
    },
  ],
})
