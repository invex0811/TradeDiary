import crypto from "node:crypto";
import cors from "cors";
import "dotenv/config";
import express from "express";

const app = express();
const port = Number(process.env.PORT || 8787);
const bingxBaseUrl = "https://open-api.bingx.com";
const dayMs = 24 * 60 * 60 * 1000;
const bingxHistoryWindowMs = 7 * dayMs - 60_000;

app.use(cors());
app.use(express.json());

type BingXResponse<T> = { code: number; msg?: string; data: T };
type JsonRecord = Record<string, unknown>;
type BingXCredentials = {
  apiKey: string;
  secretKey: string;
};
type BingXHistoryEndpoint = "fills" | "orders" | "positions";

type NormalizedTrade = {
  id: string;
  orderId: string;
  market: "futures";
  pair: string;
  side: "Long" | "Short";
  opened: string;
  closedAt: string;
  durationMs: number;
  entry: number;
  exit: number;
  size: number;
  pnl: number;
  roi: number;
  status: "Closed" | "Open";
};

const asRecord = (value: unknown): JsonRecord =>
  typeof value === "object" && value !== null ? (value as JsonRecord) : {};
const asArray = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const asNumber = (value: unknown) => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
};
const asString = (value: unknown) => String(value ?? "");
const bingxDebugEnabled = /^true$/i.test(process.env.BINGX_DEBUG || "");
const positiveNumber = (...values: unknown[]) => {
  for (const value of values) {
    const numberValue = asNumber(value);
    if (numberValue > 0) return numberValue;
  }
  return 0;
};
const stableTradePart = (value: unknown) =>
  asString(value).trim().replace(/[^a-z0-9._-]+/gi, "_") || "unknown";
const closedFuturesTradeId = (
  symbol: string,
  side: "Long" | "Short",
  openedAt: number,
  closedAt: number,
  pnl: number,
  size: number,
  positionId?: string,
) =>
  positionId
    ? `futures-closed-${stableTradePart(positionId)}`
    : `futures-closed-${[
      symbol,
      side,
      openedAt,
      closedAt,
      pnl.toFixed(8),
      size.toFixed(8),
    ].map(stableTradePart).join("-")}`;

async function verifyFirebaseToken(idToken?: string) {
  const apiKey = process.env.FIREBASE_WEB_API_KEY;
  if (!idToken || !apiKey) return false;

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    },
  );
  return response.ok;
}

function resolveBingXCredentials(value: unknown): BingXCredentials {
  const record = asRecord(value);
  const apiKey = asString(record.bingxApiKey ?? process.env.BINGX_API_KEY).trim();
  const secretKey = asString(record.bingxSecretKey ?? process.env.BINGX_SECRET_KEY).trim();
  if (!apiKey || !secretKey) {
    throw new Error("BingX API keys are not configured");
  }
  return { apiKey, secretKey };
}

function signedQuery(params: Record<string, string>, secretKey: string) {
  if (!secretKey) throw new Error("BINGX_SECRET_KEY is not configured");

  const entries = Object.entries({
    ...params,
    timestamp: Date.now().toString(),
  }).sort(([left], [right]) => left.localeCompare(right));
  const query = new URLSearchParams(entries).toString();
  const signature = crypto.createHmac("sha256", secretKey).update(query).digest("hex");
  return `${query}&signature=${signature}`;
}

async function bingxRequest<T>(credentials: BingXCredentials, path: string, params: Record<string, string> = {}) {
  const apiKey = credentials.apiKey;
  if (!apiKey) throw new Error("BINGX_API_KEY is not configured");

  const response = await fetch(`${bingxBaseUrl}${path}?${signedQuery(params, credentials.secretKey)}`, {
    headers: { "X-BX-APIKEY": apiKey },
  });
  const payload = (await response.json()) as BingXResponse<T>;
  if (!response.ok || payload.code !== 0) {
    throw new Error(payload.msg || `BingX request failed with ${response.status}`);
  }
  return payload.data;
}

