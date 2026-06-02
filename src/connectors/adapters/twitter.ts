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
    {
      name: 'tweets.delete',
      class: 'mutation',
      description: 'Delete a tweet authored by the authenticated user.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Tweet id to delete.' } },
        required: ['id'],
      },
      request: { method: 'DELETE', path: '/tweets/{id}' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'tweets.like',
      class: 'mutation',
      description: 'Like a tweet on behalf of the authenticated user.',
      parameters: {
        type: 'object',
        properties: {
          user_id: { type: 'string', description: 'Authenticated user id performing the like.' },
          tweet_id: { type: 'string', description: 'Tweet id to like.' },
        },
        required: ['user_id', 'tweet_id'],
      },
      request: {
        method: 'POST',
        path: '/users/{user_id}/likes',
        body: { tweet_id: '{tweet_id}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'tweets.retweet',
      class: 'mutation',
      description: 'Retweet a tweet on behalf of the authenticated user.',
      parameters: {
        type: 'object',
        properties: {
          user_id: { type: 'string', description: 'Authenticated user id performing the retweet.' },
          tweet_id: { type: 'string', description: 'Tweet id to retweet.' },
        },
        required: ['user_id', 'tweet_id'],
      },
      request: {
        method: 'POST',
        path: '/users/{user_id}/retweets',
        body: { tweet_id: '{tweet_id}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'dms.send',
      class: 'mutation',
      description: 'Send a direct message to a participant.',
      parameters: {
        type: 'object',
        properties: {
          participant_id: { type: 'string', description: 'Recipient user id.' },
          text: { type: 'string', description: 'Message text body.' },
        },
        required: ['participant_id', 'text'],
      },
      request: {
        method: 'POST',
        path: '/dm_conversations/with/{participant_id}/messages',
        body: { text: '{text}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
