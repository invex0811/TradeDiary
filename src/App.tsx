import { useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  CalendarDays,
  ChevronDown,
  CircleDollarSign,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Image,
  StickyNote,
  Search,
  Target,
  TrendingDown,
  TrendingUp,
  Wallet,
  X,
} from "lucide-react";
import { getRedirectResult, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut, type User } from "firebase/auth";
import { collection, doc, getDocs, onSnapshot, serverTimestamp, setDoc, writeBatch, type DocumentData } from "firebase/firestore";
import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { auth, db, googleProvider } from "./firebase";

type Trade = {
  id: string;
  market: "futures";
  pair: string;
  side: "Long" | "Short";
  orderId?: string;
  opened: string;
  openedAt: number;
  closedAt: number;
  durationMs: number;
  entry: number;
  exit: number;
  size: number;
  pnl: number;
  roi: number;
  status: "Closed" | "Open";
  note?: string;
  entryReason?: string;
  exitReason?: string;
  tradePlan?: string;
  tradeMistake?: string;
  tradeLesson?: string;
  screenshotDataUrl?: string;
  screenshotUrl?: string;
  screenshotUrls?: string[];
};

type DashboardResponse = {
  source: "bingx";
  balance: number;
  unrealizedPnl: number;
  trades: Array<Omit<Trade, "side" | "status"> & { side: string; status: string }>;
  marketCounts?: { futures: number };
  syncWarnings?: string[];
  historyWindow?: { start: number; end: number };
};
type CachedTrade = Omit<Trade, "opened"> & {
  source: "bingx";
  opened: string;
  syncedAt?: unknown;
};
type RawTradeInput = {
  id?: unknown;
  orderId?: unknown;
  pair?: unknown;
  side?: unknown;
  status?: unknown;
  opened?: unknown;
  openedAt?: unknown;
  closedAt?: unknown;
  durationMs?: unknown;
  entry?: unknown;
  exit?: unknown;
  size?: unknown;
  pnl?: unknown;
  roi?: unknown;
  note?: unknown;
  entryReason?: unknown;
  exitReason?: unknown;
  tradePlan?: unknown;
  tradeMistake?: unknown;
  tradeLesson?: unknown;
  screenshotDataUrl?: unknown;
  screenshotUrl?: unknown;
  screenshotUrls?: unknown;
};

type SortKey = "pair" | "side" | "opened" | "entry" | "exit" | "size" | "pnl" | "roi";
type SortDirection = "asc" | "desc";
type SideFilter = "All" | "Long" | "Short";
type ResultFilter = "All" | "Profit" | "Loss";
type MarketCategory = "Crypto" | "Forex" | "Index" | "Other";
type FilterOption<T extends string> = {
  value: T;
  label: string;
};
type AssetStats = {
  pair: string;
  category: MarketCategory;
  trades: number;
  pnl: number;
  wins: number;
  losses: number;
  volume: number;
  winRate: number;
};
type AnalyticsShape = {
  assetRows: AssetStats[];
  marketRows: Array<{ category: MarketCategory; count: number; share: number }>;
  sideCounts: { Long: number; Short: number };
  favoriteAsset?: AssetStats;
  topProfitAsset?: AssetStats;
  worstAsset?: AssetStats;
  dominantMarket?: { category: MarketCategory; count: number; share: number };
};
type StatsShape = {
  net: number;
  winRate: number;
  wins: number;
  losses: number;
  profit: number;
  loss: number;
  profitFactor: number;
};
type MarketFilter = "All" | MarketCategory;

const navItems = [
  { id: "overview", label: "Обзор", icon: LayoutDashboard, path: "/" },
  { id: "trades", label: "Сделки", icon: BookOpen, path: "/trades" },
  { id: "analytics", label: "Аналитика", icon: BarChart3, path: "/analytics" },
  { id: "calendar", label: "Календарь", icon: CalendarDays, path: "/calendar" },
];

const sideFilterOptions: FilterOption<SideFilter>[] = [
  { value: "All", label: "Все направления" },
  { value: "Long", label: "Long" },
  { value: "Short", label: "Short" },
];

const resultFilterOptions: FilterOption<ResultFilter>[] = [
  { value: "All", label: "Все результаты" },
  { value: "Profit", label: "Прибыльные" },
  { value: "Loss", label: "Убыточные" },
];

