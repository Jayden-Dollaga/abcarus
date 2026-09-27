# ABCarus Favorites Synchronization Contract

Status: Version 1

Contract identifier: `abcarus.favorites.v1`

Canonical fixtures:
`src/shared/favorites-contract/fixtures/v1.json`.

Desktop ABCarus owns this contract. Mobile clients may use a native
implementation, but must pass the canonical fixtures before claiming support.

## Scope

Favorites use the existing `abcarus.setlist.v2` document rather than a second
document format or transport envelope. A Favorites document has `id` set to
`favorites`, `kind` set to `favorites`, active entries in `items`, and complete
membership history in `favoriteMemberships`.

Ordinary Set Lists are ordered performance documents. They do not use this
set-style merge contract.

## Membership

Each membership contains:

```json
{
  "itemId": "item-id",
  "tuneKey": "best-effort-logical-key",
  "present": true,
  "changedAt": "2026-09-01T12:00:00.000Z"
}
```

`itemId` identifies one membership history. `tuneKey` collapses independently
created memberships that refer to the same logical tune. `items` is a
compatibility projection containing only the winning memberships whose
`present` value is `true`.

## Tune key version 1

Writers derive a missing `tuneKey` in this order:

1. a valid lowercase `sha256:` content hash;
2. `locator:` followed by normalized `source.locatorHint`;
3. normalized basename, `X:`, title, and composer.

Text normalization is Unicode NFKC, surrounding-space removal, internal-space
collapse, and locale-independent lowercase. Backslashes in paths become
slashes before taking the basename.

The stored membership `tuneKey` is authoritative and must not be recomputed
merely because an item's snapshot or source hints changed.

This is a best-effort bridge, not durable tune identity. A future Library
protocol may provide a persistent `tuneId`. Version 1 must not silently rewrite
existing keys when that facility is introduced.

## Merge

Merge is performed per `itemId`. The record with later `changedAt` wins. If the
timestamps are equal and `present` differs, removal wins. Remaining equal-time
ties use lexically greater `itemId` as the deterministic winner.

After per-item merge, records are grouped by `tuneKey` and the same winner rule
chooses the visible membership. Other records remain in membership history.
Favorites order has no synchronization semantics.

An active membership without a corresponding item payload is retained but is
not projected into `items`. This allows a later replica to restore the payload.
An embedded item remains usable when its Library source is missing.

## Time and retention

Version 1 uses UTC RFC 3339 wall-clock timestamps. Writers must advance local
`changedAt` monotonically and set document `updatedAt` to at least the latest
local membership change. Clock skew between devices is a known limitation.

Tombstones are retained indefinitely in version 1. Clients must not garbage
collect them independently. A future acknowledgement protocol may define safe
compaction.

## Compatibility

Servers advertise support through `/v1/info`:

```json
{
  "capabilities": {
    "setListSchema": "abcarus.setlist.v2",
    "favoritesContract": "abcarus.favorites.v1"
  }
}
```

Unknown Favorites contract versions must not be rewritten. A client without
Favorites merge support may read the active `items` projection but must not
publish a modified Favorites document.