async function collectBingXHistory(
  credentials: BingXCredentials,
  endpoint: BingXHistoryEndpoint,
  startTime: number,
  endTime: number,
  extraParams: Record<string, string> = {},
) {
  const chunks: unknown[] = [];

  for (let cursor = startTime; cursor < endTime; cursor += bingxHistoryWindowMs) {
    const chunkEnd = Math.min(cursor + bingxHistoryWindowMs, endTime);
    if (endpoint === "positions") {
      chunks.push(await bingxRequest<unknown>(credentials, "/openApi/swap/v1/trade/positionHistory", {
        currency: "USDT",
        pageIndex: "0",
        pageSize: extraParams.pageSize || "100",
        ...extraParams,
        startTs: String(cursor),
        endTs: String(chunkEnd),
      }));
    } else if (endpoint === "fills") {
      chunks.push(await bingxRequest<unknown>(credentials, "/openApi/swap/v2/trade/allFillOrders", {
        tradingUnit: "CONT",
        currency: "USDT",
        ...extraParams,
        startTs: String(cursor),
        endTs: String(chunkEnd),
      }));
    } else {
      chunks.push(await bingxRequest<unknown>(credentials, "/openApi/swap/v2/trade/allOrders", {
        currency: "USDT",
        limit: extraParams.limit || "500",
        ...extraParams,
        startTime: String(cursor),
        endTime: String(chunkEnd),
      }));
    }
  }

  return chunks;
}

async function collectBingXPositionHistory(
  credentials: BingXCredentials,
  symbols: string[],
  startTime: number,
  endTime: number,
) {
  const uniqueSymbols = [...new Set(symbols.map((symbol) => symbol.trim()).filter(Boolean))];
  if (!uniqueSymbols.length) return [];

  const chunks: unknown[] = [];
  for (const symbol of uniqueSymbols) {
    chunks.push(...await collectBingXHistory(credentials, "positions", startTime, endTime, { symbol }));
  }
  return chunks;
}

function extractList(value: unknown, keys: string[]) {
  if (Array.isArray(value)) return value.map(asRecord);
  const record = asRecord(value);
  for (const key of keys) {
    const nested = record[key];
    if (Array.isArray(nested)) return nested.map(asRecord);
  }
  return [];
}

function normalizeBalance(balance: unknown) {
  const record = asRecord(balance);
  const nested = asRecord(record.balance ?? record.asset ?? record);
  return asNumber(
    nested.equity ??
    nested.walletBalance ??
    nested.balance ??
    nested.availableMargin ??
    nested.availableBalance,
  );
}

function normalizePosition(position: JsonRecord): NormalizedTrade | null {
  const size = Math.abs(asNumber(position.positionAmt ?? position.positionAmtAbs ?? position.availableAmt));
  const symbol = asString(position.symbol);
  if (!symbol || size === 0) return null;

  const sideValue = asString(position.positionSide ?? position.side).toUpperCase();
  const side: "Long" | "Short" =
    sideValue === "SHORT" || asNumber(position.positionAmt) < 0 ? "Short" : "Long";
  const entry = asNumber(position.avgPrice ?? position.entryPrice);
  const exit = asNumber(position.markPrice ?? position.liquidationPrice ?? entry);
  const pnl = asNumber(position.unrealizedProfit ?? position.unrealizedPnl);
  const margin = Math.abs(asNumber(position.initialMargin ?? position.margin ?? entry * size));

  return {
    id: `position-${symbol}-${side}`,
    orderId: `position-${symbol}-${side}`,
    market: "futures",
    pair: symbol,
    side,
    opened: new Date().toISOString(),
    closedAt: new Date().toISOString(),
    durationMs: 0,
    entry,
    exit,
    size,
    pnl,
    roi: margin ? (pnl / margin) * 100 : 0,
    status: "Open",
  };
}

