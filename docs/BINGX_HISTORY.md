# BingX Futures History

## Why orderHistory is not used as the source of closed trades

`orderHistory` and `fillHistory` are not reliable enough to build a closed
futures trade row in Trade Diary.

Problems found during the BingX history fix:

- cancelled/new/pending orders were imported as trades;
- `stopPrice: 0` could become `exit = 0`;
- for a close order, `avgPrice` is the close execution price, not the entry;
- order history often does not include the original entry price;
- fill history can describe executions, but a single fill is not a full closed
  position and can produce `entry = exit`;
- legacy rows were saved with ids such as `futures-order-*`, `futures-fill-*`,
  or raw order ids, so the same real trade could be saved again after switching
  sources.

Because of this, order/fill history is treated only as fallback/debug data. It
must not create a full closed trade unless both entry and exit are present and
valid.

## Why positionHistory is used

Closed BingX futures trades are now built from:

`/openApi/swap/v1/trade/positionHistory`

This endpoint represents a closed position rather than an individual order. It
contains both sides of the closed trade, which is the shape needed by the
history table.

Field mapping:

- `entry = avgPrice`
- `exit = avgClosePrice`
- `pnl = realisedProfit`

Fallbacks are intentionally narrow:

- entry can fall back to `entryPrice` or `openAvgPrice`;
- exit can fall back to `closeAvgPrice`, then `exitPrice` or `closePrice`;
- pnl can fall back to `realizedProfit`, `realisedPnl`, `realizedPnl`,
  `netProfit`, or `pnl`.

If BingX stops returning `avgClosePrice`/`closeAvgPrice`, the server logs a
warning with the raw close-price fields. The trade is skipped when no positive
exit price can be recovered.

## Deduplication

Closed positionHistory trades are deduplicated in two steps:

1. by deterministic `trade.id`;
2. by economic fingerprint:

```text
pair + side + opened + closedAt + entry + exit + pnl + size
```

This is needed because BingX can return the same closed position more than
once. Sometimes the duplicate has the same id, and sometimes the same economic
trade appears with a different id.

The server also logs a warning when:

- `positionHistoryClosedCount > positionHistoryUniqueClosedCount`;
- `positionHistoryDuplicateFingerprintCount > 0`.

## Cleanup of legacy Firestore rows

Cleanup runs only after the server confirms that positionHistory produced at
least one valid unique closed trade.

It deletes only old BingX futures closed rows:

- `source = "bingx"`;
- `market = "futures"`;
- `status = "Closed"`.

Manual trades and non-BingX trades are not touched.

Legacy rows are removed when they match any of these cases:

- id starts with `futures-fill-`;
- id starts with `futures-order-`;
- id starts with `futures-position-history-`;
- `exit = 0`;
- legacy `id` or `orderId` matches the new position id from
  `futures-closed-{positionId}`;
- legacy fingerprint matches the new closed trade fingerprint.

Example:

```text
new id:       futures-closed-2064721151339479042
legacy row:   orderId = 2064721151339479042
result:       legacy row is deleted, new futures-closed row stays
```

## Fixed issues

- Short trades no longer swap entry and exit.
- Long trades no longer use close-order `avgPrice` as entry.
- `stopPrice: 0` no longer creates `exit = 0`.
- Cancelled/new/pending orders are not imported as trades.
- Fill history no longer creates fake closed trades with `entry = exit`.
- Duplicate positionHistory rows are deduplicated before saving.
- Legacy order/fill/old-position rows are cleaned only after successful
  positionHistory normalization.
