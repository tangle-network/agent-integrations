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
operations. This change does not migrate those connections or add a Hub Lines
channel.

API contract: [Meta's WhatsApp Cloud API messages](https://www.postman.com/meta/whatsapp-business-platform/folder/13382743-ba8d099d-007e-4b52-b9f2-3cf3c60e4fbc).