function normalizePositionHistory(position: JsonRecord): NormalizedTrade | null {
  const symbol = asString(position.symbol);
  const rawPositionId = asString(position.positionId ?? position.id);
  if (!symbol) return null;

  const entry = positiveNumber(position.avgPrice, position.entryPrice, position.openAvgPrice);
  const exit = positiveNumber(position.avgClosePrice, position.closeAvgPrice, position.exitPrice, position.closePrice);
  const size = positiveNumber(position.closePositionAmt, position.positionAmt, position.volume, position.quantity);
  if (!entry || !exit || !size) return null;

  const sideValue = asString(position.positionSide ?? position.side).toUpperCase();
  const side: "Long" | "Short" = sideValue === "SHORT" ? "Short" : "Long";
  const openedAt = asNumber(position.openTime ?? position.createTime ?? position.time ?? Date.now());
  const closedAt = asNumber(position.updateTime ?? position.closeTime ?? position.closedTime ?? openedAt);
  const pnl = asNumber(position.realisedProfit ?? position.realizedProfit ?? position.realisedPnl ?? position.realizedPnl ?? position.netProfit ?? position.pnl);
  const leverage = positiveNumber(position.leverage);
  const margin = Math.abs(leverage ? (entry * size) / leverage : entry * size);
  const id = closedFuturesTradeId(symbol, side, openedAt, closedAt, pnl, size, rawPositionId);

  return {
    id,
    orderId: id,
    market: "futures",
    pair: symbol,
    side,
    opened: new Date(openedAt).toISOString(),
    closedAt: new Date(closedAt).toISOString(),
    durationMs: Math.max(0, closedAt - openedAt),
    entry,
    exit,
    size,
    pnl,
    roi: margin ? (pnl / margin) * 100 : 0,
    status: "Closed",
  };
}

function normalizeOrder(order: JsonRecord): NormalizedTrade | null {
  const symbol = asString(order.symbol);
  const id = asString(order.orderId ?? order.id);
  if (!symbol || !id) return null;

  const status = asString(order.status).toUpperCase();
  if (["CANCELLED", "CANCELED", "NEW", "PENDING"].includes(status)) return null;

  const quantity = Math.abs(asNumber(order.executedQty ?? order.quantity ?? order.origQty ?? order.volume ?? order.amount));
  const entry = positiveNumber(order.entryPrice, order.openAvgPrice, order.avgOpenPrice, order.openPrice);
  const exit = positiveNumber(order.stopPrice, order.avgPrice, order.price);
  if (!entry || !exit) return null;

  const pnl = asNumber(order.profit ?? order.realizedProfit ?? order.realizedPnl);
  const margin = Math.abs(quantity * entry);
  const sideValue = asString(order.positionSide ?? order.side).toUpperCase();
  const side: "Long" | "Short" = sideValue === "SHORT" || sideValue === "SELL" ? "Short" : "Long";
  const timestamp = asNumber(order.time ?? order.updateTime ?? Date.now());
  const closeTimestamp = asNumber(order.updateTime ?? order.time ?? timestamp);
  const stableId = closedFuturesTradeId(symbol, side, timestamp, closeTimestamp, pnl, quantity);

  return {
    id: stableId,
    orderId: id,
    market: "futures",
    pair: symbol,
    side,
    opened: new Date(timestamp).toISOString(),
    closedAt: new Date(closeTimestamp).toISOString(),
    durationMs: Math.max(0, closeTimestamp - timestamp),
    entry,
    exit,
    size: quantity,
    pnl,
    roi: margin ? (pnl / margin) * 100 : 0,
    status: status === "FILLED" ? "Closed" : "Open",
  };
}

function hasRealizedPnl(trade: NormalizedTrade | null) {
  return trade !== null && Math.abs(trade.pnl) > 0.00000001;
}

function sortTrades(trades: NormalizedTrade[]) {
  return trades.sort((left, right) => Date.parse(right.opened) - Date.parse(left.opened));
}

function uniqueTrades(trades: NormalizedTrade[]) {
  const seen = new Set<string>();
  return trades.filter((trade) => {
    if (seen.has(trade.id)) return false;
    seen.add(trade.id);
    return true;
  });
}

function tradeFingerprint(trade: NormalizedTrade) {
  return [
    trade.pair,
    trade.side,
    trade.opened,
    trade.closedAt,
    trade.entry.toFixed(8),
    trade.exit.toFixed(8),
    trade.pnl.toFixed(8),
    trade.size.toFixed(8),
  ].join("|");
}

