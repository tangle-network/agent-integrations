# Hospitality connector contracts

The Hub owns provider keys, capability grants, execution, and audit records.
The hospitality app calls Hub actions through a connected source.
It does not call these provider APIs directly.

## Cloudbeds

Create an API key with `read:reservation`, `read:room`, and `write:item` scopes for the target property.
Store it in the connection credential envelope.
Set nonsecret connection metadata to `{ "propertyId": "1234" }`.
Record all three granted scopes on the Hub connection so its capability grant can expose the three actions.
The connector sends this property ID on each request and refuses reservation rows from another property.

`reservations.list` requires an arrival or departure date pair.
Each range spans at most 31 days, and the caller pages with `pageNumber` and `pageSize` (at most 100).
The action returns only reservation identity, stay dates, status, guest name, balance, and paging fields.
It does not request guest detail or custom fields.

`room-types.available` reads Cloudbeds room-type availability for a requested stay of 1 to 31 nights.
It sends one pinned property ID and explicit guest counts to `getAvailableRoomTypes`.
The result contains each room type's reported available count and rate, plus property page fields.
Cloudbeds pages properties, not room types; `roomCount` may exceed `pageSize` for one property.
The connector accepts only the one pinned property row and rejects unexpected additional property rows.
This is a provider snapshot at fetch time, not a held room or confirmed booking.

`folio-items.post` writes one unpaid custom item to a reservation.
It first reads the reservation by ID and checks that Cloudbeds returns the connected property and requested reservation ID.
The write requires both `read:reservation` and `write:item` grants.
The Hub operation key becomes Cloudbeds `referenceID` and must remain stable for retries of the same logical charge.
The caller provides the approved price and explicit tax amounts; an empty `taxes` list means no tax applies.
Cloudbeds records custom tax labels as free text and does not calculate the tax amount.
The caller must confirm the tax and price before granting the write.
Cloudbeds can return a `notice` on duplicate `referenceID`; the connector reports recognized duplicate notices without claiming it created a second item.
Other receipts without a sold product ID remain indeterminate and require operator reconciliation.
The connection test proves reservation read access; it does not prove room read or write access.
Only a real approved write can prove the write scope.

