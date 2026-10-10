# Hospitality connector contracts

The Hub owns provider keys, capability grants, execution, and audit records.
The hospitality app calls Hub actions through a connected source.
It does not call these provider APIs directly.

## Cloudbeds

Create an API key for the target property with these scopes: `read:reservation`, `read:room`, `read:guest`, `read:housekeeping`, `write:housekeeping`, `read:rate`, and `write:item`.
Store it in the connection credential envelope.
Set nonsecret connection metadata to `{ "propertyId": "1234" }`.
Record the granted scopes on the Hub connection; each action is exposed only when the Hub grant holds its scopes.
The connector sends this property ID on each request and refuses rows that name another property.
`getGuest`, `getGuestNotes`, and `getHousekeepingStatus` return no property ID, so for those reads the pinned request parameter and the property-scoped key are the only bound.

| Action | Cloudbeds operation | Scopes |
| --- | --- | --- |
| `reservations.list` | `GET /getReservations` | `read:reservation` |
| `reservations.get` | `GET /getReservation` | `read:reservation` |
| `guests.get` | `GET /getGuest` | `read:guest` |
| `guests.notes` | `GET /getGuestNotes` | `read:guest` |
| `housekeeping.status` | `GET /getHousekeepingStatus` | `read:housekeeping` |
| `housekeeping.update` | `GET /getHousekeepingStatus`, then `POST /postHousekeepingStatus` | `read:housekeeping`, `write:housekeeping` |
| `rate-plans.list` | `GET /getRatePlans` | `read:rate` |
| `room-types.available` | `GET /getAvailableRoomTypes` | `read:room` |
| `folio-items.post` | `GET /getReservation`, then `POST /postCustomItem` | `read:reservation`, `write:item` |
| `webhooks.subscribe` | `GET /getWebhooks`, then `POST /postWebhook` | `read:reservation` |
| `webhooks.list` | `GET /getWebhooks` | `read:reservation` |
| `webhooks.delete` | `GET /getWebhooks`, then `DELETE /deleteWebhook` | `read:reservation` |

The webhook endpoints declare no scope in the spec; Cloudbeds applies the subscribed event's object scope, which is `read:reservation` for every allowed event.

### Reservations and payments

`reservations.list` requires an arrival or departure date pair, except that `status: "checked_in"` alone lists guests in house now.
Each range spans at most 31 days, and the caller pages with `pageNumber` and `pageSize` (at most 100).
The connector always sends `includeAllRooms=true`.
Each row has reservation identity, stay dates, status, main guest ID and name, balance, and deduplicated `roomTypeIds`, `roomIds`, and `roomNames` in provider order.
A row without a `rooms` field returns empty lists.
It does not request guest details, guest requirements, or custom fields.

`reservations.get` reads one reservation and checks that Cloudbeds returns the connected property and the requested reservation ID.
It returns status, stay dates, main guest ID and name, assigned rooms (room ID, room name, room type), unassigned room types, adult and child counts, source, `total`, `balance`, and `balanceDetailed` (`subTotal`, `additionalItems`, `taxesFees`, `grandTotal`, `paid`, `suggestedDeposit`).
Cloudbeds v1.3 has no payments or transactions read.
Use `balanceDetailed.paid` for the amount paid and `balance` for the amount owed.
Cards on file, custom fields, and guest documents are never returned.

### Guests

`guests.get` returns name, email, phone, cell phone, country, nationality, anonymization, and a merged-into guest ID.
The v1.3 guest schema has no language field.
Address, birth date, and identity documents are never returned.
`guests.notes` returns each staff note with its ID, author, timestamps, and text up to 4,000 characters.

### Housekeeping

`housekeeping.status` returns today's room condition, occupancy, do-not-disturb, blocked flag, front-desk status, and assigned housekeeper.
It filters by `roomId` or `roomCondition` and pages up to 500 rooms.
Conditions are `clean` or `dirty`; `inspected` is also reported on properties with that feature.

`housekeeping.update` first reads the room's status to prove the room belongs to the connected property.
It then sets `roomCondition` to `clean` or `dirty` and, when given, `doNotDisturb`.
Cloudbeds toggles the condition when the request omits it, so the connector always sends an explicit condition.
Setting an explicit condition is idempotent, so retries are safe.
A receipt that does not echo the requested room and condition is reported as indeterminate.