function uniqueClosedTrades(trades: NormalizedTrade[]) {
  const seenIds = new Set<string>();
  const seenFingerprints = new Set<string>();
  return trades.filter((trade) => {
    const fingerprint = tradeFingerprint(trade);
    if (seenIds.has(trade.id) || seenFingerprints.has(fingerprint)) return false;
    seenIds.add(trade.id);
    seenFingerprints.add(fingerprint);
    return true;
  });
}

function duplicateTradeFingerprints(trades: NormalizedTrade[]) {
  const byFingerprint = new Map<string, NormalizedTrade[]>();
  trades.forEach((trade) => {
    const fingerprint = tradeFingerprint(trade);
    byFingerprint.set(fingerprint, [...(byFingerprint.get(fingerprint) || []), trade]);
  });
  return [...byFingerprint.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([fingerprint, group]) => ({
      fingerprint,
      ids: group.map((trade) => trade.id),
    }));
}

function debugTradeTimestamp(trade: JsonRecord) {
  return asNumber(
    trade.closeTime ??
    trade.updateTime ??
    trade.tradeTime ??
    trade.fillTime ??
    trade.openTime ??
    trade.time ??
    trade.timestamp,
  );
}

function debugBingXTradeFields(trade: JsonRecord) {
  return {
    symbol: trade.symbol,
    side: trade.side,
    positionSide: trade.positionSide,
    avgPrice: trade.avgPrice,
    avgClosePrice: trade.avgClosePrice,
    price: trade.price,
    executedPrice: trade.executedPrice,
    closePrice: trade.closePrice,
    entryPrice: trade.entryPrice,
    exitPrice: trade.exitPrice,
    pnl: trade.pnl ?? trade.profit,
    realisedPnl: trade.realisedPnl ?? trade.realizedPnl ?? trade.realisedProfit ?? trade.realizedProfit,
    orderType: trade.orderType ?? trade.type,
    status: trade.status,
    openTime: trade.openTime ?? trade.time,
    closeTime: trade.closeTime ?? trade.updateTime,
  };
}

function logLatestBingXTrades(positionHistory: JsonRecord[], fills: JsonRecord[], orders: JsonRecord[]) {
  if (!bingxDebugEnabled) return;

  const latestTrades = [...positionHistory, ...fills, ...orders]
    .sort((left, right) => debugTradeTimestamp(right) - debugTradeTimestamp(left))
    .slice(0, 2)
    .map(debugBingXTradeFields);

  console.log("[BingX debug] latest trades", latestTrades);
}

const errorMessage = (value: unknown) =>
  value instanceof Error ? value.message : String(value || "Unknown error");

const timestampParam = (value: unknown) => {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
};

