import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, catchError, map, of, tap, throwError, timeout } from 'rxjs';
import {
  AiQuality,
  Candle,
  CreatePriceAlertInput,
  DashboardState,
  MarketBreadth,
  MarketInsight,
  MarketSnapshot,
  NewsItem,
  OptionGreek,
  PortfolioHolding,
  PortfolioSummary,
  PriceAlert,
  Position,
  TradeStrategy,
  TrendDirection,
  WatchlistItem
} from '../models/market.models';

interface AnalyzeResponse {
  stock?: string;
  price?: number;
  open?: number;
  high?: number;
  low?: number;
  previousClose?: number;
  volume?: number;
  rsi?: number;
  ema20?: number;
  vwap?: number;
  support?: number;
  resistance?: number;
  trend?: string;
  analysis?: string;
  aiAnalysis?: {
    verdict?: string;
    confidence?: number;
    summary?: string;
    entry?: number;
    target?: number;
    stopLoss?: number;
    reasons?: string[];
    risks?: string[];
    newsImpact?: string;
    changed?: string[];
  };
  latestNews?: Array<{
    title?: string;
    source?: string;
    publishedAt?: string;
    url?: string;
    sentiment?: string;
    relevanceScore?: number;
  }>;
  candleData?: number[][];
  foGreeks?: Array<Record<string, number | string>>;
  executionContext?: {
    marketRegime?: string;
    trendStrength?: number;
    volatilityPct?: number;
    vwapDistancePct?: number;
    volumeRatio?: number;
    atr?: number;
  };
  aiQuality?: {
    version?: string;
    confidenceBand?: string;
    dataFreshnessMs?: number;
    features?: {
      vwapDistancePct?: number;
      trendStrength?: number;
      volatilityPct?: number;
      volumeRatio?: number;
      timeframeAligned?: boolean;
    };
    ruleGate?: {
      passed?: boolean;
      blockedAction?: string;
      reasons?: string[];
    };
  };
}

interface PriceAlertsResponseItem {
  id?: string;
  alertId?: string;
  name?: string;
  alertName?: string;
  symbol?: string;
  comparisonType?: string;
  dataType?: string;
  condition?: string;
  operator?: string;
  value?: number;
  threshold?: number;
  active?: boolean;
  is_active?: boolean;
  notes?: string;
  description?: string;
  updatedAt?: number;
  updated_at?: number;
}

@Injectable({
  providedIn: 'root'
})
export class MarketDataService {
  private readonly apiUrl = '/api/analyze';
  private readonly liveWsUrl = 'wss://9dmy4sgdc3.execute-api.ap-south-1.amazonaws.com/prod';
  private readonly watchlistApiUrl = '/api/watchlist';
  private readonly watchlistStorageKey = 'anavai.recentSearches.v1';
  private readonly watchlistUserId = 'default-user';
  private readonly requestTimeoutMs = 15000;

  private readonly watchlistSeed: Array<{ symbol: string; name: string }> = [
    { symbol: 'RELIANCE', name: 'Reliance Industries' },
    { symbol: 'TCS', name: 'Tata Consultancy Services' },
    { symbol: 'INFY', name: 'Infosys' },
    { symbol: 'HDFCBANK', name: 'HDFC Bank' },
    { symbol: 'ICICIBANK', name: 'ICICI Bank' },
    { symbol: 'SBIN', name: 'State Bank of India' }
  ];

  private readonly basePositions: Position[] = [
    { symbol: 'RELIANCE', quantity: 8, averagePrice: 2620, lastPrice: 2680 },
    { symbol: 'TCS', quantity: 6, averagePrice: 3795, lastPrice: 3842 },
    { symbol: 'INFY', quantity: 10, averagePrice: 1680, lastPrice: 1654 },
    { symbol: 'HDFCBANK', quantity: 14, averagePrice: 1575, lastPrice: 1609 }
  ];

  private recentSearchSymbols: string[] = [];

  constructor(private readonly http: HttpClient) {}

  loadRecentSearches(): Observable<string[]> {
    return this.http
      .get<{ symbols?: string[] }>(`${this.watchlistApiUrl}?userId=${encodeURIComponent(this.watchlistUserId)}`)
      .pipe(
        map((response) => this.normalizeRecentSymbols(response.symbols ?? [])),
        tap((symbols) => this.setRecentSymbols(symbols)),
        catchError(() => {
          const local = this.readLocalRecentSymbols();
          this.setRecentSymbols(local);
          return of(local);
        })
      );
  }

  recordRecentSearch(symbol: string): Observable<void> {
    const clean = symbol.trim().toUpperCase();
    if (!clean) {
      return of(void 0);
    }

    const updated = this.normalizeRecentSymbols([clean, ...this.recentSearchSymbols]);
    this.setRecentSymbols(updated);

    return this.http
      .post(`${this.watchlistApiUrl}`, {
        userId: this.watchlistUserId,
        symbol: clean
      })
      .pipe(
        map(() => void 0),
        catchError(() => of(void 0))
      );
  }

  getPriceAlerts(): Observable<PriceAlert[]> {
    return this.http
      .post<{ alerts?: PriceAlertsResponseItem[] }>(this.apiUrl, { mode: 'alerts_list' })
      .pipe(
        map((response) => (response.alerts ?? []).map((item) => this.toPriceAlert(item))),
        catchError(() => of([]))
      );
  }