### Rates and availability

`rate-plans.list` reads publicly sellable rate plans for a stay of 1 to 31 nights, optionally for one room type.
It returns each rate's ID, plan ID and public name, room type, room rate, total rate, rooms available, and whether it is derived.
Allotment-block rates are not returned by Cloudbeds.
It refuses rows that name another property or another requested room type.

`room-types.available` reads Cloudbeds room-type availability for a requested stay of 1 to 31 nights.
It sends one pinned property ID and explicit guest counts to `getAvailableRoomTypes`.
The result contains each room type's reported available count and rate, plus property page fields.
Cloudbeds pages properties, not room types; `roomCount` may exceed `pageSize` for one property.
The connector accepts only the one pinned property row and rejects unexpected additional property rows.
Rates and availability are provider snapshots at fetch time, not a held room or confirmed booking.

### Folio items

`folio-items.post` writes one unpaid custom item to a reservation.
It first reads the reservation by ID and checks that Cloudbeds returns the connected property and requested reservation ID.
The write requires both `read:reservation` and `write:item` grants.
The Hub operation key becomes Cloudbeds `referenceID` and must remain stable for retries of the same logical charge.
The caller provides the approved price and explicit tax amounts; an empty `taxes` list means no tax applies.
Cloudbeds records custom tax labels as free text and does not calculate the tax amount.
The caller must confirm the tax and price before granting the write.
Cloudbeds can return a `notice` on duplicate `referenceID`; the connector reports recognized duplicate notices without claiming it created a second item.
Other receipts without a sold product ID remain indeterminate and require operator reconciliation.

### Webhooks

`webhooks.subscribe` accepts only these reservation events: `created`, `status_changed`, `dates_changed`, `accommodation_changed`, and `deleted`.
`status_changed` carries confirmation, cancellation, check-in, check-out, and no-show transitions.
The endpoint must be an https URL without credentials or a fragment.
The connector first lists subscriptions and reuses one with the same event and endpoint.
Pass `authHeaderName` and `authHeaderValue` together to have Cloudbeds send that header on every delivery.
Cloudbeds never returns the value from `getWebhooks`, and a re-post with a new value rotates it.
The connector never returns the value and redacts it from errors.
`webhooks.delete` deletes a subscription only after it appears in the property's list, and reports a missing one as already absent.

Cloudbeds does not sign webhook bodies.
`cloudbedsWebhookProvider` from `@tangle-network/agent-integrations/webhooks` authenticates a delivery by comparing the `CLOUDBEDS_WEBHOOK_AUTH_HEADER` (`x-tangle-webhook-token`) header with the per-connection secret in constant time.
Subscribe with `authHeaderName: CLOUDBEDS_WEBHOOK_AUTH_HEADER` and that secret as `authHeaderValue`.
The header proves the sender holds the secret; it does not bind the body or prevent a replay.
Treat every event as a hint: re-read the reservation with `reservations.get` before acting on it.

The provider emits `cloudbeds.<object>.<action>` events, such as `cloudbeds.reservation.status_changed`, from a closed catalog of the five subscribed events.
Its payload is the delivered JSON plus string `propertyId` and `reservationId` fields normalized from the inconsistent spellings Cloudbeds sends (`propertyID`, `propertyID_str`, `propertyId`; `reservationID`, `reservationId`).
`providerEventId` is the hex SHA-256 of `event|propertyId|reservationId|timestamp`; Cloudbeds keeps the original timestamp across its five retries, so a retry deduplicates.
Other events are acknowledged as no-ops.
Cloudbeds retries a delivery that takes more than 2 seconds, so the receiver must enqueue the event and return 2xx before doing any work.

The connection test proves reservation read access only.
Only a real approved write can prove a write scope.

Source: [Cloudbeds PMS OpenAPI](https://github.com/cloudbeds/openapi-specs/blob/main/src/pms-v1.3-openapi.yaml), [Cloudbeds webhooks guide](https://developers.cloudbeds.com/docs/webhooks-1), and [Cloudbeds point of sale guide](https://developers.cloudbeds.com/docs/point-of-sale).

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