const cryptoAssets = new Set(["BTC", "ETH", "SOL", "XRP", "BNB", "DOGE", "ADA", "AVAX", "LINK", "LTC", "TRX", "TON", "DOT", "BCH", "NEAR", "APT", "ARB", "OP", "SUI", "PEPE", "WLD", "FIL", "INJ", "SEI", "TIA", "ENA", "ORDI", "WIF", "FET", "ICP", "UNI", "AAVE", "MKR", "ETC", "ATOM", "ALGO", "APE", "GALA", "LDO", "MATIC", "POL"]);
const fiatCodes = new Set(["EUR", "USD", "GBP", "JPY", "AUD", "NZD", "CAD", "CHF", "CNH", "HKD", "SGD", "MXN", "ZAR", "TRY", "SEK", "NOK", "DKK", "PLN"]);
const stableQuotes = new Set(["USDT", "USDC", "BUSD", "FDUSD", "TUSD", "DAI"]);
const apiBaseUrl = String(import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

const formatMoney = (value: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
const formatSignedMoney = (value: number) => `${value >= 0 ? "+" : ""}${formatMoney(value)}`;
const formatNumber = (value: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 8 }).format(value);
const displayPercent = (value: number) =>
  `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
const formatAxisMoney = (value: number) => {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}m`;
  if (absolute >= 10_000) return `$${Math.round(value / 1_000)}k`;
  if (absolute >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  if (absolute >= 10) return `$${Math.round(value)}`;
  return `$${value.toFixed(2)}`;
};
const formatDuration = (durationMs: number) => {
  if (!durationMs || durationMs <= 0) return "Нет данных";
  const totalMinutes = Math.max(1, Math.round(durationMs / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}д ${hours}ч`;
  if (hours > 0) return `${hours}ч ${minutes}м`;
  return `${minutes}м`;
};
const localDayKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
const dayKey = (timestamp: number) => localDayKey(new Date(timestamp));
const dateFromDayKey = (key: string) => {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
};
const formatDayLabel = (key: string) => new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short" }).format(dateFromDayKey(key));
const formatOpened = (openedAt: number) => new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(new Date(openedAt));
const timestampToMillis = (value: unknown) => {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === "object" && value !== null) {
    const record = value as { seconds?: unknown; toMillis?: unknown };
    if (typeof record.toMillis === "function") return record.toMillis();
    if (typeof record.seconds === "number") return record.seconds * 1000;
  }
  return null;
};
const formatLastSync = (lastSyncAt: number | null, isLoading: boolean) => {
  if (isLoading) return "Последняя синхронизация: сейчас";
  if (!lastSyncAt) return "Последняя синхронизация: ещё не было";
  const formatted = new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(new Date(lastSyncAt));
  return `Последняя синхронизация: ${formatted}`;
};
const bingxStorageKey = (uid: string) => `trade-diary:bingx:${uid}`;
const loadBingXCredentials = (uid: string) => {
  try {
    const parsed = JSON.parse(localStorage.getItem(bingxStorageKey(uid)) || "{}") as { apiKey?: unknown; secretKey?: unknown };
    return {
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
      secretKey: typeof parsed.secretKey === "string" ? parsed.secretKey : "",
    };
  } catch {
    return { apiKey: "", secretKey: "" };
  }
};
const normalizeTradingViewUrl = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    if (url.hostname !== "www.tradingview.com" && url.hostname !== "tradingview.com") return "";
    const match = url.pathname.match(/^\/x\/([A-Za-z0-9]+)\/?$/);
    return match ? `https://www.tradingview.com/x/${match[1]}/` : "";
  } catch {
    return "";
  }
};
const tradingViewPreviewUrl = (value: string) => {
  const normalized = normalizeTradingViewUrl(value);
  const match = normalized.match(/\/x\/([A-Za-z0-9]+)\//);
  if (!match) return "";
  const id = match[1];
  return `https://s3.tradingview.com/snapshots/${id[0].toLowerCase()}/${id}.png`;
};
const normalizeTradingViewUrls = (value: unknown, fallback = "") => {
  const values = Array.isArray(value) ? value : [];
  const normalized = values
    .map((item) => normalizeTradingViewUrl(String(item ?? "")))
    .filter(Boolean);
  const fallbackUrl = normalizeTradingViewUrl(fallback);
  const unique = new Set([fallbackUrl, ...normalized].filter(Boolean));
  return [...unique];
};
const extractBingXCooldownUntil = (messages: string[]) => {
  const timestamps = messages
    .map((message) => message.match(/unblocked after (\d{13})/)?.[1])
    .filter((value): value is string => Boolean(value))
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > Date.now());
  return timestamps.length ? Math.max(...timestamps) : null;
};
const formatCooldown = (timestamp: number) =>
  new Intl.DateTimeFormat("ru-RU", { timeStyle: "short" }).format(new Date(timestamp));
const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
const isMobileAuthBrowser = () =>
  /Android|iPhone|iPad|iPod|Mobile|CriOS|FxiOS|EdgiOS/i.test(navigator.userAgent);
const normalizeTrade = (trade: RawTradeInput): Trade => {
  const openedAt = Number(trade.openedAt ?? Date.parse(String(trade.opened || Date.now())));
  const closedAt = Number(
    typeof trade.closedAt === "string"
      ? Date.parse(trade.closedAt)
      : trade.closedAt ?? openedAt,
  );
  return {
    id: String(trade.id || `${trade.pair}-${openedAt}`),
    orderId: trade.orderId ? String(trade.orderId) : undefined,
    market: "futures",
    pair: String(trade.pair || "UNKNOWN"),
    side: trade.side === "Short" ? "Short" : "Long",
    opened: formatOpened(openedAt),
    openedAt,
    closedAt: Number.isFinite(closedAt) ? closedAt : openedAt,
    durationMs: Number(trade.durationMs || 0),
    entry: Number(trade.entry || 0),
    exit: Number(trade.exit || 0),
    size: Number(trade.size || 0),
    pnl: Number(trade.pnl || 0),
    roi: Number(trade.roi || 0),
    status: trade.status === "Open" ? "Open" : "Closed",
    note: typeof trade.note === "string" ? trade.note : "",
    entryReason: typeof trade.entryReason === "string" ? trade.entryReason : "",
    exitReason: typeof trade.exitReason === "string" ? trade.exitReason : "",
    tradePlan: typeof trade.tradePlan === "string" ? trade.tradePlan : "",
    tradeMistake: typeof trade.tradeMistake === "string" ? trade.tradeMistake : "",
    tradeLesson: typeof trade.tradeLesson === "string" ? trade.tradeLesson : "",
    screenshotDataUrl: typeof trade.screenshotDataUrl === "string" ? trade.screenshotDataUrl : "",
    screenshotUrl: typeof trade.screenshotUrl === "string" ? trade.screenshotUrl : "",
    screenshotUrls: normalizeTradingViewUrls(trade.screenshotUrls, typeof trade.screenshotUrl === "string" ? trade.screenshotUrl : ""),
  };
};
const tradeFromFirestore = (data: DocumentData): Trade => normalizeTrade(data as CachedTrade);
const splitSymbol = (pair: string) => {
  const normalized = pair.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const cleaned = normalized.replace(/(PERP|SWAP|FUTURES?)$/i, "");
  for (const quote of [...stableQuotes, ...fiatCodes].sort((left, right) => right.length - left.length)) {
    if (cleaned.endsWith(quote) && cleaned.length > quote.length) {
      return { base: cleaned.slice(0, -quote.length).replace(/^\d+/, ""), quote };
    }
  }
  const separated = pair.toUpperCase().split(/[-_/]/).filter(Boolean);
  return { base: separated[0] || cleaned, quote: separated[1] || "" };
};
const baseAsset = (pair: string) => splitSymbol(pair).base;
const normalizeSyntheticBase = (base: string) => {
  const withoutPrefix = base
    .replace(/^NCFX/i, "")
    .replace(/^NCF/i, "")
    .replace(/^NCCO/i, "")
    .replace(/^NC/i, "");
  return withoutPrefix.replace(/\d+/g, "");
};
const classifyMarket = (pair: string): MarketCategory => {
  const normalized = pair.replace(/[-_/]/g, "").toUpperCase();
  const { base, quote } = splitSymbol(pair);
  const syntheticBase = normalizeSyntheticBase(base);
  if (syntheticBase.includes("NAS") || syntheticBase.includes("SPX") || syntheticBase.includes("DOW") || syntheticBase.includes("GER") || syntheticBase.includes("HK")) return "Index";
  if (syntheticBase.length >= 6 && fiatCodes.has(syntheticBase.slice(0, 3)) && fiatCodes.has(syntheticBase.slice(3, 6))) return "Forex";
  if (fiatCodes.has(base) && fiatCodes.has(quote)) return "Forex";
  if (normalized.length >= 6 && fiatCodes.has(normalized.slice(0, 3)) && fiatCodes.has(normalized.slice(3, 6))) return "Forex";
  if (stableQuotes.has(quote) && !base.startsWith("NC")) return "Crypto";
  if (cryptoAssets.has(base) || cryptoAssets.has(syntheticBase)) return "Crypto";
  return "Other";
};
const calculateStats = (trades: Trade[]): StatsShape => {
  const profit = trades.filter((trade) => trade.pnl > 0).reduce((sum, trade) => sum + trade.pnl, 0);
  const loss = trades.filter((trade) => trade.pnl < 0).reduce((sum, trade) => sum + trade.pnl, 0);
  const wins = trades.filter((trade) => trade.pnl > 0).length;
  const losses = trades.filter((trade) => trade.pnl < 0).length;
  const winRate = trades.length ? (wins / trades.length) * 100 : 0;
  const profitFactor = Math.abs(loss) > 0 ? profit / Math.abs(loss) : profit > 0 ? profit : 0;
  return { net: profit + loss, winRate, wins, losses, profit, loss, profitFactor };
};
const buildAnalytics = (trades: Trade[]): AnalyticsShape => {
  const assets = new Map<string, AssetStats>();
  const marketCounts = new Map<MarketCategory, number>();
  const sideCounts = { Long: 0, Short: 0 };

  for (const trade of trades) {
    const pair = trade.pair || "UNKNOWN";
    const category = classifyMarket(pair);
    const current = assets.get(pair) || {
      pair,
      category,
      trades: 0,
      pnl: 0,
      wins: 0,
      losses: 0,
      volume: 0,
      winRate: 0,
    };
    current.trades += 1;
    current.pnl += trade.pnl;
    current.volume += Math.abs(trade.size * trade.entry);
    current.wins += trade.pnl > 0 ? 1 : 0;
    current.losses += trade.pnl < 0 ? 1 : 0;
    current.winRate = current.trades ? (current.wins / current.trades) * 100 : 0;
    assets.set(pair, current);
    marketCounts.set(category, (marketCounts.get(category) || 0) + 1);
    sideCounts[trade.side] += 1;
  }

  const assetRows = [...assets.values()].sort((left, right) => right.trades - left.trades);
  const marketRows = [...marketCounts.entries()]
    .map(([category, count]) => ({ category, count, share: trades.length ? (count / trades.length) * 100 : 0 }))
    .sort((left, right) => right.count - left.count);

  return {
    assetRows,
    marketRows,
    sideCounts,
    favoriteAsset: assetRows[0],
    topProfitAsset: [...assetRows].sort((left, right) => right.pnl - left.pnl)[0],
    worstAsset: [...assetRows].sort((left, right) => left.pnl - right.pnl)[0],
    dominantMarket: marketRows[0],
  };
};

function App() {
  const location = useLocation();
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [syncState, setSyncState] = useState<"empty" | "loading" | "bingx" | "error">("loading");
  const [dataReady, setDataReady] = useState(false);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [balance, setBalance] = useState(0);
  const [syncMessage, setSyncMessage] = useState("Загружаю данные");
  const [syncWarnings, setSyncWarnings] = useState<string[]>([]);
  const [syncCooldownUntil, setSyncCooldownUntil] = useState<number | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [loginState, setLoginState] = useState<"idle" | "loading">("idle");
  const [loginMessage, setLoginMessage] = useState("");
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [bingxModalOpen, setBingxModalOpen] = useState(false);
  const [bingxApiKey, setBingxApiKey] = useState("");
  const [bingxSecretKey, setBingxSecretKey] = useState("");
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const hasBingXCredentials = Boolean(bingxApiKey.trim() && bingxSecretKey.trim());
  const syncBlockedByCooldown = Boolean(syncCooldownUntil && syncCooldownUntil > Date.now());

  const saveDashboardData = async (data: DashboardResponse, deleteMissingOpen: boolean) => {
    if (!user) return [];
    setBalance(data.balance);
    const normalizedTrades = data.trades.map((trade) => normalizeTrade(trade));
    const batch = writeBatch(db);
    const tradesRef = collection(db, "users", user.uid, "trades");
    const existingTrades = await getDocs(tradesRef);
    const existingTradeData = new Map(existingTrades.docs.map((document) => [document.id, document.data() as Partial<CachedTrade>]));
    const incomingTradeIds = new Set(normalizedTrades.map((trade) => trade.id));
    if (deleteMissingOpen) {
      existingTrades.forEach((document) => {
        const data = document.data() as Partial<CachedTrade>;
        if (data.status === "Open" && !incomingTradeIds.has(document.id)) {
          batch.delete(document.ref);
        }
      });
    }
    existingTrades.forEach((document) => {
      const data = document.data() as Partial<CachedTrade>;
      const id = String(data.id || document.id);
      const staleBingXHistoryTrade =
        data.source === "bingx" &&
        data.market === "futures" &&
        data.status === "Closed" &&
        (id.startsWith("futures-fill-") || id.startsWith("futures-order-") || Number(data.exit || 0) === 0);

      if (staleBingXHistoryTrade) {
        batch.delete(document.ref);
      }
    });
    normalizedTrades.forEach((trade) => {
      const ref = doc(db, "users", user.uid, "trades", trade.id);
      const manualFields = existingTradeData.get(trade.id);
      batch.set(ref, {
        ...trade,
        note: typeof manualFields?.note === "string" ? manualFields.note : trade.note,
        entryReason: typeof manualFields?.entryReason === "string" ? manualFields.entryReason : trade.entryReason,
        exitReason: typeof manualFields?.exitReason === "string" ? manualFields.exitReason : trade.exitReason,
        tradePlan: typeof manualFields?.tradePlan === "string" ? manualFields.tradePlan : trade.tradePlan,
        tradeMistake: typeof manualFields?.tradeMistake === "string" ? manualFields.tradeMistake : trade.tradeMistake,
        tradeLesson: typeof manualFields?.tradeLesson === "string" ? manualFields.tradeLesson : trade.tradeLesson,
        screenshotDataUrl: typeof manualFields?.screenshotDataUrl === "string" ? manualFields.screenshotDataUrl : trade.screenshotDataUrl,
        screenshotUrl: typeof manualFields?.screenshotUrl === "string" ? manualFields.screenshotUrl : trade.screenshotUrl,
        screenshotUrls: Array.isArray(manualFields?.screenshotUrls) ? manualFields.screenshotUrls : trade.screenshotUrls,
        source: "bingx",
        syncedAt: serverTimestamp(),
      } satisfies CachedTrade, { merge: true });
    });
    const metaRef = doc(db, "users", user.uid, "meta", "bingx");
    batch.set(metaRef, {
      lastSyncAt: serverTimestamp(),
      balance: data.balance,
      marketCounts: data.marketCounts || { futures: normalizedTrades.length },
      lastHistoryWindow: data.historyWindow || null,
    }, { merge: true });
    await batch.commit();
    setLastSyncAt(Date.now());
    return normalizedTrades;
  };

  useEffect(() => onAuthStateChanged(auth, (nextUser) => {
    setUser(nextUser);
    setAuthReady(true);
  }), []);

  useEffect(() => {
    getRedirectResult(auth)
      .catch((error) => {
        setLoginMessage(error instanceof Error ? error.message : "Не удалось завершить вход через Google");
      })
      .finally(() => setLoginState("idle"));
  }, []);

  const signInWithGoogle = async () => {
    setLoginMessage("");
    setLoginState("loading");
    try {
      if (isMobileAuthBrowser()) {
        await signInWithRedirect(auth, googleProvider);
        return;
      }
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : "";
      if (code.includes("popup") || code.includes("operation-not-supported")) {
        await signInWithRedirect(auth, googleProvider);
        return;
      }
      setLoginMessage(error instanceof Error ? error.message : "Не удалось войти через Google");
    } finally {
      setLoginState("idle");
    }
  };

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!profileMenuRef.current?.contains(event.target as Node)) {
        setProfileMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  useEffect(() => {
    if (!user) return;
    const credentials = loadBingXCredentials(user.uid);
    setBingxApiKey(credentials.apiKey);
    setBingxSecretKey(credentials.secretKey);
  }, [user]);

  const saveBingXCredentials = () => {
    if (!user) return;
    localStorage.setItem(bingxStorageKey(user.uid), JSON.stringify({
      apiKey: bingxApiKey.trim(),
      secretKey: bingxSecretKey.trim(),
    }));
    setBingxModalOpen(false);
    setSyncMessage("BingX ключи сохранены в этом браузере");
  };

  const syncBingX = async () => {
    if (!user) return;
    if (syncBlockedByCooldown && syncCooldownUntil) {
      setSyncMessage(`BingX history API разблокируется в ${formatCooldown(syncCooldownUntil)}`);
      return;
    }
    if (!hasBingXCredentials) {
      setBingxModalOpen(true);
      setSyncMessage("Подключи BingX API ключи для синхронизации");
      return;
    }
    setSyncState("loading");
    try {
      const token = await user.getIdToken();
      const response = await fetch(`${apiBaseUrl}/api/dashboard?days=7`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          bingxApiKey: bingxApiKey.trim(),
          bingxSecretKey: bingxSecretKey.trim(),
        }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "sync failed" }));
        throw new Error(String(errorData.error || "sync failed"));
      }
      const data = await response.json() as DashboardResponse;
      const normalizedTrades = await saveDashboardData(data, true);
      setSyncWarnings(data.syncWarnings || []);
      setSyncCooldownUntil(extractBingXCooldownUntil(data.syncWarnings || []));
      setSyncMessage(normalizedTrades.length ? `Обновлено из BingX: ${normalizedTrades.length}` : "BingX подключён, новых сделок API не отдал");
      setSyncState(normalizedTrades.length ? "bingx" : "empty");
    } catch (error) {
      setSyncMessage(error instanceof Error ? error.message : "Ошибка подключения BingX");
      setSyncState("error");
    }
  };

  const syncBingXHistory = async () => {
    if (!user) return;
    if (syncBlockedByCooldown && syncCooldownUntil) {
      setSyncMessage(`BingX history API разблокируется в ${formatCooldown(syncCooldownUntil)}`);
      return;
    }
    if (!hasBingXCredentials) {
      setBingxModalOpen(true);
      setSyncMessage("Подключи BingX API ключи для загрузки истории");
      return;
    }
    setSyncState("loading");
    setSyncWarnings([]);
    try {
      const token = await user.getIdToken();
      const windowMs = 7 * 24 * 60 * 60 * 1000 - 60_000;
      const windowsToLoad = 26;
      let totalTrades = 0;
      const warnings: string[] = [];

      for (let index = 0; index < windowsToLoad; index += 1) {
        const end = Date.now() - index * windowMs;
        const start = end - windowMs;
        setSyncMessage(`Загружаю историю BingX: окно ${index + 1}/${windowsToLoad}`);
        const response = await fetch(`${apiBaseUrl}/api/dashboard?start=${start}&end=${end}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            bingxApiKey: bingxApiKey.trim(),
            bingxSecretKey: bingxSecretKey.trim(),
          }),
        });
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: "history sync failed" }));
          throw new Error(String(errorData.error || "history sync failed"));
        }
        const data = await response.json() as DashboardResponse;
        const normalizedTrades = await saveDashboardData(data, false);
        totalTrades += normalizedTrades.filter((trade) => trade.status === "Closed").length;
        warnings.push(...(data.syncWarnings || []));
        const cooldownUntil = extractBingXCooldownUntil(warnings);
        if (cooldownUntil) {
          setSyncCooldownUntil(cooldownUntil);
          break;
        }
        await wait(1300);
      }

      setSyncWarnings(warnings);
      setSyncCooldownUntil(extractBingXCooldownUntil(warnings));
      setSyncMessage(totalTrades ? `История BingX загружена: ${totalTrades} записей` : "История BingX загружена, новых закрытых сделок API не отдал");
      setSyncState(totalTrades ? "bingx" : "empty");
    } catch (error) {
      setSyncMessage(error instanceof Error ? error.message : "Ошибка загрузки истории BingX");
      setSyncState("error");
    }
  };

  useEffect(() => {
    if (!user) {
      setDataReady(false);
      setTrades([]);
      setBalance(0);
      setSyncState("loading");
      setSyncMessage("Загружаю данные");
      return;
    }
    setDataReady(false);
    setSyncState("loading");
    setSyncMessage("Загружаю данные");
    const tradesRef = collection(db, "users", user.uid, "trades");
    const metaRef = doc(db, "users", user.uid, "meta", "bingx");
    const unsubscribe = onSnapshot(
      tradesRef,
      (snapshot) => {
        const cachedTrades = snapshot.docs
          .map((document) => tradeFromFirestore({ id: document.id, ...document.data() }))
          .sort((left, right) => right.openedAt - left.openedAt);
        setTrades(cachedTrades);
        setDataReady(true);
        setSyncMessage(cachedTrades.length ? `Firestore cache: ${cachedTrades.length} сделок` : "Сделок пока нет. Синхронизируй BingX или проверь доступ API.");
        setSyncState(cachedTrades.length ? "bingx" : "empty");
      },
      (error) => {
        setDataReady(true);
        setSyncMessage(`Firestore: ${error.message}`);
        setSyncState("error");
      },
    );
    const unsubscribeMeta = onSnapshot(metaRef, (snapshot) => {
      const data = snapshot.data();
      const cachedBalance = Number(data?.balance);
      if (Number.isFinite(cachedBalance) && cachedBalance > 0) {
        setBalance(cachedBalance);
      }
      setLastSyncAt(timestampToMillis(data?.lastSyncAt));
    });
    return () => {
      unsubscribe();
      unsubscribeMeta();
    };
  }, [user]);

  const stats = useMemo(() => calculateStats(trades), [trades]);
  const closedTradesCount = useMemo(() => trades.filter((trade) => trade.status === "Closed").length, [trades]);

  const futuresTrades = useMemo(() => trades.filter((trade) => trade.market === "futures"), [trades]);

  const analytics = useMemo(() => buildAnalytics(futuresTrades), [futuresTrades]);

  const equityData = useMemo(() => {
    const closedTrades = trades
      .filter((trade) => trade.status === "Closed")
      .slice()
      .reverse();
    let runningBalance = balance - closedTrades.reduce((sum, trade) => sum + trade.pnl, 0);
    const points = closedTrades.map((trade) => {
      runningBalance += trade.pnl;
      return {
        date: trade.opened.split(",")[0],
        equity: Number(runningBalance.toFixed(2)),
        pnl: trade.pnl,
      };
    });
    return points.length ? points : [{ date: "Сегодня", equity: balance, pnl: 0 }];
  }, [balance, trades]);

  const pageMeta = useMemo(() => {
    if (location.pathname === "/analytics") {
      return { eyebrow: "Аналитика", title: "Разбор торговли", subtitle: "Смотри, где ты торгуешь чаще и где результат лучше." };
    }
    if (location.pathname === "/calendar") {
      return { eyebrow: "Календарь", title: "Торговый календарь", subtitle: "Смотри статистику каждого дня и длительность удержания сделок." };
    }
    if (location.pathname === "/trades") {
      return { eyebrow: "Сделки", title: "История futures-сделок", subtitle: "Фильтруй и сортируй торговую активность." };
    }
    return { eyebrow: "Панель управления", title: "Обзор торговли", subtitle: "Следи за результатами и улучшай свою систему." };
  }, [location.pathname]);

  if (!authReady) return <div className="splash">Trade Diary</div>;

  if (!user) {
    return (
      <main className="login-page">
        <div className="login-orb login-orb-one" />
        <div className="login-orb login-orb-two" />
        <section className="login-card">
          <div className="brand-mark"><TrendingUp size={22} /></div>
          <p className="eyebrow">BingX analytics workspace</p>
          <h1>Твой трейдинг.<br /><span>Без самообмана.</span></h1>
          <p className="login-copy">Автоматический дневник сделок, статистика и аналитика результатов в одном тёмном интерфейсе.</p>
          <button className="google-button" onClick={() => void signInWithGoogle()} disabled={loginState === "loading"}>
            <span className="google-g">G</span>
            {loginState === "loading" ? "Открываю Google..." : "Войти через Google"}
          </button>
          {loginMessage && <p className="login-error">{loginMessage}</p>}
          <p className="login-note">Данные BingX доступны только после авторизации.</p>
        </section>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-head">
          <div className="brand-mark"><TrendingUp size={20} /></div>
          <strong>Trade Diary</strong>
          <button className="icon-button mobile-only" onClick={() => setSidebarOpen(false)}><X size={18} /></button>
        </div>
        <nav>
          <span className="nav-caption">МЕНЮ</span>
          {navItems.map(({ id, label, icon: Icon, path }) => (
            <NavLink
              className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
              end={path === "/"}
              to={path || "#"}
              key={label}
            >
              <Icon size={18} /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="profile-menu-wrap" ref={profileMenuRef}>
            <button className="profile" onClick={() => setProfileMenuOpen((open) => !open)}>
              {user.photoURL ? <img src={user.photoURL} alt="" /> : <span className="avatar-fallback">{user.displayName?.[0]}</span>}
              <div><strong>{user.displayName || "Трейдер"}</strong><small>{user.email}</small></div>
              <ChevronDown className={`profile-chevron ${profileMenuOpen ? "open" : ""}`} size={16} />
            </button>
            {profileMenuOpen && (
              <div className="profile-menu">
                <div className="profile-menu-status">
                  <span className={`sync-dot ${syncState}`} />
                  <div>
                    <strong>{syncState === "bingx" ? "Данные подключены" : syncState === "error" ? "Ошибка синхронизации" : syncState === "loading" ? "Загрузка данных" : "Данных нет"}</strong>
                    <small>{syncState === "loading" ? "Загружаю сделки..." : syncMessage}</small>
                    <small className="last-sync-line">{formatLastSync(lastSyncAt, syncState === "loading")}</small>
                  </div>
                </div>
                <button className="profile-menu-action" onClick={() => setBingxModalOpen(true)}>
                  <KeyRound size={16} /> {hasBingXCredentials ? "Обновить BingX ключи" : "Подключить BingX"}
                </button>
                <button className="profile-menu-action" onClick={() => void syncBingX()} disabled={syncState === "loading" || syncBlockedByCooldown}>
                  <Activity size={16} /> {syncState === "loading" ? "Синхронизирую..." : syncBlockedByCooldown && syncCooldownUntil ? `Пауза до ${formatCooldown(syncCooldownUntil)}` : "Синхронизировать BingX"}
                </button>
                <button className="profile-menu-action" onClick={() => void syncBingXHistory()} disabled={syncState === "loading" || syncBlockedByCooldown}>
                  <CalendarDays size={16} /> Загрузить историю 180 дней
                </button>
                <button className="profile-menu-action danger" onClick={() => signOut(auth)}>
                  <LogOut size={16} /> Выйти из аккаунта
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      <main className="dashboard">
        <header className="topbar">
          <button className="icon-button mobile-only" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button>
          <div className="topbar-summary" aria-label="Краткая сводка">
            <div className="topbar-summary-item compact">
              <span>Всего</span>
              <strong>{trades.length}</strong>
            </div>
            <div className="topbar-summary-item compact">
              <span>Закрыто</span>
              <strong>{closedTradesCount}</strong>
            </div>
            <div className="topbar-summary-item compact">
              <span>PnL</span>
              <strong className={stats.net >= 0 ? "positive" : "negative"}>{formatSignedMoney(stats.net)}</strong>
            </div>
          </div>
        </header>

        <section className="content">
          <div className="page-heading">
            <div><p className="eyebrow">{pageMeta.eyebrow}</p><h2>{pageMeta.title}</h2><p>{pageMeta.subtitle}</p></div>
          </div>

          {syncState === "loading" && dataReady && <div className="loading-banner"><span className="loading-spinner" /> Обновляю сделки из BingX...</div>}
          {syncBlockedByCooldown && syncCooldownUntil && <div className="alert-panel warning">BingX временно заблокировал историю из-за частых запросов. Следующая попытка после {formatCooldown(syncCooldownUntil)}.</div>}
          {syncState === "error" && <div className="alert-panel">BingX не подключился: {syncMessage}. Проверь `.env`, права ключа и IP whitelist.</div>}
          {syncWarnings.map((warning) => <div className="alert-panel warning" key={warning}>{warning}</div>)}

          {!dataReady ? (
            <LoadingState />
          ) : (
            <Routes>
              <Route
                path="/"
                element={
                  <OverviewPage
                    userId={user.uid}
                    balance={balance}
                    stats={stats}
                    trades={trades}
                    futuresTrades={futuresTrades}
                    equityData={equityData}
                  />
                }
              />
              <Route
                path="/trades"
                element={
                  <TradesPage userId={user.uid} trades={futuresTrades} />
                }
              />
              <Route
                path="/analytics"
                element={<AnalyticsPage trades={futuresTrades} analytics={analytics} stats={stats} />}
              />
              <Route
                path="/calendar"
                element={<CalendarPage trades={futuresTrades} />}
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          )}
        </section>
      </main>
      {bingxModalOpen && (
        <div className="modal-backdrop" onClick={() => setBingxModalOpen(false)}>
          <section className="settings-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <PanelTitle title="Подключение BingX" subtitle="Ключи хранятся только в этом браузере и отправляются на backend только во время синхронизации" />
              <button className="modal-close" onClick={() => setBingxModalOpen(false)} aria-label="Закрыть окно">×</button>
            </div>
            <div className="settings-form">
              <label>
                <span>API Key</span>
                <input value={bingxApiKey} onChange={(event) => setBingxApiKey(event.target.value)} placeholder="BingX API Key" />
              </label>
              <label>
                <span>Secret Key</span>
                <input value={bingxSecretKey} onChange={(event) => setBingxSecretKey(event.target.value)} placeholder="BingX Secret Key" type="password" />
              </label>
              <p>Создавай ключ read-only, без торговли и вывода средств. Если включён IP whitelist, добавь outbound IP Railway.</p>
              <div className="settings-actions">
                <button className="profile-menu-action" onClick={saveBingXCredentials} disabled={!bingxApiKey.trim() || !bingxSecretKey.trim()}>
                  <KeyRound size={16} /> Сохранить ключи
                </button>
                <button className="profile-menu-action" onClick={() => {
                  if (!user) return;
                  localStorage.removeItem(bingxStorageKey(user.uid));
                  setBingxApiKey("");
                  setBingxSecretKey("");
                  setSyncMessage("BingX ключи удалены из этого браузера");
                }}>
                  Удалить ключи
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function MetricCard({ title, value, delta, icon: Icon, tone }: { title: string; value: string; delta?: string; icon: typeof Wallet; tone: string }) {
  const isNegative = Boolean(delta?.trim().startsWith("-"));
  const DeltaIcon = isNegative ? ArrowDownRight : ArrowUpRight;
  return <article className="metric-card"><div className={`metric-icon ${tone}`}><Icon size={19} /></div><p>{title}</p><strong>{value}</strong>{delta && <span className={`metric-delta ${isNegative ? "negative-delta" : ""}`}><DeltaIcon size={13} />{delta}</span>}</article>;
}

function PanelTitle({ title, subtitle, action }: { title: string; subtitle: string; action?: string }) {
  return <div className="panel-title"><div><h3>{title}</h3><p>{subtitle}</p></div>{action && <button>{action}</button>}</div>;
}

function LoadingState() {
  return (
    <section className="panel loading-state">
      <span className="loading-spinner" />
      <strong>Загружаю сделки</strong>
      <p>Проверяю сохранённые данные Firestore. Если сделок нет, здесь появится честное пустое состояние.</p>
    </section>
  );
}

function OverviewPage({ userId, balance, stats, trades, futuresTrades, equityData }: { userId: string; balance: number; stats: { net: number; winRate: number; wins: number; profitFactor: number; profit: number; losses: number }; trades: Trade[]; futuresTrades: Trade[]; equityData: Array<{ date: string; equity: number; pnl: number }> }) {
  const openTrades = futuresTrades.filter((trade) => trade.status === "Open");
  return (
    <>
      <StatsGrid balance={balance} stats={stats} tradesCount={trades.length} />
      <OverviewCharts equityData={equityData} stats={stats} />
      {openTrades.length > 0 && (
        <TradeTable
          userId={userId}
          title="Открытые сделки"
          subtitle="Позиции, которые BingX отдаёт прямо сейчас через positions"
          trades={openTrades}
          emptyMessage="Открытых сделок сейчас нет."
        />
      )}
      <TradeTable
        userId={userId}
        title="Futures сделки"
        subtitle="Perpetual Swap: позиции, fill history и order history"
        trades={futuresTrades}
        emptyMessage="Сделок пока нет. Синхронизируй BingX или проверь, отдаёт ли API историю Perpetual Swap."
      />
    </>
  );
}

function TradesPage({ userId, trades }: { userId: string; trades: Trade[] }) {
  const openTrades = trades.filter((trade) => trade.status === "Open");
  const historyTrades = trades.filter((trade) => trade.status === "Closed");
  return (
    <>
      <TradeTable
        userId={userId}
        title="Открытые сделки"
        subtitle="Текущие позиции BingX. После закрытия они попадут в историю."
        trades={openTrades}
        emptyMessage="Открытых сделок сейчас нет."
      />
      <TradeTable
        userId={userId}
        title="История futures-сделок"
        subtitle="Закрытые Perpetual Swap сделки из fill history и order history"
        trades={historyTrades}
        emptyMessage="Закрытых сделок пока нет. Синхронизируй BingX или проверь, отдаёт ли API историю Perpetual Swap."
        filterable
      />
    </>
  );
}

function StatsGrid({ balance, stats, tradesCount }: { balance: number; stats: { net: number; winRate: number; wins: number; profitFactor: number; profit: number }; tradesCount: number }) {
  return (
    <div className="stats-grid">
      <MetricCard title="Баланс аккаунта" value={formatMoney(balance)} icon={Wallet} tone="purple" />
      <MetricCard title="Чистая прибыль" value={formatMoney(stats.net)} icon={CircleDollarSign} tone="green" />
      <MetricCard title="Win rate" value={`${stats.winRate.toFixed(1)}%`} icon={Target} tone="blue" />
      <MetricCard title="Profit factor" value={stats.profitFactor.toFixed(2)} icon={TrendingUp} tone="orange" />
    </div>
  );
}

function OverviewCharts({ equityData, stats }: { equityData: Array<{ date: string; equity: number; pnl: number }>; stats: { wins: number; losses: number; winRate: number } }) {
  return (
    <div className="analytics-grid">
      <section className="panel equity-panel">
        <PanelTitle title="Кривая капитала" subtitle="Изменение баланса за последние 30 дней" />
        <div className="chart-wrap">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={equityData}>
              <defs>
                <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.42} />
                  <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#202431" vertical={false} />
              <XAxis dataKey="date" stroke="#71788c" axisLine={false} tickLine={false} fontSize={12} />
              <YAxis stroke="#71788c" axisLine={false} tickLine={false} fontSize={12} tickFormatter={(v) => formatAxisMoney(Number(v))} width={58} domain={["dataMin", "dataMax"]} />
              <Tooltip contentStyle={{ background: "#151822", border: "1px solid #2a2f3e", borderRadius: 12 }} formatter={(v) => formatMoney(Number(v))} />
              <Area type="monotone" dataKey="equity" stroke="#9b72ff" strokeWidth={2.5} fill="url(#equityFill)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="panel winrate-panel">
        <PanelTitle title="Результаты сделок" subtitle="Соотношение прибыльных и убыточных" />
        <div className="donut-wrap">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={[{ name: "Прибыльные", value: stats.wins || 1 }, { name: "Убыточные", value: stats.losses || 1 }]} innerRadius={72} outerRadius={94} paddingAngle={4} dataKey="value" stroke="none">
                <Cell fill="#22c55e" /><Cell fill="#ef476f" />
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="donut-center"><strong>{stats.winRate.toFixed(0)}%</strong><span>Win rate</span></div>
        </div>
        <div className="legend"><span><i className="green" />Прибыльные <b>{stats.wins}</b></span><span><i className="red" />Убыточные <b>{stats.losses}</b></span></div>
      </section>
    </div>
  );
}

function AnalyticsPage({ trades, analytics, stats }: { trades: Trade[]; analytics: AnalyticsShape; stats: StatsShape }) {
  const [marketFilter, setMarketFilter] = useState<MarketFilter>("All");
  const marketOptions = useMemo(() => {
    const availableMarkets = analytics.marketRows.map((row) => row.category);
    return ["All", ...availableMarkets] as MarketFilter[];
  }, [analytics.marketRows]);
  const filteredTrades = useMemo(
    () => marketFilter === "All" ? trades : trades.filter((trade) => classifyMarket(trade.pair) === marketFilter),
    [marketFilter, trades],
  );
  const viewAnalytics = useMemo(() => marketFilter === "All" ? analytics : buildAnalytics(filteredTrades), [analytics, filteredTrades, marketFilter]);
  const viewStats = useMemo(() => marketFilter === "All" ? stats : calculateStats(filteredTrades), [filteredTrades, marketFilter, stats]);
  const favorite = viewAnalytics.favoriteAsset;
  const topProfit = viewAnalytics.topProfitAsset;
  const worst = viewAnalytics.worstAsset;
  const dominantMarket = viewAnalytics.dominantMarket;

  return (
    <div className="analytics-page">
      <section className="panel analytics-filter-panel">
        <PanelTitle
          title="Фильтр рынка"
          subtitle={marketFilter === "All" ? "Показаны все futures-сделки" : `Статистика только по рынку ${marketFilter}`}
        />
        <div className="market-filter">
          {marketOptions.map((option) => (
            <button
              className={marketFilter === option ? "active" : ""}
              key={option}
              type="button"
              onClick={() => setMarketFilter(option)}
            >
              {option === "All" ? "Все" : option}
            </button>
          ))}
        </div>
      </section>

      <div className="insight-grid">
        <InsightCard title="Любимый актив" value={favorite?.pair || "Нет данных"} detail={favorite ? `${favorite.trades} сделок - ${favorite.category}` : "Синхронизируй BingX"} />
        <InsightCard title="Где больше всего сделок" value={dominantMarket?.category || "Нет данных"} detail={dominantMarket ? `${dominantMarket.count} сделок - ${dominantMarket.share.toFixed(1)}%` : "Crypto / Forex / другие"} />
        <InsightCard title="Лучший актив" value={topProfit?.pair || "Нет данных"} detail={topProfit ? `${formatMoney(topProfit.pnl)} PnL` : "Недостаточно сделок"} tone={topProfit && topProfit.pnl < 0 ? "bad" : "good"} />
        <InsightCard title="Худший актив" value={worst?.pair || "Нет данных"} detail={worst ? `${formatMoney(worst.pnl)} PnL` : "Недостаточно сделок"} tone={worst && worst.pnl < 0 ? "bad" : "good"} />
      </div>

      <div className="analytics-detail-grid">
        <section className="panel">
          <PanelTitle title="Распределение рынков" subtitle="Классификация по symbol: Crypto, Forex, Index, Other" />
          <div className="market-bars">
            {viewAnalytics.marketRows.length === 0 && <div className="empty-analytics">Нет сделок для анализа.</div>}
            {viewAnalytics.marketRows.map((row) => (
              <div className="market-row" key={row.category}>
                <div><strong>{row.category}</strong><span>{row.count} сделок</span></div>
                <div className="bar-track"><i style={{ width: `${Math.max(row.share, 4)}%` }} /></div>
                <b>{row.share.toFixed(1)}%</b>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <PanelTitle title="Направления" subtitle="Long против Short по количеству сделок" />
          <div className="direction-split">
            <div><span>Long</span><strong>{viewAnalytics.sideCounts.Long}</strong></div>
            <div><span>Short</span><strong>{viewAnalytics.sideCounts.Short}</strong></div>
          </div>
          <div className="analytics-summary">
            <span>Всего сделок <b>{filteredTrades.length}</b></span>
            <span>Net PnL <b className={viewStats.net >= 0 ? "positive" : "negative"}>{formatMoney(viewStats.net)}</b></span>
            <span>Win rate <b>{viewStats.winRate.toFixed(1)}%</b></span>
            <span>Profit factor <b>{viewStats.profitFactor.toFixed(2)}</b></span>
          </div>
        </section>
      </div>

      <section className="panel trades-panel">
        <PanelTitle title="Аналитика по активам" subtitle={marketFilter === "All" ? "Какие инструменты ты торгуешь чаще и где результат лучше" : `Активы только рынка ${marketFilter}`} />
        <div className="table-scroll">
          <table>
            <thead><tr><th>Актив</th><th>Рынок</th><th>Сделок</th><th>Win rate</th><th>Volume</th><th>PnL</th></tr></thead>
            <tbody>
              {viewAnalytics.assetRows.length === 0 && <tr><td className="empty-cell" colSpan={6}>Нет futures-сделок для аналитики.</td></tr>}
              {viewAnalytics.assetRows.map((asset) => (
                <tr key={asset.pair}>
                  <td><strong>{asset.pair}</strong></td>
                  <td>{asset.category}</td>
                  <td>{asset.trades}</td>
                  <td>{asset.winRate.toFixed(1)}%</td>
                  <td>{formatMoney(asset.volume)}</td>
                  <td className={asset.pnl >= 0 ? "positive" : "negative"}>{formatMoney(asset.pnl)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function InsightCard({ title, value, detail, tone = "neutral" }: { title: string; value: string; detail: string; tone?: "neutral" | "good" | "bad" }) {
  const pnlMatch = detail.match(/[-+]?\$\d[\d,]*(?:\.\d+)?/);
  const beforePnl = pnlMatch ? detail.slice(0, pnlMatch.index) : detail;
  const pnlText = pnlMatch?.[0];
  const afterPnl = pnlMatch ? detail.slice((pnlMatch.index || 0) + pnlMatch[0].length) : "";
  return (
    <article className={`insight-card ${tone}`}>
      <p>{title}</p>
      <strong>{value}</strong>
      <span>
        {beforePnl}
        {pnlText && <b className={pnlText.startsWith("-") ? "negative" : "positive"}>{pnlText}</b>}
        {afterPnl}
      </span>
    </article>
  );
}

function CalendarPage({ trades }: { trades: Trade[] }) {
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const latestTrade = trades.slice().sort((left, right) => right.openedAt - left.openedAt)[0];
    const date = latestTrade ? new Date(latestTrade.openedAt) : new Date();
    return new Date(date.getFullYear(), date.getMonth(), 1);
  });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [dayModalOpen, setDayModalOpen] = useState(false);

  useEffect(() => {
    if (trades.length === 0) return;
    setCalendarMonth((currentMonth) => {
      const latestTrade = trades.slice().sort((left, right) => right.openedAt - left.openedAt)[0];
      const latestMonth = new Date(new Date(latestTrade.openedAt).getFullYear(), new Date(latestTrade.openedAt).getMonth(), 1);
      const hasCurrentMonthTrades = trades.some((trade) => {
        const date = new Date(trade.openedAt);
        return date.getFullYear() === currentMonth.getFullYear() && date.getMonth() === currentMonth.getMonth();
      });
      return hasCurrentMonthTrades ? currentMonth : latestMonth;
    });
  }, [trades]);

  const calendarData = useMemo(() => {
    const closedTrades = trades.filter((trade) => trade.status === "Closed");
    const byDay = new Map<string, { key: string; trades: number; pnl: number; wins: number; losses: number; volume: number }>();

    for (const trade of closedTrades) {
      const key = dayKey(trade.openedAt);
      const current = byDay.get(key) || { key, trades: 0, pnl: 0, wins: 0, losses: 0, volume: 0 };
      current.trades += 1;
      current.pnl += trade.pnl;
      current.wins += trade.pnl > 0 ? 1 : 0;
      current.losses += trade.pnl < 0 ? 1 : 0;
      current.volume += Math.abs(trade.size * trade.entry);
      byDay.set(key, current);
    }

    const days = [...byDay.values()].sort((left, right) => left.key.localeCompare(right.key));
    const bestTrade = [...closedTrades].sort((left, right) => right.pnl - left.pnl)[0];
    const worstTrade = [...closedTrades].sort((left, right) => left.pnl - right.pnl)[0];
    const bestDay = [...days].sort((left, right) => right.pnl - left.pnl)[0];
    const worstDay = [...days].sort((left, right) => left.pnl - right.pnl)[0];
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const monthDays = new Date(year, month + 1, 0).getDate();
    const leadingEmptyDays = (firstDay.getDay() + 6) % 7;
    const cells = [
      ...Array.from({ length: leadingEmptyDays }, (_, index) => ({ type: "empty" as const, key: `empty-${index}` })),
      ...Array.from({ length: monthDays }, (_, index) => {
        const date = new Date(year, month, index + 1);
        const key = localDayKey(date);
        const stat = byDay.get(key);
        return { type: "day" as const, key, day: index + 1, stat };
      }),
    ];

    return { days, cells, bestTrade, worstTrade, bestDay, worstDay, monthTitle: new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(calendarMonth) };
  }, [calendarMonth, trades]);

  useEffect(() => {
    const selectedDate = selectedDay ? dateFromDayKey(selectedDay) : null;
    if (selectedDate && selectedDate.getFullYear() === calendarMonth.getFullYear() && selectedDate.getMonth() === calendarMonth.getMonth()) {
      return;
    }
    setSelectedDay(null);
    setDayModalOpen(false);
  }, [calendarMonth, selectedDay]);

  const selectedDayTrades = useMemo(
    () => selectedDay ? trades.filter((trade) => dayKey(trade.openedAt) === selectedDay) : [],
    [selectedDay, trades],
  );

  const moveMonth = (offset: number) => {
    setCalendarMonth((currentMonth) => new Date(currentMonth.getFullYear(), currentMonth.getMonth() + offset, 1));
  };
  const goToToday = () => {
    const today = new Date();
    setCalendarMonth(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelectedDay(localDayKey(today));
    setDayModalOpen(false);
  };

  return (
    <div className="calendar-page">
      <div className="insight-grid calendar-insights">
        <InsightCard title="Самая прибыльная сделка" value={calendarData.bestTrade?.pair || "Нет данных"} detail={calendarData.bestTrade ? `${formatSignedMoney(calendarData.bestTrade.pnl)} PnL - ${formatDuration(calendarData.bestTrade.durationMs)}` : "Нет закрытых сделок"} tone="good" />
        <InsightCard title="Самая убыточная сделка" value={calendarData.worstTrade?.pair || "Нет данных"} detail={calendarData.worstTrade ? `${formatSignedMoney(calendarData.worstTrade.pnl)} PnL - ${formatDuration(calendarData.worstTrade.durationMs)}` : "Нет закрытых сделок"} tone="bad" />
        <InsightCard title="Лучший день" value={calendarData.bestDay ? formatDayLabel(calendarData.bestDay.key) : "Нет данных"} detail={calendarData.bestDay ? `${formatSignedMoney(calendarData.bestDay.pnl)} - ${calendarData.bestDay.trades} сделок` : "Нет закрытых сделок"} tone="good" />
        <InsightCard title="Худший день" value={calendarData.worstDay ? formatDayLabel(calendarData.worstDay.key) : "Нет данных"} detail={calendarData.worstDay ? `${formatSignedMoney(calendarData.worstDay.pnl)} - ${calendarData.worstDay.trades} сделок` : "Нет закрытых сделок"} tone="bad" />
      </div>

      <section className="panel calendar-panel">
        <div className="calendar-panel-head">
          <PanelTitle title={`Календарь - ${calendarData.monthTitle}`} subtitle="В каждом дне: количество сделок, дневной PnL и win rate" />
          <div className="calendar-controls">
            <button aria-label="Предыдущий месяц" onClick={() => moveMonth(-1)}>‹</button>
            <button aria-label="Сегодня" onClick={goToToday}>●</button>
            <button aria-label="Следующий месяц" onClick={() => moveMonth(1)}>›</button>
          </div>
        </div>
        <div className="calendar-weekdays">
          {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((day) => <span key={day}>{day}</span>)}
        </div>
        <div className="calendar-grid">
          {calendarData.cells.map((cell) => {
            if (cell.type === "empty") return <div className="calendar-cell empty" key={cell.key} />;
            const stat = cell.stat;
            const winRate = stat?.trades ? (stat.wins / stat.trades) * 100 : 0;
            return (
              <button
                className={`calendar-cell ${stat ? "active-day" : ""} ${stat && stat.pnl < 0 ? "loss-day" : ""} ${selectedDay === cell.key ? "selected-day" : ""} ${cell.key === localDayKey(new Date()) ? "today-day" : ""}`}
                key={cell.key}
                onClick={() => {
                  setSelectedDay(cell.key);
                  setDayModalOpen(true);
                }}
              >
                <strong>{cell.day}</strong>
                {stat ? (
                  <>
                    <span>{stat.trades} сделок</span>
                    <b className={stat.pnl >= 0 ? "positive" : "negative"}>{formatMoney(stat.pnl)}</b>
                    <small>WR {winRate.toFixed(0)}%</small>
                  </>
                ) : <em>нет сделок</em>}
              </button>
            );
          })}
        </div>
      </section>

      {dayModalOpen && selectedDay && (
        <div className="modal-backdrop" onClick={() => setDayModalOpen(false)}>
          <section className="day-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <PanelTitle
                title={`Сделки за ${formatDayLabel(selectedDay)}`}
                subtitle="Сделки, открытые в выбранный день"
              />
              <button className="modal-close" onClick={() => setDayModalOpen(false)} aria-label="Закрыть окно">×</button>
            </div>
            <div className="table-scroll">
              <table>
                <thead><tr><th>Время</th><th>Инструмент</th><th>Направление</th><th>Длительность</th><th>Цена входа</th><th>Цена выхода</th><th>PnL</th><th>ROI</th></tr></thead>
                <tbody>
                  {selectedDayTrades.length === 0 && <tr><td className="empty-cell" colSpan={8}>В этот день сделок нет.</td></tr>}
                  {selectedDayTrades.map((trade) => (
                    <tr key={trade.id}>
                      <td>{new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(new Date(trade.openedAt))}</td>
                      <td><TradePairCell trade={trade} /></td>
                      <td><span className={`side ${trade.side.toLowerCase()}`}>{trade.side}</span></td>
                      <td>{formatDuration(trade.durationMs)}</td>
                      <td>{formatNumber(trade.entry)}</td>
                      <td>{formatNumber(trade.exit)}</td>
                      <td className={trade.pnl >= 0 ? "positive" : "negative"}>{formatSignedMoney(trade.pnl)}</td>
                      <td className={trade.roi >= 0 ? "positive" : "negative"}>{trade.roi >= 0 ? "+" : ""}{trade.roi.toFixed(2)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function TradeTable({ userId, title, subtitle, trades, emptyMessage, filterable = false }: { userId: string; title: string; subtitle: string; trades: Trade[]; emptyMessage: string; filterable?: boolean }) {
  const [sortKey, setSortKey] = useState<SortKey>("opened");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [searchQuery, setSearchQuery] = useState("");
  const [sideFilter, setSideFilter] = useState<SideFilter>("All");
  const [resultFilter, setResultFilter] = useState<ResultFilter>("All");
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);

  const filteredTrades = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return trades.filter((trade) => {
      const matchesQuery = !query ||
        trade.pair.toLowerCase().includes(query) ||
        trade.id.toLowerCase().includes(query) ||
        trade.orderId?.toLowerCase().includes(query);
      const matchesSide = sideFilter === "All" || trade.side === sideFilter;
      const matchesResult =
        resultFilter === "All" ||
        (resultFilter === "Profit" && trade.pnl > 0) ||
        (resultFilter === "Loss" && trade.pnl < 0);
      return matchesQuery && matchesSide && matchesResult;
    });
  }, [resultFilter, searchQuery, sideFilter, trades]);

  const sortedTrades = useMemo(() => {
    const direction = sortDirection === "asc" ? 1 : -1;
    return [...filteredTrades].sort((left, right) => {
      if (sortKey === "opened") {
        return (left.openedAt - right.openedAt) * direction;
      }
      const leftValue = left[sortKey];
      const rightValue = right[sortKey];
      if (typeof leftValue === "number" && typeof rightValue === "number") {
        return (leftValue - rightValue) * direction;
      }
      return String(leftValue).localeCompare(String(rightValue)) * direction;
    });
  }, [filteredTrades, sortDirection, sortKey]);

  const hasActiveFilters = Boolean(searchQuery.trim()) || sideFilter !== "All" || resultFilter !== "All";

  const resetFilters = () => {
    setSearchQuery("");
    setSideFilter("All");
    setResultFilter("All");
  };

  const requestSort = (nextKey: SortKey) => {
    if (nextKey === sortKey) {
      setSortDirection((currentDirection) => currentDirection === "asc" ? "desc" : "asc");
      return;
    }
    setSortKey(nextKey);
    setSortDirection(nextKey === "opened" ? "desc" : "asc");
  };

  const sortLabel = (key: SortKey) => sortKey === key ? (sortDirection === "asc" ? "↑" : "↓") : "";

  return (
    <section className="panel trades-panel">
      <PanelTitle title={`${title} (${filterable ? sortedTrades.length : trades.length})`} subtitle={subtitle} />
      {filterable && (
        <div className="trade-filters">
          <label className="trade-search">
            <Search size={15} />
            <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Инструмент или order id" />
          </label>
          <FilterDropdown label="Направление сделки" value={sideFilter} options={sideFilterOptions} onChange={setSideFilter} />
          <FilterDropdown label="Результат сделки" value={resultFilter} options={resultFilterOptions} onChange={setResultFilter} />
          {hasActiveFilters && <button className="filter-reset" onClick={resetFilters}>Сбросить</button>}
        </div>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <SortableHeader label="Инструмент" sortKey="pair" activeLabel={sortLabel("pair")} onSort={requestSort} />
              <SortableHeader label="Направление" sortKey="side" activeLabel={sortLabel("side")} onSort={requestSort} />
              <SortableHeader label="Открытие" sortKey="opened" activeLabel={sortLabel("opened")} onSort={requestSort} />
              <SortableHeader label="Цена входа" sortKey="entry" activeLabel={sortLabel("entry")} onSort={requestSort} />
              <SortableHeader label="Цена выхода" sortKey="exit" activeLabel={sortLabel("exit")} onSort={requestSort} />
              <SortableHeader label="Объём" sortKey="size" activeLabel={sortLabel("size")} onSort={requestSort} />
              <SortableHeader label="PnL" sortKey="pnl" activeLabel={sortLabel("pnl")} onSort={requestSort} />
              <SortableHeader label="ROI" sortKey="roi" activeLabel={sortLabel("roi")} onSort={requestSort} />
            </tr>
          </thead>
          <tbody>
            {trades.length === 0 && (
              <tr><td className="empty-cell" colSpan={8}>{emptyMessage}</td></tr>
            )}
            {trades.length > 0 && sortedTrades.length === 0 && (
              <tr><td className="empty-cell" colSpan={8}>По выбранным фильтрам сделок нет.</td></tr>
            )}
            {sortedTrades.map((trade) => (
              <tr className="clickable-row" key={trade.id} onClick={() => setSelectedTrade(trade)}>
                <td><TradePairCell trade={trade} /></td>
                <td><span className={`side ${trade.side.toLowerCase()}`}>{trade.side === "Long" ? <TrendingUp size={13} /> : <TrendingDown size={13} />}{trade.side}</span></td>
                <td>{trade.opened}</td><td>{formatNumber(trade.entry)}</td><td>{formatNumber(trade.exit)}</td><td>{formatNumber(trade.size)}</td>
                <td className={trade.pnl >= 0 ? "positive" : "negative"}>{trade.pnl >= 0 ? "+" : ""}{formatMoney(trade.pnl)}</td>
                <td className={trade.roi >= 0 ? "positive" : "negative"}>{trade.roi >= 0 ? "+" : ""}{trade.roi.toFixed(2)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selectedTrade && (
        <TradeDetailModal userId={userId} trade={selectedTrade} onClose={() => setSelectedTrade(null)} />
      )}
    </section>
  );
}

function SortableHeader({ label, sortKey, activeLabel, onSort }: { label: string; sortKey: SortKey; activeLabel: string; onSort: (key: SortKey) => void }) {
  return (
    <th>
      <button className={`sort-header ${activeLabel ? "active" : ""}`} onClick={() => onSort(sortKey)}>
        {label}
        <span>{activeLabel || "↕"}</span>
      </button>
    </th>
  );
}

function TradePairCell({ trade }: { trade: Trade }) {
  const hasNote = Boolean(
    trade.note?.trim() ||
    trade.entryReason?.trim() ||
    trade.exitReason?.trim() ||
    trade.tradePlan?.trim() ||
    trade.tradeMistake?.trim() ||
    trade.tradeLesson?.trim(),
  );
  const hasScreenshot = Boolean(trade.screenshotDataUrl || trade.screenshotUrl || trade.screenshotUrls?.length);
  return (
    <span className="pair-token" tabIndex={0}>
      <span className="pair-token-main">
        <strong>{trade.pair}</strong>
        {(hasNote || hasScreenshot) && (
          <span className="trade-markers" aria-label="У сделки есть журнал">
            {hasNote && <StickyNote size={12} />}
            {hasScreenshot && <Image size={12} />}
          </span>
        )}
      </span>
      <span className="pair-tooltip" role="tooltip">
        <span>Order ID</span>
        <b>{trade.orderId || trade.id}</b>
        {(hasNote || hasScreenshot) && (
          <em>{[hasNote ? "есть описание" : "", hasScreenshot ? "есть скрин" : ""].filter(Boolean).join(" · ")}</em>
        )}
      </span>
    </span>
  );
}

function TradeDetailModal({ userId, trade, onClose }: { userId: string; trade: Trade; onClose: () => void }) {
  const [note, setNote] = useState(trade.note || "");
  const [entryReason, setEntryReason] = useState(trade.entryReason || "");
  const [exitReason, setExitReason] = useState(trade.exitReason || "");
  const [tradePlan, setTradePlan] = useState(trade.tradePlan || "");
  const [tradeMistake, setTradeMistake] = useState(trade.tradeMistake || "");
  const [tradeLesson, setTradeLesson] = useState(trade.tradeLesson || "");
  const [screenshotDataUrl, setScreenshotDataUrl] = useState(trade.screenshotDataUrl || "");
  const initialScreenshotUrls = useMemo(() => normalizeTradingViewUrls(trade.screenshotUrls, trade.screenshotUrl || ""), [trade.screenshotUrl, trade.screenshotUrls]);
  const [screenshotUrls, setScreenshotUrls] = useState(() => {
    return initialScreenshotUrls.length ? initialScreenshotUrls : [""];
  });
  const [expandedScreenshot, setExpandedScreenshot] = useState<{ imageUrl: string; sourceUrl: string; label: string } | null>(null);
  const [showUnsavedPrompt, setShowUnsavedPrompt] = useState(false);
  const [savingJournal, setSavingJournal] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [savedJournalSnapshot, setSavedJournalSnapshot] = useState(() => JSON.stringify({
    note: trade.note || "",
    entryReason: trade.entryReason || "",
    exitReason: trade.exitReason || "",
    tradePlan: trade.tradePlan || "",
    tradeMistake: trade.tradeMistake || "",
    tradeLesson: trade.tradeLesson || "",
    screenshotDataUrl: trade.screenshotDataUrl || "",
    screenshotUrls: initialScreenshotUrls,
  }));
  const volume = Math.abs(trade.size * trade.entry);
  const normalizedScreenshotUrls = screenshotUrls
    .map((url) => normalizeTradingViewUrl(url))
    .filter(Boolean);
  const uniqueScreenshotUrls = [...new Set(normalizedScreenshotUrls)];
  const screenshotPreviews = [
    ...(screenshotDataUrl ? [{ id: "uploaded", imageUrl: screenshotDataUrl, sourceUrl: "", label: "Файл" }] : []),
    ...uniqueScreenshotUrls.map((url, index) => ({
      id: url,
      imageUrl: tradingViewPreviewUrl(url),
      sourceUrl: url,
      label: `TV ${index + 1}`,
    })),
  ].filter((item) => item.imageUrl);
  const currentJournalSnapshot = JSON.stringify({
    note,
    entryReason,
    exitReason,
    tradePlan,
    tradeMistake,
    tradeLesson,
    screenshotDataUrl,
    screenshotUrls: screenshotUrls.map((url) => url.trim()).filter(Boolean),
  });
  const hasUnsavedJournal = currentJournalSnapshot !== savedJournalSnapshot;

  const saveTradeJournal = async () => {
    const invalidScreenshotUrl = screenshotUrls.find((url) => url.trim() && !normalizeTradingViewUrl(url));
    if (invalidScreenshotUrl) {
      setSaveMessage("Вставь ссылки TradingView формата https://www.tradingview.com/x/...");
      return false;
    }
    const cleanScreenshotUrls = [...new Set(screenshotUrls.map(normalizeTradingViewUrl).filter(Boolean))];
    setSavingJournal(true);
    try {
      await setDoc(doc(db, "users", userId, "trades", trade.id), {
      note: note.trim(),
      entryReason: entryReason.trim(),
      exitReason: exitReason.trim(),
      tradePlan: tradePlan.trim(),
      tradeMistake: tradeMistake.trim(),
      tradeLesson: tradeLesson.trim(),
      screenshotDataUrl,
      screenshotUrl: cleanScreenshotUrls[0] || "",
      screenshotUrls: cleanScreenshotUrls,
      journalUpdatedAt: serverTimestamp(),
      }, { merge: true });
    } finally {
      setSavingJournal(false);
    }
    setScreenshotUrls(cleanScreenshotUrls.length ? cleanScreenshotUrls : [""]);
    setSavedJournalSnapshot(JSON.stringify({
      note: note.trim(),
      entryReason: entryReason.trim(),
      exitReason: exitReason.trim(),
      tradePlan: tradePlan.trim(),
      tradeMistake: tradeMistake.trim(),
      tradeLesson: tradeLesson.trim(),
      screenshotDataUrl,
      screenshotUrls: cleanScreenshotUrls,
    }));
    setSaveMessage("Сохранено");
    return true;
  };

  const requestCloseTradeModal = () => {
    if (hasUnsavedJournal) {
      setShowUnsavedPrompt(true);
      return;
    }
    onClose();
  };

  const saveAndCloseTradeModal = async () => {
    try {
      const saved = await saveTradeJournal();
      if (saved) onClose();
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "Не удалось сохранить журнал");
    }
  };

  const updateScreenshotUrl = (index: number, value: string) => {
    setScreenshotUrls((currentUrls) => currentUrls.map((url, urlIndex) => urlIndex === index ? value : url));
  };

  const addScreenshotUrl = () => {
    setScreenshotUrls((currentUrls) => [...currentUrls, ""]);
  };

  const removeScreenshotUrl = (index: number) => {
    setScreenshotUrls((currentUrls) => {
      const nextUrls = currentUrls.filter((_, urlIndex) => urlIndex !== index);
      return nextUrls.length ? nextUrls : [""];
    });
  };

  const uploadScreenshot = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setSaveMessage("Нужен файл изображения");
      return;
    }
    if (file.size > 700 * 1024) {
      setSaveMessage("Скрин слишком большой. Сожми до 700 KB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setScreenshotDataUrl(String(reader.result || ""));
      setSaveMessage("Скрин добавлен, нажми сохранить");
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="modal-backdrop" onClick={requestCloseTradeModal}>
      <section className="trade-detail-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <PanelTitle title={trade.pair} subtitle={`Order ID: ${trade.orderId || trade.id}`} />
          <button className="modal-close" onClick={requestCloseTradeModal} aria-label="Закрыть окно">×</button>
        </div>
        <div className="trade-detail-body">
          <div className="trade-detail-hero">
            <span className={`side ${trade.side.toLowerCase()}`}>{trade.side === "Long" ? <TrendingUp size={13} /> : <TrendingDown size={13} />}{trade.side}</span>
            <strong className={trade.pnl >= 0 ? "positive" : "negative"}>{formatSignedMoney(trade.pnl)}</strong>
            <p className={trade.roi >= 0 ? "positive" : "negative"}>{displayPercent(trade.roi)} ROI</p>
          </div>
          <div className="trade-detail-grid">
            <DetailItem label="Открытие" value={trade.opened} />
            <DetailItem label="Закрытие" value={formatOpened(trade.closedAt)} />
            <DetailItem label="Длительность" value={formatDuration(trade.durationMs)} />
            <DetailItem label="Статус" value={trade.status === "Open" ? "Открыта" : "Закрыта"} />
            <DetailItem label="Цена входа" value={formatNumber(trade.entry)} />
            <DetailItem label="Цена выхода" value={formatNumber(trade.exit)} />
            <DetailItem label="Размер позиции" value={formatNumber(trade.size)} />
            <DetailItem label="Объём" value={formatMoney(volume)} />
          </div>
          <div className="trade-journal">
            <div className="journal-form-grid">
              <label>
                <span>Причина входа</span>
                <input value={entryReason} onChange={(event) => setEntryReason(event.target.value)} placeholder="Сетап, уровень, сигнал..." />
              </label>
              <label>
                <span>Причина выхода</span>
                <input value={exitReason} onChange={(event) => setExitReason(event.target.value)} placeholder="Тейк, стоп, ручное закрытие..." />
              </label>
              <label>
                <span>План сделки</span>
                <textarea value={tradePlan} onChange={(event) => setTradePlan(event.target.value)} placeholder="Что хотел увидеть, где риск, где цель..." />
              </label>
              <label>
                <span>Ошибка</span>
                <textarea value={tradeMistake} onChange={(event) => setTradeMistake(event.target.value)} placeholder="Что сделал не по плану..." />
              </label>
              <label className="journal-wide">
                <span>Вывод</span>
                <textarea value={tradeLesson} onChange={(event) => setTradeLesson(event.target.value)} placeholder="Что повторить или убрать в следующий раз..." />
              </label>
            </div>
            <label>
              <span>Дополнительное описание</span>
              <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Эмоции, контекст рынка, детали сопровождения..." />
            </label>
            <div className="tv-links-block">
              <div className="journal-section-head">
                <span>TradingView ссылки</span>
                <button className="add-link-button" type="button" onClick={addScreenshotUrl} aria-label="Добавить ссылку TradingView" title="Добавить ещё одну ссылку TradingView" data-tooltip="Добавить ещё одну ссылку TradingView">+</button>
              </div>
              <div className="tv-link-list">
                {screenshotUrls.map((url, index) => (
                  <label className="tv-link-row" key={index}>
                    <input value={url} onChange={(event) => updateScreenshotUrl(index, event.target.value)} placeholder="https://www.tradingview.com/x/WizqhF6V/" />
                    <button type="button" onClick={() => removeScreenshotUrl(index)} disabled={screenshotUrls.length === 1 && !url.trim()}>Удалить</button>
                  </label>
                ))}
              </div>
            </div>
            <div className="screenshot-uploader">
              <div>
                <span>Скрин TradingView</span>
                <p>Загрузи файл до 700 KB или вставь ссылку выше</p>
              </div>
              <label className="upload-button">
                Загрузить скрин
                <input accept="image/*" type="file" onChange={(event) => uploadScreenshot(event.target.files?.[0])} />
              </label>
            </div>
            {screenshotPreviews.length > 0 && (
              <div className="trade-screenshots-grid">
                {screenshotPreviews.map((preview) => (
                  <div className="trade-screenshot" key={preview.id}>
                    <button className="screenshot-preview-button" type="button" onClick={() => setExpandedScreenshot(preview)} aria-label="Открыть скрин крупно">
                      <img src={preview.imageUrl} alt="TradingView screenshot" />
                    </button>
                    <div className="screenshot-actions">
                      <span>{preview.label}</span>
                      {preview.sourceUrl && <a href={preview.sourceUrl} target="_blank" rel="noreferrer">Открыть в TradingView</a>}
                      {preview.id === "uploaded" && (
                        <button type="button" onClick={() => {
                          setScreenshotDataUrl("");
                          setSaveMessage("Файл скрина удалён, нажми сохранить");
                        }}>Удалить файл</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="journal-actions">
              <button className="journal-save-button" onClick={() => void saveTradeJournal()} disabled={savingJournal}>{savingJournal ? "Сохраняю..." : "Сохранить журнал"}</button>
              {saveMessage && <span>{saveMessage}</span>}
            </div>
          </div>
        </div>
      </section>
      {showUnsavedPrompt && (
        <div className="unsaved-dialog" onClick={(event) => event.stopPropagation()}>
          <h3>Журнал не сохранён</h3>
          <p>Ты изменил описание сделки. Сохранить изменения перед закрытием?</p>
          <div className="unsaved-actions">
            <button className="journal-save-button" onClick={() => void saveAndCloseTradeModal()} disabled={savingJournal}>{savingJournal ? "Сохраняю..." : "Сохранить и выйти"}</button>
            <button className="ghost-action" onClick={onClose}>Выйти без сохранения</button>
            <button className="ghost-action" onClick={() => setShowUnsavedPrompt(false)}>Остаться</button>
          </div>
        </div>
      )}
      {expandedScreenshot && (
        <div className="screenshot-lightbox" onClick={(event) => {
          event.stopPropagation();
          setExpandedScreenshot(null);
        }}>
          <button className="modal-close" onClick={() => setExpandedScreenshot(null)} aria-label="Закрыть скрин">×</button>
          <div className="screenshot-lightbox-content" onClick={(event) => event.stopPropagation()}>
            <img src={expandedScreenshot.imageUrl} alt="TradingView screenshot large" />
            <div className="screenshot-lightbox-actions">
              <span>{expandedScreenshot.label}</span>
              <a href={expandedScreenshot.sourceUrl || expandedScreenshot.imageUrl} target="_blank" rel="noreferrer">Открыть оригинал</a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function FilterDropdown<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: FilterOption<T>[]; onChange: (value: T) => void }) {
  const [open, setOpen] = useState(false);
  const currentOption = options.find((option) => option.value === value) || options[0];

  return (
    <div
      className={`filter-dropdown ${open ? "open" : ""}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setOpen(false);
        }
      }}
    >
      <button
        className="filter-dropdown-button"
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((currentOpen) => !currentOpen)}
      >
        <span>{currentOption.label}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="filter-dropdown-menu" role="listbox" aria-label={label}>
          {options.map((option) => (
            <button
              className={option.value === value ? "active" : ""}
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default App;