Source: [Cloudbeds PMS OpenAPI](https://github.com/cloudbeds/openapi-specs/blob/main/src/pms-v1.3-openapi.yaml) and [Cloudbeds point of sale guide](https://developers.cloudbeds.com/docs/point-of-sale).

## PriceLabs

Use a PriceLabs Customer API key and pin allowed listing ID and PMS pairs in connection metadata:

```json
{ "listings": [{ "id": "listing-1", "pms": "cloudbeds" }] }
```

`listing-prices.get` reads one pinned listing for a date range of at most 31 days.
It returns nightly price, minimum stay, booking status, and currency.
It cannot change rates or availability.
The connection test checks that every pinned listing appears in the API key's inventory.

Source: [PriceLabs listing prices](https://developers.pricelabs.co/customer-api/api-reference/customer-api/prices/for-listings) and [listing inventory](https://developers.pricelabs.co/customer-api/api-reference/customer-api/listings/all-listings).

## Linq WhatsApp inbound media

The conversation normalizer preserves incoming image, audio, video, document, and sticker parts as attachments.
It includes media captions in event text.
It marks an event `historyOnly` when a media URL is absent, so the host can hydrate the chat journal before processing it.

`attachments.content` accepts only an exact Linq WhatsApp attachment URL from an incoming media part.
The Hub downloads the bytes with the connected brand key and rejects redirects, other hosts, and files over 16 MB.
Its result contains `contentBase64`, `contentType`, and `size` for the host to persist at its file boundary.
The host should resolve media promptly and pass a stored file reference to the agent.
Linq retains incoming bytes for 30 days; an inbound `media_id` is a different identifier and expires after seven days.
Pending capture returns a distinct error for a bounded retry.

Source: [Linq WhatsApp attachments](https://docs.linqapp.com/channel/whatsapp/guides/messaging/attachments/) and [served OpenAPI contract](https://whatsapp.messages.api.linqapp.com/v1/openapi.yaml).

## Linq WhatsApp presence

`messages.react` sends a reaction part in the existing chat.
It targets Linq's `Message.id`, not the inbound channel message ID.
The caller supplies a stable operation key, and the connector sends it as `Idempotency-Key`.
The customer window must be open.
Provider acceptance is not delivery; a reaction normally ends at `sent`.

`chats.read_receipt` marks the newest readable, unread inbound message in the chat read.
A 409 `nothing_unread` or `nothing_readable` response is a no-op that the host must handle.
The catalog does not expose a WhatsApp typing action.
Linq couples its typing indicator to this read command, so repeated typing pulses cannot refresh it after the message is read.

Source: [Linq WhatsApp sending guide](https://docs.linqapp.com/channel/whatsapp/guides/messaging/sending-messages/).

## Sendblue lines

Store `apiKeyId` and `apiSecretKey` together as JSON in the encrypted API-key credential.
The adapter sends them as `sb-api-key-id` and `sb-api-secret-key` headers.
Select a number from `lines.state`; the host must bind that number to the connected line before sending.
The `receive` webhook must have a configured secret.
The verifier compares the `sb-signing-secret` header with that secret and deduplicates inbound deliveries by `message_handle`.
Sendblue does not include a signed timestamp in this webhook protocol.

`messages.send` sends text, with optional media or an inline reply target.
`messages.send_media` sends media without text.
Sendblue can fall back from iMessage to SMS, and it offers no switch to disable that fallback.
Use `recipient.service` when the host must check iMessage eligibility before sending.
The group actions require an existing group ID; the host must read its current members before sending.
The generic reply and presence planners reject group events.
Read receipts require account activation, and an accepted API response does not prove delivery to the recipient.
Sendblue does not document native duplicate-send protection, so the host must reconcile an uncertain result before retrying.

Source: [Sendblue API overview](https://docs.sendblue.com/api-v2), [webhooks](https://docs.sendblue.com/getting-started/webhooks/), [messages](https://docs.sendblue.com/getting-started/sending-messages), [group send](https://docs.sendblue.com/api/resources/groups/methods/send_message), and [read receipts](https://docs.sendblue.com/api-v2/read-receipts).

## Twilio SMS and MMS

Bind a Twilio account SID and one SMS-capable number from `list_numbers`.
The line picker rejects a partial inventory page.
Call `list_numbers` with `numberSid` to fetch the selected number directly from the connected account.
Create `createTwilioSmsWebhookProvider` with its exact public URL, account SID, and `kind: 'message'`.
The host supplies the account auth token to webhook verification.
The verifier checks Twilio's form signature before the host resolves the line.
The normalizer accepts only SMS or MMS message SIDs and media URLs tied to the signed account and message.
`get_media` authenticates the Twilio media request, follows one HTTPS redirect to Twilio's documented media hosts without forwarding credentials, and caps the download at 20 MiB.
Store those bytes at the host file boundary before giving an agent a file reference.
The Messages API does not document a native idempotency key, so uncertain writes need reconciliation before retry.

Source: [Twilio IncomingPhoneNumber resource](https://www.twilio.com/docs/phone-numbers/api/incomingphonenumber-resource), [Message resource](https://www.twilio.com/docs/messaging/api/message-resource), and [Media subresource](https://www.twilio.com/docs/messaging/api/media-resource).

## Contiguity presence

`imessage.typing` and `imessage.read_receipt` use an explicit leased sender number and recipient number.
The generic planner exposes those actions only for authenticated, current, one-to-one iMessage events.
`messages.react` is available as a manual action after checking the target conversation.
Contiguity chooses the latest message with matching text, so the generic planner does not select a reaction target automatically.

Source: [Contiguity reactions](https://contiguity.mintlify.app/api-reference/product/imessage/reactions), [typing](https://contiguity.mintlify.app/api-reference/product/imessage/typing), and [read receipts](https://contiguity.mintlify.app/api-reference/product/imessage/read).