  createPriceAlert(input: CreatePriceAlertInput): Observable<PriceAlert> {
    const payload = {
      name: input.name.trim(),
      symbol: input.symbol.trim().toUpperCase(),
      comparisonType: input.comparisonType,
      condition: input.condition,
      value: Number(input.value),
      notes: input.notes?.trim() || undefined
    };

    return this.http
      .post<PriceAlertsResponseItem>(this.apiUrl, { mode: 'alerts_create', ...payload })
      .pipe(map((response) => this.toPriceAlert(response)));
  }

  deletePriceAlert(alertId: string): Observable<void> {
    return this.http.post<void>(this.apiUrl, { mode: 'alerts_delete', alertId });
  }

  getDashboardState(
    symbol: string,
    resolution: string,
    from: string,
    to: string,
    rollingWindowMinutes: number | null = null
  ): Observable<DashboardState> {
    const normalizedSymbol = symbol.toUpperCase();
    const payloadCandidates = this.buildPayloadCandidates(
      normalizedSymbol,
      resolution,
      from,
      to,
      rollingWindowMinutes
    );

    return this.tryPayloads(payloadCandidates, normalizedSymbol, rollingWindowMinutes).pipe(
      catchError((error: unknown) => {
        const message = this.toApiMessage(error);
        return of(this.toDashboardState(undefined, normalizedSymbol, true, message, rollingWindowMinutes));
      })
    );
  }

  getLiveDashboardStateStream(
    symbol: string,
    resolution: string,
    from: string,
    to: string,
    rollingWindowMinutes: number | null = null
  ): Observable<DashboardState> {
    const normalizedSymbol = symbol.toUpperCase();

    return new Observable<DashboardState>((observer) => {
      let socket: WebSocket | null = null;
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
      let disposed = false;
      let reconnectAttempts = 0;
      const maxReconnectAttempts = 7;

      const bootstrapSub = this.getDashboardState(
        normalizedSymbol,
        resolution,
        from,
        to,
        rollingWindowMinutes
      ).subscribe({
        next: (state) => observer.next(state)
      });

      const cleanSocket = (): void => {
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
        if (socket && socket.readyState <= WebSocket.OPEN) {
          socket.onclose = null;
          socket.onerror = null;
          socket.close();
        }
        socket = null;
      };

      const finishWithError = (message: string): void => {
        if (disposed) {
          return;
        }
        disposed = true;
        observer.error(new Error(message));
      };

      const scheduleReconnect = (reason: string): void => {
        if (disposed) {
          return;
        }
        cleanSocket();
        reconnectAttempts += 1;
        if (reconnectAttempts > maxReconnectAttempts) {
          finishWithError(`WebSocket reconnect failed: ${reason}`);
          return;
        }

        const baseDelay = Math.min(12000, Math.pow(2, reconnectAttempts - 1) * 600);
        const jitter = Math.floor(Math.random() * 350);
        reconnectTimer = setTimeout(() => {
          connect();
        }, baseDelay + jitter);
      };

      const connect = (): void => {
        try {
          socket = new WebSocket(this.liveWsUrl);
        } catch {
          scheduleReconnect('initialization failed');
          return;
        }

        socket.onopen = () => {
          if (!socket) {
            return;
          }
          reconnectAttempts = 0;

          const subscription = {
            action: 'subscribeMarket',
            symbol: this.toFyersSymbol(normalizedSymbol),
            resolution: this.normalizeResolution(resolution),
            range_from: from,
            range_to: to,
            rollingWindowMinutes: rollingWindowMinutes ?? undefined
          };

          socket.send(JSON.stringify(subscription));
          heartbeat = setInterval(() => {
            if (socket?.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ action: 'ping', timestamp: Date.now() }));
            }
          }, 15000);
        };

        socket.onmessage = (event) => {
          const parsed = this.safeParseWsPayload(event.data);
          const mapped = this.mapLivePayloadToState(parsed, normalizedSymbol, rollingWindowMinutes);
          if (mapped) {
            observer.next(mapped);
          }
        };

        socket.onerror = () => {
          scheduleReconnect('socket error');
        };

        socket.onclose = () => {
          scheduleReconnect('socket closed');
        };
      };

      connect();

      return () => {
        disposed = true;
        bootstrapSub.unsubscribe();
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        cleanSocket();
      };
    });
  }

  private toDashboardState(
    data: AnalyzeResponse | undefined,
    symbol: string,
    offline = false,
    warningMessage = '',
    rollingWindowMinutes: number | null = null
  ): DashboardState {
    const snapshot = this.toSnapshot(data, symbol, offline, rollingWindowMinutes);
    const watchlist = this.toWatchlist(snapshot);
    const breadth = this.toBreadth(watchlist);
    const portfolio = this.toPortfolioSummary(snapshot.price);

    return {
      snapshot,
      watchlist,
      breadth,
      portfolio,
      warningMessage: warningMessage || undefined
    };
  }

  private safeParseWsPayload(payload: unknown): unknown {
    if (typeof payload !== 'string') {
      return payload;
    }
    try {
      return JSON.parse(payload);
    } catch {
      return null;
    }
  }

  // src/app/services/market-data.service.ts

/**
 * Generates the watchlist data based on the current market snapshot.
 * This resolves the TS2339 error in toDashboardState.
 */
