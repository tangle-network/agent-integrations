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
Page through property results while `mayHaveMore` is true.
This is a provider snapshot at fetch time, not a held room or confirmed booking.

`folio-items.post` writes one unpaid custom item to a reservation.
It first reads the reservation by ID and checks that Cloudbeds returns the connected property and requested reservation ID.
The write requires both `read:reservation` and `write:item` grants.
The Hub operation key becomes Cloudbeds `referenceID` and must remain stable for retries of the same logical charge.
The caller provides the approved price and explicit tax amounts; an empty `taxes` list means no tax applies.
Cloudbeds records custom tax labels as free text and does not calculate the tax amount.
The caller must confirm the tax and price before granting the write.
Cloudbeds can return a `notice` on duplicate `referenceID`; the connector reports that outcome without claiming it created a second item.
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