app.all("/api/dashboard", async (req, res) => {
  try {
    if (req.method !== "GET" && req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!(await verifyFirebaseToken(token))) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const credentials = resolveBingXCredentials(req.method === "POST" ? req.body : {});

    const now = Date.now();
    const requestedEnd = timestampParam(req.query.end) ?? now;
    const requestedStart = timestampParam(req.query.start);
    const historyDays = Math.max(1, Math.min(Number(req.query.days || 7), 7));
    const historyEnd = Math.min(requestedEnd, now);
    const rawHistoryStart = requestedStart ?? historyEnd - historyDays * dayMs;
    const historyStart = Math.max(rawHistoryStart, historyEnd - bingxHistoryWindowMs);
    const [balance, positions, fillsResult, ordersResult] = await Promise.allSettled([
      bingxRequest<unknown>(credentials, "/openApi/swap/v2/user/balance"),
      bingxRequest<unknown>(credentials, "/openApi/swap/v2/user/positions"),
      collectBingXHistory(credentials, "fills", historyStart, historyEnd),
      collectBingXHistory(credentials, "orders", historyStart, historyEnd),
    ]);

    if (balance.status === "rejected") throw balance.reason;
    if (positions.status === "rejected") throw positions.reason;

    const positionTrades = extractList(positions.value, ["positions", "positionList", "list"])
      .map(normalizePosition)
      .filter((trade): trade is NormalizedTrade => trade !== null);

    const rawFills = fillsResult.status === "fulfilled"
      ? fillsResult.value.flatMap((chunk) => extractList(chunk, ["fillOrders", "fill_orders", "fills", "orders", "list"]))
      : [];
    const rawOrders = ordersResult.status === "fulfilled"
      ? ordersResult.value.flatMap((chunk) => extractList(chunk, ["orders", "list"]))
      : [];
    const historySymbols = [
      ...positionTrades.map((trade) => trade.pair),
      ...rawOrders.map((order) => asString(order.symbol)),
      ...rawFills.map((fill) => asString(fill.symbol)),
    ];
    const positionHistoryResult = await Promise.allSettled([
      collectBingXPositionHistory(credentials, historySymbols, historyStart, historyEnd),
    ]);
    const rawPositionHistory = positionHistoryResult[0].status === "fulfilled"
      ? positionHistoryResult[0].value.flatMap((chunk) => extractList(chunk, ["positions", "positionHistory", "history", "list", "data"]))
      : [];
    logLatestBingXTrades(rawPositionHistory, rawFills, rawOrders);

    const positionHistoryTrades = rawPositionHistory.map(normalizePositionHistory);
    const positionHistoryClosedTrades = positionHistoryTrades
      .filter((trade): trade is NormalizedTrade => trade !== null)
      .filter((trade) => trade.size > 0);
    const dedupedPositionHistoryClosedTrades = uniqueClosedTrades(positionHistoryClosedTrades);
    const positionHistoryDuplicateFingerprints = duplicateTradeFingerprints(positionHistoryClosedTrades);
    const fallbackOrderTrades = uniqueClosedTrades(rawOrders.map(normalizeOrder).filter(hasRealizedPnl)
      .filter((trade): trade is NormalizedTrade => trade !== null)
      .filter((trade) => trade.size > 0));
    const closedTrades = positionHistoryClosedTrades.length ? dedupedPositionHistoryClosedTrades : fallbackOrderTrades;
    const positionHistoryCleanupSafe = dedupedPositionHistoryClosedTrades.length > 0;
    if (bingxDebugEnabled) {
      console.log("[BingX debug] closed trade dedup", {
        rawPositionHistoryLength: rawPositionHistory.length,
        positionHistoryTradesLength: positionHistoryTrades.length,
        positionHistoryClosedTradesLength: positionHistoryClosedTrades.length,
        closedTradesLength: closedTrades.length,
        closedTradeIds: closedTrades.map((trade) => trade.id),
        duplicateFingerprints: positionHistoryDuplicateFingerprints,
      });
    }
    const trades = sortTrades([...positionTrades, ...closedTrades]);

    res.json({
      source: "bingx",
      balance: normalizeBalance(balance.value),
      unrealizedPnl: positionTrades.reduce((sum, trade) => sum + trade.pnl, 0),
      trades: trades.slice(0, 1000),
      marketCounts: {
        futures: trades.filter((trade) => trade.market === "futures").length,
      },
      positionHistoryClosedCount: positionHistoryClosedTrades.length,
      positionHistoryUniqueClosedCount: dedupedPositionHistoryClosedTrades.length,
      positionHistoryDuplicateFingerprintCount: positionHistoryDuplicateFingerprints.length,
      positionHistoryCleanupSafe,
      syncWarnings: [
        positionHistoryResult[0].status === "rejected" ? `positionHistory недоступен: ${errorMessage(positionHistoryResult[0].reason)}. Использую fallback allOrders.` : "",
        fillsResult.status === "rejected" ? `allFillOrders недоступен: ${errorMessage(fillsResult.reason)}.` : "",
        ordersResult.status === "rejected" ? `allOrders недоступен: ${errorMessage(ordersResult.reason)}.` : "",
        positionHistoryResult[0].status === "rejected" && ordersResult.status === "rejected" && fillsResult.status === "rejected" ? "История сделок сейчас недоступна через BingX API. Открытые позиции всё равно обновляются через positions." : "",
      ].filter(Boolean),
      historyWindow: {
        start: historyStart,
        end: historyEnd,
      },
    });
  } catch (error) {
    res.status(502).json({
      error: error instanceof Error ? error.message : "Unable to load BingX data",
    });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(port, () => {
  console.log(`Trade Diary API listening on http://localhost:${port}`);
});