private toWatchlist(snapshot: MarketSnapshot): WatchlistItem[] {
  const symbols = this.recentSearchSymbols.length > 0
    ? this.recentSearchSymbols.slice(0, 20)
    : this.watchlistSeed.map((item) => item.symbol);

  return symbols.map((symbol, index) => {
    const seedMatch = this.watchlistSeed.find((item) => item.symbol === symbol);
    
    // Mathematical simulation for watchlist prices if not the active symbol
    const factor = 1 + ((index - 2) * 0.012 + (snapshot.rsi - 50) / 1000);
    const price = symbol === snapshot.stock ? snapshot.price : this.round(snapshot.price * factor, 2);
    const previous = this.round(price * (1 - (index - 2) * 0.004), 2);
    const changePercent = this.round(((price - previous) / previous) * 100, 2);
    
    const trend: TrendDirection = changePercent > 0.6 
      ? 'BULLISH' 
      : changePercent < -0.6 ? 'BEARISH' : 'SIDEWAYS';

    return {
      symbol,
      name: seedMatch?.name ?? `${symbol} Ltd.`,
      price,
      changePercent,
      trend
    };
  });
}

  private mapLivePayloadToState(
    payload: unknown,
    symbol: string,
    rollingWindowMinutes: number | null
  ): DashboardState | null {
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const message = payload as Record<string, unknown>;
    const messageType = String(message['type'] ?? '').toLowerCase();
    if (messageType === 'pong' || messageType === 'ack' || messageType === 'heartbeat') {
      return null;
    }

    if (this.isDashboardStateShape(message)) {
      return message as unknown as DashboardState;
    }

    if (message['data'] && typeof message['data'] === 'object') {
      return this.mapLivePayloadToState(message['data'], symbol, rollingWindowMinutes);
    }

    if ('price' in message || 'candleData' in message || 'foGreeks' in message) {
      return this.toDashboardState(
        message as unknown as AnalyzeResponse,
        symbol,
        false,
        '',
        rollingWindowMinutes
      );
    }

    return null;
  }

  private isDashboardStateShape(payload: Record<string, unknown>): boolean {
    return 'snapshot' in payload && 'watchlist' in payload && 'breadth' in payload && 'portfolio' in payload;
  }

  private tryPayloads(
    payloadCandidates: Array<Record<string, string>>,
    symbol: string,
    rollingWindowMinutes: number | null = null,
    index = 0
  ): Observable<DashboardState> {
    const payload = payloadCandidates[index];
    if (!payload) {
      return throwError(() => new Error('No valid payload candidate available.'));
    }

    return this.http.post<AnalyzeResponse>(this.apiUrl, payload).pipe(
      timeout(this.requestTimeoutMs),
      map((response) => this.toDashboardState(response, symbol, false, '', rollingWindowMinutes)),
      catchError((error: unknown) => {
        const shouldTryNext =
          index < payloadCandidates.length - 1 && this.isValidationError(error);

        if (shouldTryNext) {
          return this.tryPayloads(payloadCandidates, symbol, rollingWindowMinutes, index + 1);
        }

        return throwError(() => error);
      })
    );
  }

  private buildPayloadCandidates(
    symbol: string,
    resolution: string,
    from: string,
    to: string,
    rollingWindowMinutes: number | null = null
  ): Array<Record<string, string>> {
    const safeDates = this.normalizeDateRange(from, to);
    const fyersSymbol = this.toFyersSymbol(symbol);
    const normalizedResolution = this.normalizeResolution(resolution);
    const rollingEpoch = this.getRollingEpochRange(rollingWindowMinutes);
    const fromEpoch = rollingEpoch?.fromEpoch ?? this.toEpochSeconds(safeDates.from);
    const toEpoch = rollingEpoch?.toEpoch ?? this.toEpochSeconds(safeDates.to);
    const epochCandidate: Record<string, string> = {
      symbolName: fyersSymbol,
      symbol: fyersSymbol,
      resolution: normalizedResolution,
      range_from: String(fromEpoch),
      range_to: String(toEpoch),
      date_format: '0',
      cont_flag: '1',
      mode: 'tech'
    };

    const isoCandidates: Array<Record<string, string>> = [
      {
        symbolName: symbol,
        resolution: normalizedResolution,
        range_from: safeDates.from,
        range_to: safeDates.to,
        mode: 'tech'
      },
      {
        symbolName: fyersSymbol,
        symbol: fyersSymbol,
        resolution: normalizedResolution,
        range_from: safeDates.from,
        range_to: safeDates.to,
        date_format: '1',
        cont_flag: '1',
        mode: 'tech'
      }
    ];

    // For intraday lookback, prioritize epoch request first to avoid "today-only" responses.
    return rollingEpoch ? [epochCandidate, ...isoCandidates] : [...isoCandidates, epochCandidate];
  }

  private normalizeDateRange(from: string, to: string): { from: string; to: string } {
    const today = new Date();
    const safeTo = this.isIsoDate(to) ? to : this.toIsoDate(today);

    const fallbackFromDate = new Date(today);
    fallbackFromDate.setDate(fallbackFromDate.getDate() - 7);
    const safeFrom = this.isIsoDate(from) ? from : this.toIsoDate(fallbackFromDate);

    if (safeFrom <= safeTo) {
      return { from: safeFrom, to: safeTo };
    }

    return { from: safeTo, to: safeFrom };
  }

  private normalizeResolution(resolution: string): string {
    const trimmed = resolution.trim().toUpperCase();
    if (trimmed === '1D') {
      return 'D';
    }
    return trimmed;
  }

  private toFyersSymbol(symbol: string): string {
    const clean = symbol.trim().toUpperCase();
    if (clean.includes(':')) {
      return clean;
    }
    const indexMap: Record<string, string> = {
      NIFTY: 'NSE:NIFTY50-INDEX',
      NIFTY50: 'NSE:NIFTY50-INDEX',
      BANKNIFTY: 'NSE:NIFTYBANK-INDEX',
      FINNIFTY: 'NSE:FINNIFTY-INDEX',
      MIDCPNIFTY: 'NSE:MIDCPNIFTY-INDEX'
    };
    if (indexMap[clean]) {
      return indexMap[clean];
    }
    if (clean.endsWith('-EQ')) {
      return `NSE:${clean}`;
    }
    return `NSE:${clean}-EQ`;
  }

  private toEpochSeconds(isoDate: string): number {
    return Math.floor(new Date(`${isoDate}T00:00:00+05:30`).getTime() / 1000);
  }

  private isIsoDate(value: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(value);
  }

  private toIsoDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  private isValidationError(error: unknown): boolean {
    return error instanceof HttpErrorResponse && error.status === 422;
  }

  private toApiMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      const statusText = error.status ? `API ${error.status}` : 'API error';
      const detail =
        typeof error.error === 'string'
          ? error.error
          : (error.error?.message as string | undefined) ??
            (error.error?.error as string | undefined) ??
            error.message;
      return `${statusText}: ${detail}`;
    }

    if (error instanceof Error) {
      return error.message;
    }

    return 'Live API request failed. Showing fallback analytics.';
  }

  // src/app/services/market-data.service.ts
