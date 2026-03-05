export type TrendDirection = 'BULLISH' | 'BEARISH' | 'SIDEWAYS';

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface OptionSignal {
  strike: number;
  type: 'CE' | 'PE';
  expiry: string;
  entryRange: string;
  stopLoss: number;
  target: number;
  logic: string;
}

export interface OptionGreek {
  strikePrice: number;
  optionType: 'CE' | 'PE';
  delta: number;
  theta: number;
  vega: number;
  gamma: number;
  iv: number;
  ltp: number;
  tradeVolume: number;
  oi: number;
}

export interface MarketInsight {
  summary: string;
  confidence: number;
  verdict: 'BUY' | 'SELL' | 'HOLD';
  entry?: number;
  target?: number;
  stopLoss?: number;
  newsImpact: string;
  changed: string[];
  latestNews: NewsItem[];
  rationale: string[];
  risks: string[];
}

export interface AiFeatureSnapshot {
  vwapDistancePct: number;
  trendStrength: number;
  volatilityPct: number;
  volumeRatio: number;
  timeframeAligned: boolean;
}

export interface AiRuleGate {
  passed: boolean;
  blockedAction: 'BUY' | 'SELL' | 'HOLD';
  reasons: string[];
}

export interface AiQuality {
  version: string;
  confidenceBand: 'HIGH' | 'MEDIUM' | 'LOW';
  dataFreshnessMs: number;
  features: AiFeatureSnapshot;
  ruleGate: AiRuleGate;
}

export interface NewsItem {
  title: string;
  source: string;
  publishedAt: string;
  url: string;
  sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  relevanceScore: number;
}

export interface TradeStrategy {
  action: 'BUY' | 'SELL' | 'WAIT';
  entry: number;
  target: number;
  stopLoss: number;
  riskReward: number;
}

export interface Position {
  symbol: string;
  quantity: number;
  averagePrice: number;
  lastPrice: number;
}

export interface MarketSnapshot {
  stock: string;
  price: number;
  open: number;
  vwap?: number; // Added for Quant-Logic support
  high: number;
  low: number;
  previousClose: number;
  volume: number;
  rsi: number;
  ema20: number;
  support: number;
  resistance: number;
  trend: TrendDirection;
  analysis: string;
  candleData: Candle[];
  foGreeks: OptionGreek[];
  strategy: TradeStrategy;
  insight: MarketInsight;
  trendConsistency?: 'CONFIRMED' | 'DIVERGENT'; // New field
  timeframeAnalysis?: {
    m1: TrendDirection;
    m5: TrendDirection;
    m15: TrendDirection;
  };
  updatedAt: number;
  optionSignal?: OptionSignal;
  executionContext?: {
    marketRegime: 'TREND_UP' | 'TREND_DOWN' | 'HIGH_VOL_CHOP' | 'RANGE';
    trendStrength: number;
    volatilityPct: number;
    vwapDistancePct: number;
    volumeRatio: number;
    atr: number;
  };
  aiQuality?: AiQuality;
}

export interface WatchlistItem {
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
  trend: TrendDirection;
}

export interface MarketBreadth {
  advances: number;
  declines: number;
  unchanged: number;
  volatilityIndex: number;
}

export interface PortfolioHolding {
  symbol: string;
  quantity: number;
  averagePrice: number;
  lastPrice: number;
  marketValue: number;
  investedValue: number;
  pnl: number;
  pnlPercent: number;
  allocationPercent: number;
}

export interface PortfolioSummary {
  totalValue: number;
  investedValue: number;
  dayPnl: number;
  totalPnl: number;
  totalPnlPercent: number;
  holdings: PortfolioHolding[];
}

export interface PriceAlert {
  alertId: string;
  name: string;
  symbol: string;
  comparisonType: 'LTP' | 'OPEN' | 'HIGH' | 'LOW' | 'CLOSE';
  condition: 'GT' | 'GTE' | 'LT' | 'LTE' | 'EQ';
  value: number;
  notes?: string;
  active: boolean;
  updatedAt?: number;
}

export interface CreatePriceAlertInput {
  name: string;
  symbol: string;
  comparisonType: 'LTP' | 'OPEN' | 'HIGH' | 'LOW' | 'CLOSE';
  condition: 'GT' | 'GTE' | 'LT' | 'LTE' | 'EQ';
  value: number;
  notes?: string;
}

export interface DashboardState {
  snapshot: MarketSnapshot | null;
  watchlist: WatchlistItem[];
  breadth: MarketBreadth;
  portfolio: PortfolioSummary;
  warningMessage?: string;
}

export interface MutualFundScheme {
  schemeCode: string;
  schemeName: string;
}

export interface MutualFundNavPoint {
  date: string;
  nav: number;
  timestamp: number;
}

export interface MutualFundSnapshot {
  schemeCode: string;
  schemeName: string;
  amc?: string;
  category?: string;
  navHistory: MutualFundNavPoint[];
}
