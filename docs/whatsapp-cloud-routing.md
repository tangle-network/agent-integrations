# WhatsApp sending IDs

The API-key `whatsapp` adapter sends through `graph.facebook.com/v21.0`.
Its `messages.send`, `media.send`, `template.send`, `messages.reply`, and
`messages.react` actions require `phoneNumberId`, the Meta ID of the sender's
registered phone number. A WhatsApp Business Account ID (`businessAccountId`)
identifies the account, not its sending number. Requests supplying that old
field are rejected before any network call; do not rename a WABA ID as a
phone number ID.

The connection test reads `/me?fields=id` to check token access. It does not
prove that a specific sender is registered or that a message will deliver.

The separate OAuth `whatsapp-business` adapter already takes its sender from
connection metadata `phoneNumberId`, with `wabaId` for account-level template
operations. An OAuth reply must match that saved sender. Both providers expose owned-number
inventory and signed incoming message normalization for Hub Lines.

API contract: [Meta's WhatsApp Cloud API messages](https://www.postman.com/meta/whatsapp-business-platform/folder/13382743-ba8d099d-007e-4b52-b9f2-3cf3c60e4fbc).

Incoming webhooks must be bound to the exact WABA and phone number ID. The app
secret authenticates the raw body; it does not authorize another account using
the same Meta app. Status callbacks are not agent commands. Text is bounded to
4096 characters; media descriptors require explicit handling by the consumer.

Meta does not expose an idempotency key for message sends. API-key and OAuth
replies declare `cas: none`; consumers must retain an attempted effect before
calling Meta and must not repeat an ambiguous send automatically.