// src/app/services/market-data.service.ts

/**
 * Corrected toSnapshot method to resolve:
 * 1. TS2554: Matching the 4 arguments passed by callers.
 * 2. TS2740: Including all mandatory MarketSnapshot properties.
 */
private toSnapshot(
  data: AnalyzeResponse | undefined | any,
  fallbackSymbol: string,
  offline = false,
  rollingWindowMinutes: number | null = null
): MarketSnapshot {
  const allCandles = this.toCandles(data?.candleData);
  const candles = this.applyRollingWindow(allCandles, rollingWindowMinutes);
  
  const price = this.round(data?.price ?? (candles.at(-1)?.close ?? 0), 2);
  const ema20 = this.round(data?.ema20 ?? this.estimateEma(candles), 2);
  const trend = this.normalizeTrend(data?.trend, price, ema20);

  // Fix TS7006 by adding explicit types (c: Candle)
  const high = data?.high ?? Math.max(...candles.map((c: Candle) => c.high), price);
  const low = data?.low ?? Math.min(...candles.map((c: Candle) => c.low), price);
  const atr = this.estimateAtr(candles, 14);
  const recentSwingLow = this.recentSwingLow(candles, 20) ?? low;
  const recentSwingHigh = this.recentSwingHigh(candles, 20) ?? high;

  const strategy = this.toStrategy({
    price,
    ema20,
    support: data?.support ?? recentSwingLow,
    resistance: data?.resistance ?? recentSwingHigh,
    trend,
    atr
  });

  return {
    stock: data?.stock ?? fallbackSymbol,
    price,
    vwap: data?.vwap ?? price, // Fix TS2339
    open: data?.open ?? (candles[0]?.open ?? price),
    high,
    low,
    previousClose: data?.previousClose ?? this.round(price * 0.992, 2),
    volume: Math.round(data?.volume ?? candles.reduce((sum: number, c: Candle) => sum + c.volume, 0)),
    rsi: this.round(data?.rsi ?? this.estimateRsi(candles), 2),
    ema20,
    support: data?.support ?? low,
    resistance: data?.resistance ?? high,
    trend,
    analysis: data?.analysis ?? data?.aiAnalysis?.summary ?? '',
    candleData: candles,
    foGreeks: this.toGreeks(data?.foGreeks, price),
    strategy,
      insight: this.toInsight({
        trend,
        rsi: data?.rsi ?? 50,
        strategy,
        offline,
        aiAnalysis: data?.aiAnalysis,
        latestNews: data?.latestNews,
        atr
      }),
      updatedAt: Date.now(),
      optionSignal: data?.optionSignal,
      executionContext: data?.executionContext
        ? {
            marketRegime: (String(data.executionContext.marketRegime ?? 'RANGE').toUpperCase() as
              | 'TREND_UP'
              | 'TREND_DOWN'
              | 'HIGH_VOL_CHOP'
              | 'RANGE'),
            trendStrength: this.round(Number(data.executionContext.trendStrength ?? 0), 2),
            volatilityPct: this.round(Number(data.executionContext.volatilityPct ?? 0), 2),
            vwapDistancePct: this.round(Number(data.executionContext.vwapDistancePct ?? 0), 2),
            volumeRatio: this.round(Number(data.executionContext.volumeRatio ?? 0), 2),
            atr: this.round(Number(data.executionContext.atr ?? 0), 2)
          }
        : undefined,
      aiQuality: this.toAiQuality(data?.aiQuality)
    };
  }

// Restore missing helper methods (Fixes TS2339)
private applyRollingWindow(candles: Candle[], rollingWindowMinutes: number | null): Candle[] {
  if (!rollingWindowMinutes || rollingWindowMinutes <= 0 || candles.length === 0) return candles;
  const cutoff = Date.now() - (rollingWindowMinutes * 60 * 1000);
  return candles.filter(c => c.timestamp >= cutoff);
}

private getRollingEpochRange(rollingWindowMinutes: number | null) {
  if (!rollingWindowMinutes) return null;
  const toEpoch = Math.floor(Date.now() / 1000);
  const fromEpoch = toEpoch - (rollingWindowMinutes * 60);
  return { fromEpoch, toEpoch };
}

  private normalizeRecentSymbols(symbols: string[]): string[] {
    const unique = new Set<string>();
    for (const symbol of symbols) {
      const clean = symbol.trim().toUpperCase();
      if (!clean || unique.has(clean)) {
        continue;
      }
      unique.add(clean);
      if (unique.size >= 20) {
        break;
      }
    }
    return Array.from(unique);
  }

  private setRecentSymbols(symbols: string[]): void {
    this.recentSearchSymbols = this.normalizeRecentSymbols(symbols);
    this.saveLocalRecentSymbols(this.recentSearchSymbols);
  }

  private readLocalRecentSymbols(): string[] {
    try {
      const raw = localStorage.getItem(this.watchlistStorageKey);
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }
      return this.normalizeRecentSymbols(parsed.map((value) => String(value)));
    } catch {
      return [];
    }
  }

  private saveLocalRecentSymbols(symbols: string[]): void {
    try {
      localStorage.setItem(this.watchlistStorageKey, JSON.stringify(symbols));
    } catch {
      // ignore storage failures to keep market flow uninterrupted
    }
  }

  private toBreadth(watchlist: WatchlistItem[]): MarketBreadth {
    const advances = watchlist.filter((item) => item.changePercent > 0).length;
    const declines = watchlist.filter((item) => item.changePercent < 0).length;
    const unchanged = watchlist.length - advances - declines;

    return {
      advances,
      declines,
      unchanged,
      volatilityIndex: this.round(12 + (declines / watchlist.length) * 14, 2)
    };
  }

  private toPortfolioSummary(referencePrice: number): PortfolioSummary {
    const priced = this.basePositions.map((position, index) => {
      const drift = 1 + ((index % 2 === 0 ? 1 : -1) * 0.006);
      return {
        ...position,
        lastPrice: this.round(position.symbol === 'RELIANCE' ? referencePrice : position.lastPrice * drift, 2)
      };
    });

    const rawHoldings = priced.map((position): Omit<PortfolioHolding, 'allocationPercent'> => {
      const marketValue = this.round(position.quantity * position.lastPrice, 2);
      const investedValue = this.round(position.quantity * position.averagePrice, 2);
      const pnl = this.round(marketValue - investedValue, 2);
      const pnlPercent = investedValue === 0 ? 0 : this.round((pnl / investedValue) * 100, 2);

      return {
        symbol: position.symbol,
        quantity: position.quantity,
        averagePrice: position.averagePrice,
        lastPrice: position.lastPrice,
        marketValue,
        investedValue,
        pnl,
        pnlPercent
      };
    });

    const totalValue = this.round(rawHoldings.reduce((sum, item) => sum + item.marketValue, 0), 2);
    const investedValue = this.round(rawHoldings.reduce((sum, item) => sum + item.investedValue, 0), 2);
    const totalPnl = this.round(totalValue - investedValue, 2);

    const holdings = rawHoldings.map((item) => ({
      ...item,
      allocationPercent: totalValue === 0 ? 0 : this.round((item.marketValue / totalValue) * 100, 2)
    }));

    return {
      totalValue,
      investedValue,
      dayPnl: this.round(totalPnl * 0.14, 2),
      totalPnl,
      totalPnlPercent: investedValue === 0 ? 0 : this.round((totalPnl / investedValue) * 100, 2),
      holdings
    };
  }

  private toStrategy(input: {
    price: number;
    ema20: number;
    support: number;
    resistance: number;
    trend: TrendDirection;
    atr: number;
  }): TradeStrategy {
    if (input.trend === 'SIDEWAYS') {
      return {
        action: 'WAIT',
        entry: input.price,
        target: this.round(input.price * 1.01, 2),
        stopLoss: this.round(input.price * 0.99, 2),
        riskReward: 1
      };
    }

    const bullish = input.trend === 'BULLISH';
    const entry = this.round(input.ema20, 2);
    const atr = Math.max(input.atr, entry * 0.005, 0.5);
    const maxRiskAbs = Math.max(entry * 0.06, atr * 2.2);

    const rawTarget = bullish ? input.resistance : input.support;
    const rawStop = bullish ? input.support : input.resistance;
    const stopLoss = bullish
      ? this.clamp(rawStop, entry - maxRiskAbs, entry * 0.995)
      : this.clamp(rawStop, entry * 1.005, entry + maxRiskAbs);

    const risk = Math.max(Math.abs(entry - stopLoss), 0.01);
    const minRewardTarget = bullish ? entry + risk * 1.6 : entry - risk * 1.6;
    const target = bullish ? Math.max(rawTarget, minRewardTarget) : Math.min(rawTarget, minRewardTarget);
    const reward = Math.max(Math.abs(target - entry), 0.01);

    return {
      action: bullish ? 'BUY' : 'SELL',
      entry,
      target,
      stopLoss,
      riskReward: this.round(reward / risk, 2)
    };
  }

  private toInsight(input: {
    trend: TrendDirection;
    rsi: number;
    strategy: TradeStrategy;
    offline: boolean;
    atr: number;
    aiAnalysis?:
      | {
          verdict?: string;
          confidence?: number;
          summary?: string;
          entry?: number;
          target?: number;
          stopLoss?: number;
          reasons?: string[];
          risks?: string[];
          newsImpact?: string;
          changed?: string[];
        }
      | undefined;
    latestNews?:
      | Array<{
          title?: string;
          source?: string;
          publishedAt?: string;
          url?: string;
          sentiment?: string;
          relevanceScore?: number;
        }>
      | undefined;
  }): MarketInsight {
    const parsedNews = this.toNews(input.latestNews);
    const apiVerdict = input.aiAnalysis?.verdict?.toUpperCase();
    const verdict: 'BUY' | 'SELL' | 'HOLD' =
      apiVerdict === 'BUY' || apiVerdict === 'SELL' || apiVerdict === 'HOLD'
        ? apiVerdict
        : input.strategy.action === 'WAIT'
          ? 'HOLD'
          : input.strategy.action;

    const confidence = this.clamp(
      Math.round(
        input.aiAnalysis?.confidence ??
          (input.trend === 'SIDEWAYS' ? 58 : 67) +
            Math.abs(50 - input.rsi) / 5 +
            input.strategy.riskReward * 2
      ),
      35,
      94
    );

    const rationale =
      input.aiAnalysis?.reasons && input.aiAnalysis.reasons.length > 0
        ? input.aiAnalysis.reasons
        : [
            `Trend bias is ${input.trend.toLowerCase()} with RSI at ${input.rsi}.`,
            `Proposed action ${input.strategy.action} near ${input.strategy.entry}.`,
            `Risk/reward profile stands at ${input.strategy.riskReward}:1.`
          ];

    const risks =
      input.aiAnalysis?.risks && input.aiAnalysis.risks.length > 0
        ? input.aiAnalysis.risks
        : [
            'High-impact macro headlines can invalidate the setup quickly.',
            'Low liquidity windows increase slippage risk on entries.',
            input.offline
              ? 'Running on fallback analytics because live API was unavailable.'
              : 'Options gamma spikes may increase volatility.'
          ];

    const safeSignal = this.sanitizeSignal({
      verdict,
      entry: Number(input.aiAnalysis?.entry ?? input.strategy.entry),
      target: Number(input.aiAnalysis?.target ?? input.strategy.target),
      stopLoss: Number(input.aiAnalysis?.stopLoss ?? input.strategy.stopLoss),
      atr: Number(input.atr || 0)
    });

    return {
      summary: input.aiAnalysis?.summary ?? `${verdict} bias with ${confidence}% confidence.`,
      confidence,
      verdict,
      entry: this.round(safeSignal.entry, 2),
      target: this.round(safeSignal.target, 2),
      stopLoss: this.round(safeSignal.stopLoss, 2),
      newsImpact:
        input.aiAnalysis?.newsImpact ??
        (parsedNews.length === 0
          ? 'No major news catalyst in current stream.'
          : 'Recent headlines are influencing intraday momentum.'),
      changed: input.aiAnalysis?.changed ?? [],
      latestNews: parsedNews,
      rationale,
      risks
    };
  }

  private sanitizeSignal(input: {
    verdict: 'BUY' | 'SELL' | 'HOLD';
    entry: number;
    target: number;
    stopLoss: number;
    atr: number;
  }): { entry: number; target: number; stopLoss: number } {
    const entry = Math.max(Number(input.entry) || 0, 0.01);
    const atr = Math.max(Number(input.atr) || 0, entry * 0.005, 0.5);
    const maxRiskAbs = Math.max(entry * 0.06, atr * 2.2);

    if (input.verdict === 'BUY') {
      const stopLoss = this.clamp(Number(input.stopLoss) || entry * 0.99, entry - maxRiskAbs, entry * 0.995);
      const risk = Math.max(entry - stopLoss, 0.01);
      const floorTarget = entry + risk * 1.4;
      const target = Math.max(Number(input.target) || floorTarget, floorTarget);
      return { entry, target, stopLoss };
    }

    if (input.verdict === 'SELL') {
      const stopLoss = this.clamp(Number(input.stopLoss) || entry * 1.01, entry * 1.005, entry + maxRiskAbs);
      const risk = Math.max(stopLoss - entry, 0.01);
      const floorTarget = entry - risk * 1.4;
      const target = Math.min(Number(input.target) || floorTarget, floorTarget);
      return { entry, target, stopLoss };
    }

    const stopLoss = this.clamp(Number(input.stopLoss) || entry * 0.99, entry * 0.985, entry * 0.999);
    const target = Math.max(Number(input.target) || entry * 1.01, entry * 1.001);
    return { entry, target, stopLoss };
  }

  private toAiQuality(
    input:
      | {
          version?: string;
          confidenceBand?: string;
          dataFreshnessMs?: number;
          features?: {
            vwapDistancePct?: number;
            trendStrength?: number;
            volatilityPct?: number;
            volumeRatio?: number;
            timeframeAligned?: boolean;
          };
          ruleGate?: {
            passed?: boolean;
            blockedAction?: string;
            reasons?: string[];
          };
        }
      | undefined
  ): AiQuality | undefined {
    if (!input) {
      return undefined;
    }

    const confidenceBand = String(input.confidenceBand ?? 'LOW').toUpperCase();
    const blockedAction = String(input.ruleGate?.blockedAction ?? 'HOLD').toUpperCase();

    return {
      version: String(input.version ?? 'unknown'),
      confidenceBand:
        confidenceBand === 'HIGH' || confidenceBand === 'MEDIUM' ? confidenceBand : 'LOW',
      dataFreshnessMs: Math.max(0, Number(input.dataFreshnessMs ?? 0)),
      features: {
        vwapDistancePct: this.round(Number(input.features?.vwapDistancePct ?? 0), 2),
        trendStrength: this.round(Number(input.features?.trendStrength ?? 0), 2),
        volatilityPct: this.round(Number(input.features?.volatilityPct ?? 0), 2),
        volumeRatio: this.round(Number(input.features?.volumeRatio ?? 0), 2),
        timeframeAligned: Boolean(input.features?.timeframeAligned ?? false)
      },
      ruleGate: {
        passed: Boolean(input.ruleGate?.passed ?? false),
        blockedAction:
          blockedAction === 'BUY' || blockedAction === 'SELL' ? blockedAction : 'HOLD',
        reasons: Array.isArray(input.ruleGate?.reasons)
          ? input.ruleGate!.reasons.slice(0, 5).map((r) => String(r))
          : []
      }
    };
  }

  private toNews(
    input:
      | Array<{
          title?: string;
          source?: string;
          publishedAt?: string;
          url?: string;
          sentiment?: string;
          relevanceScore?: number;
        }>
      | undefined
  ): NewsItem[] {
    if (!input || input.length === 0) {
      return [];
    }

    return input.slice(0, 5).map((item) => {
      const sentiment = item.sentiment?.toUpperCase();
      return {
        title: item.title ?? 'Untitled headline',
        source: item.source ?? 'Unknown',
        publishedAt: item.publishedAt ?? '',
        url: item.url ?? '',
        sentiment:
          sentiment === 'BULLISH' || sentiment === 'BEARISH' ? sentiment : 'NEUTRAL',
        relevanceScore: this.clamp(Number(item.relevanceScore ?? 0.5), 0, 1)
      };
    });
  }

  private toCandles(input: number[][] | undefined): Candle[] {
    if (input && input.length > 0) {
      return input
        .filter((row) => row.length >= 6)
        .map((row) => ({
          timestamp: this.normalizeTimestamp(Number(row[0])),
          open: Number(row[1]),
          high: Number(row[2]),
          low: Number(row[3]),
          close: Number(row[4]),
          volume: Number(row[5])
        }));
    }

    return this.generateSyntheticCandles();
  }

  private normalizeTimestamp(value: number): number {
    if (!Number.isFinite(value) || value <= 0) {
      return Date.now();
    }

    // Candle feeds may send epoch in seconds; UI expects milliseconds.
    return value < 1e12 ? value * 1000 : value;
  }

  private toGreeks(input: Array<Record<string, number | string>> | undefined, price: number): OptionGreek[] {
    if (input && input.length > 0) {
      return input.map((item) => ({
        strikePrice: Number(item['strikePrice'] ?? price),
        optionType: (item['optionType'] === 'PE' ? 'PE' : 'CE') as 'CE' | 'PE',
        delta: Number(item['delta'] ?? 0),
        theta: Number(item['theta'] ?? 0),
        vega: Number(item['vega'] ?? 0),
        gamma: Number(item['gamma'] ?? 0.01),
        iv: Number(item['iv'] ?? 18),
        ltp: Number(item['ltp'] ?? price * 0.03),
        tradeVolume: Number(item['tradeVolume'] ?? 0),
        oi: Number(item['oi'] ?? 0)
      }));
    }

    return this.generateSyntheticGreeks(price);
  }

  private generateSyntheticCandles(): Candle[] {
    const candles: Candle[] = [];
    const now = Date.now();
    let last = 2500;

    for (let i = 120; i > 0; i -= 1) {
      const time = now - i * 5 * 60 * 1000;
      const move = (Math.random() - 0.46) * 10;
      const open = last;
      const close = this.round(last + move, 2);
      const high = this.round(Math.max(open, close) + Math.random() * 6, 2);
      const low = this.round(Math.min(open, close) - Math.random() * 6, 2);
      const volume = Math.round(2400 + Math.random() * 8200);
      candles.push({ timestamp: time, open, high, low, close, volume });
      last = close;
    }

    return candles;
  }

  private generateSyntheticGreeks(price: number): OptionGreek[] {
    const baseStrike = Math.round(price / 50) * 50;
    const strikes = [-100, -50, 0, 50, 100];
    const greeks: OptionGreek[] = [];

    for (const offset of strikes) {
      const strike = baseStrike + offset;
      const moneyness = Math.abs(price - strike) / Math.max(price, 1);
      const iv = this.round(17 + moneyness * 55, 2);
      const gamma = this.round(0.01 + (1 - Math.min(moneyness * 3, 0.85)) * 0.05, 4);

      greeks.push({
        strikePrice: strike,
        optionType: 'CE',
        delta: this.round(0.6 - moneyness * 0.8, 2),
        theta: this.round(-2.3 - moneyness * 1.2, 2),
        vega: this.round(7 + (1 - moneyness) * 5, 2),
        gamma,
        iv,
        ltp: this.round(Math.max(4, (price - strike) * 0.55 + 42), 2),
        tradeVolume: Math.round(12000 + Math.random() * 42000),
        oi: Math.round(50000 + Math.random() * 150000)
      });

      greeks.push({
        strikePrice: strike,
        optionType: 'PE',
        delta: this.round(-(0.6 - moneyness * 0.8), 2),
        theta: this.round(-2.5 - moneyness * 1.25, 2),
        vega: this.round(7.4 + (1 - moneyness) * 5.3, 2),
        gamma,
        iv,
        ltp: this.round(Math.max(4, (strike - price) * 0.55 + 42), 2),
        tradeVolume: Math.round(11000 + Math.random() * 39000),
        oi: Math.round(52000 + Math.random() * 165000)
      });
    }

    return greeks.sort((a, b) => a.strikePrice - b.strikePrice || a.optionType.localeCompare(b.optionType));
  }

  private estimateEma(candles: Candle[]): number {
    if (candles.length === 0) {
      return 0;
    }

    const period = 20;
    const multiplier = 2 / (period + 1);
    let ema = candles[0].close;

    for (let i = 1; i < candles.length; i += 1) {
      ema = candles[i].close * multiplier + ema * (1 - multiplier);
    }

    return ema;
  }

  private estimateRsi(candles: Candle[]): number {
    if (candles.length < 15) {
      return 50;
    }

    const changes = candles.slice(-15).map((candle, i, arr) => (i === 0 ? 0 : candle.close - arr[i - 1].close));
    const gains = changes.filter((change) => change > 0).reduce((sum, value) => sum + value, 0) / 14;
    const losses = Math.abs(changes.filter((change) => change < 0).reduce((sum, value) => sum + value, 0) / 14);

    if (losses === 0) {
      return 100;
    }

    const rs = gains / losses;
    return 100 - 100 / (1 + rs);
  }

  private estimateAtr(candles: Candle[], period = 14): number {
    if (candles.length < 2) {
      return 0;
    }
    const slice = candles.slice(-Math.min(period, candles.length));
    let trSum = 0;
    for (let i = 0; i < slice.length; i += 1) {
      const c = slice[i];
      const prevClose = i === 0 ? c.close : slice[i - 1].close;
      const tr = Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
      trSum += tr;
    }
    return this.round(trSum / slice.length, 2);
  }

  private recentSwingLow(candles: Candle[], lookback = 20): number | null {
    const part = candles.slice(-Math.min(lookback, candles.length));
    if (part.length === 0) return null;
    return Math.min(...part.map((c) => c.low));
  }

  private recentSwingHigh(candles: Candle[], lookback = 20): number | null {
    const part = candles.slice(-Math.min(lookback, candles.length));
    if (part.length === 0) return null;
    return Math.max(...part.map((c) => c.high));
  }

  private normalizeTrend(rawTrend: string | undefined, price: number, ema20: number): TrendDirection {
    if (rawTrend === 'BULLISH' || rawTrend === 'BEARISH' || rawTrend === 'SIDEWAYS') {
      return rawTrend;
    }

    const diff = ((price - ema20) / Math.max(ema20, 1)) * 100;
    if (diff > 0.6) {
      return 'BULLISH';
    }
    if (diff < -0.6) {
      return 'BEARISH';
    }
    return 'SIDEWAYS';
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }

  private round(value: number, precision: number): number {
    const factor = Math.pow(10, precision);
    return Math.round(value * factor) / factor;
  }

  private toPriceAlert(input: PriceAlertsResponseItem): PriceAlert {
    const comparisonRaw = String(input.comparisonType ?? input.dataType ?? 'LTP').toUpperCase();
    const conditionRaw = String(input.condition ?? input.operator ?? 'GTE').toUpperCase();

    const comparisonType: PriceAlert['comparisonType'] =
      comparisonRaw === 'OPEN' || comparisonRaw === 'HIGH' || comparisonRaw === 'LOW' || comparisonRaw === 'CLOSE'
        ? comparisonRaw
        : 'LTP';

    const normalizedCondition = conditionRaw === '>' ? 'GT' : conditionRaw === '<' ? 'LT' : conditionRaw;
    const condition: PriceAlert['condition'] =
      normalizedCondition === 'GT' ||
      normalizedCondition === 'GTE' ||
      normalizedCondition === 'LT' ||
      normalizedCondition === 'LTE' ||
      normalizedCondition === 'EQ'
        ? normalizedCondition
        : 'GTE';

    return {
      alertId: String(input.alertId ?? input.id ?? ''),
      name: String(input.name ?? input.alertName ?? 'Unnamed Alert'),
      symbol: String(input.symbol ?? ''),
      comparisonType,
      condition,
      value: Number(input.value ?? input.threshold ?? 0),
      notes: input.notes ?? input.description,
      active: Boolean(input.active ?? input.is_active ?? true),
      updatedAt: Number(input.updatedAt ?? input.updated_at ?? Date.now())
    };
  }
}
