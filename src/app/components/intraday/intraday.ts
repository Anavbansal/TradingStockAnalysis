import { CommonModule, DatePipe, DecimalPipe } from '@angular/common';
import { Component, Input } from '@angular/core';
import { Candle, MarketSnapshot, TrendDirection } from '../../models/market.models';
import { TradingviewChartComponent } from '../tradingview-chart/tradingview-chart';

interface TradeLeg {
  entry: number;
  target: number;
  stopLoss: number;
  riskReward: number;
}

interface IntradaySignal {
  side: 'BUY' | 'SELL' | 'HOLD';
  plan: TradeLeg;
  score: number;
  confidence: number;
  confidenceBand: 'HIGH' | 'MEDIUM' | 'LOW';
  blockedReasons: string[];
}

@Component({
  selector: 'app-intraday',
  standalone: true,
  imports: [CommonModule, DecimalPipe, DatePipe, TradingviewChartComponent],
  templateUrl: './intraday.html',
  styleUrl: './intraday.css'
})
export class IntradayComponent {
  @Input({ required: true }) snapshot!: MarketSnapshot;
  @Input() lookbackDays = 30;
  @Input() interval = '5';

  get chartCandles(): Candle[] {
    return this.sortedCandles.slice(-this.lookbackBars);
  }

  get dataDepthLabel(): string {
    const candles = this.sortedCandles.length;
    return `${candles} candles loaded`;
  }

  get chartCandleBars(): Array<{
    x: number;
    width: number;
    wickWidth: number;
    wickTop: number;
    wickHeight: number;
    bodyTop: number;
    bodyHeight: number;
    bullish: boolean;
  }> {
    const candles = this.chartCandles;
    if (candles.length === 0) {
      return [];
    }

    const high = this.chartHigh;
    const low = this.chartLow;
    const spread = Math.max(high - low, 0.01);
    const slot = 100 / candles.length;
    const width = Math.max(slot * 0.58, 0.7);

    const toY = (price: number): number => 100 - ((price - low) / spread) * 100;

    return candles.map((candle, idx) => {
      const openY = toY(candle.open);
      const closeY = toY(candle.close);
      const highY = toY(candle.high);
      const lowY = toY(candle.low);

      return {
        x: idx * slot + (slot - width) / 2,
        width,
        wickWidth: Math.max(width * 0.06, 0.18),
        wickTop: highY,
        wickHeight: Math.max(lowY - highY, 0.85),
        bodyTop: Math.min(openY, closeY),
        bodyHeight: Math.max(Math.abs(openY - closeY), 0.85),
        bullish: candle.close >= candle.open
      };
    });
  }

  get chartHigh(): number {
    return this.chartCandles.reduce((max, candle) => Math.max(max, candle.high), Number.NEGATIVE_INFINITY);
  }

  get chartLow(): number {
    return this.chartCandles.reduce((min, candle) => Math.min(min, candle.low), Number.POSITIVE_INFINITY);
  }

  get dayChangePercent(): number {
    const base = this.snapshot.previousClose;
    if (base === 0) {
      return 0;
    }
    return this.round(((this.snapshot.price - base) / base) * 100);
  }

  get isPositiveDay(): boolean {
    return this.dayChangePercent >= 0;
  }

  get chartPath(): string {
    const points = this.chartPoints;
    if (points.length === 0) {
      return '';
    }

    return points
      .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
      .join(' ');
  }

  get chartAreaPath(): string {
    const points = this.chartPoints;
    if (points.length === 0) {
      return '';
    }

    const first = points[0];
    const last = points.at(-1);
    if (!first || !last) {
      return '';
    }

    return `${this.chartPath} L ${last.x.toFixed(2)} 100 L ${first.x.toFixed(2)} 100 Z`;
  }

  // src/app/components/intraday/intraday.ts
// src/app/components/intraday/intraday.ts

get signal(): IntradaySignal {
  const price = this.snapshot.price;
  const analysisBars = Math.min(this.lookbackBars, 5 * 75);
  const analysisCandles = this.sortedCandles.slice(-analysisBars);
  const vwapFromCandles = this.estimateVwap(analysisCandles);
  const vwap = this.snapshot.vwap || vwapFromCandles || price;
  const timeframe = this.snapshot.timeframeAnalysis;
  const consistency = this.snapshot.trendConsistency;
  const { atr } = this.baseLevels(analysisCandles);

  // 1. Determine the Execution Side (Based on VWAP Hard Filter)
  const vwapSide: 'BUY' | 'SELL' = price > vwap ? 'BUY' : 'SELL';
  
  // 2. Map the Side to TrendDirection to fix TS2367
  // This allows us to compare "BULLISH" with timeframe.m1 which is also a TrendDirection
  const expectedTrend: TrendDirection = vwapSide === 'BUY' ? 'BULLISH' : 'BEARISH';

  // 3. Multi-Timeframe Validation
  // Comparing matching types: TrendDirection === TrendDirection
  const isAligned = timeframe ? 
    (timeframe.m1 === expectedTrend && 
     timeframe.m5 === expectedTrend && 
     timeframe.m15 === expectedTrend) : 
    false;

  // 4. Signal Filtering Logic
  const side = vwapSide;
  const baseConfidence = this.snapshot.insight.confidence;
  const gate = this.snapshot.aiQuality?.ruleGate;
  
  // Penalize confidence if trends are DIVERGENT across timeframes
  const depthBoost = analysisCandles.length >= 150 ? 3 : 0;
  const adjustedConfidence = (consistency === 'CONFIRMED' && isAligned)
    ? Math.min(baseConfidence + depthBoost, 95)
    : Math.min(baseConfidence, 55);

  const finalSide: IntradaySignal['side'] = gate?.passed === false ? 'HOLD' : side;
  const entry = price;
  const stopLoss = finalSide === 'BUY' ? (price - (atr * 1.5)) : (price + (atr * 1.5));
  const target = finalSide === 'BUY' ? (price + (atr * 3)) : (price - (atr * 3));
  const rr = finalSide === 'HOLD' ? 0 : this.safeRr(entry, stopLoss, target);

  return {
    side: finalSide,
    plan: {
      entry: this.round(entry),
      stopLoss: this.round(stopLoss),
      target: this.round(target),
      riskReward: this.round(rr)
    },
    confidence: finalSide === 'HOLD' ? Math.min(adjustedConfidence, 54) : adjustedConfidence,
    confidenceBand: this.snapshot.aiQuality?.confidenceBand ?? 'LOW',
    blockedReasons: gate?.passed === false ? gate.reasons : [],
    // Score is neutralized to 50 if the timeframes are not in sync
    score: finalSide === 'HOLD' ? 45 : isAligned ? this.snapshot.rsi : 50
  };
}

  get regimeLabel(): string {
    const regime = this.snapshot.executionContext?.marketRegime;
    if (!regime) {
      return 'RANGE';
    }
    return regime.replace(/_/g, ' ');
  }

  get trendStrength(): number {
    return this.snapshot.executionContext?.trendStrength ?? 0;
  }

  get volatilityPct(): number {
    return this.snapshot.executionContext?.volatilityPct ?? 0;
  }

  get vwapDistancePct(): number {
    return this.snapshot.executionContext?.vwapDistancePct ?? 0;
  }

  get volumeRatio(): number {
    return this.snapshot.executionContext?.volumeRatio ?? 0;
  }

  get atr(): number {
    return this.snapshot.executionContext?.atr ?? this.baseLevels(this.sortedCandles).atr;
  }

  get maxVolume(): number {
    const volumes = this.chartCandles.map((candle) => candle.volume);
    return Math.max(...volumes, 1);
  }

  get recentCandles(): Candle[] {
    const normalized = this.toFiveMinuteCandles(this.snapshot.candleData);
    return this.ensureTwelveCandles(normalized).slice(-12).reverse();
  }

  private get sortedCandles(): Candle[] {
    return [...this.snapshot.candleData].sort((a, b) => a.timestamp - b.timestamp);
  }

  private get lookbackBars(): number {
    const barsPerDay = 75;
    return Math.max(30, Math.floor(this.lookbackDays) * barsPerDay);
  }

  isBullish(candle: Candle): boolean {
    return candle.close >= candle.open;
  }

  private get chartPoints(): Array<{ x: number; y: number }> {
    const candles = this.chartCandles;
    if (candles.length === 0) {
      return [];
    }

    const high = this.chartHigh;
    const low = this.chartLow;
    const spread = Math.max(high - low, 0.01);
    const width = 100;
    const stepX = candles.length === 1 ? width : width / (candles.length - 1);

    return candles.map((candle, index) => {
      const normalized = (candle.close - low) / spread;
      return {
        x: index * stepX,
        y: 100 - normalized * 100
      };
    });
  }

  private baseLevels(source: Candle[]): { price: number; atr: number } {
    const recent = source.slice(-21);
    const fallbackAtr = Math.max(this.snapshot.price * 0.003, 1);
    if (recent.length < 2) {
      return { price: this.snapshot.price, atr: fallbackAtr };
    }

    const trueRanges = recent.map((candle, index) => {
      if (index === 0) {
        return candle.high - candle.low;
      }
      const prevClose = recent[index - 1].close;
      return Math.max(
        candle.high - candle.low,
        Math.abs(candle.high - prevClose),
        Math.abs(candle.low - prevClose)
      );
    });

    const atr = trueRanges.reduce((sum, value) => sum + value, 0) / trueRanges.length;
    return {
      price: this.snapshot.price,
      atr: Math.max(atr, fallbackAtr)
    };
  }

  private estimateVwap(candles: Candle[]): number {
    if (!candles || candles.length === 0) {
      return this.snapshot.price;
    }
    let numerator = 0;
    let denominator = 0;
    for (const candle of candles) {
      const typicalPrice = (candle.high + candle.low + candle.close) / 3;
      numerator += typicalPrice * candle.volume;
      denominator += candle.volume;
    }
    if (denominator === 0) {
      return candles[candles.length - 1]?.close ?? this.snapshot.price;
    }
    return numerator / denominator;
  }

  private toFiveMinuteCandles(candles: Candle[]): Candle[] {
    if (candles.length === 0) {
      return [];
    }

    const bucketed = new Map<number, Candle>();

    for (const candle of candles) {
      const bucketTime = Math.floor(candle.timestamp / (5 * 60 * 1000)) * (5 * 60 * 1000);
      const existing = bucketed.get(bucketTime);

      if (!existing) {
        bucketed.set(bucketTime, {
          timestamp: bucketTime,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume
        });
        continue;
      }

      bucketed.set(bucketTime, {
        timestamp: bucketTime,
        open: existing.open,
        high: Math.max(existing.high, candle.high),
        low: Math.min(existing.low, candle.low),
        close: candle.close,
        volume: existing.volume + candle.volume
      });
    }

    return Array.from(bucketed.values()).sort((a, b) => a.timestamp - b.timestamp);
  }

  private ensureTwelveCandles(candles: Candle[]): Candle[] {
    if (candles.length >= 12) {
      return candles;
    }

    const padded = [...candles];
    const base = padded[0] ?? {
      timestamp: Date.now(),
      open: this.snapshot.price,
      high: this.snapshot.price,
      low: this.snapshot.price,
      close: this.snapshot.price,
      volume: 0
    };

    while (padded.length < 12) {
      const earliest = padded[0] ?? base;
      const carry = earliest.open;
      padded.unshift({
        timestamp: earliest.timestamp - 5 * 60 * 1000,
        open: carry,
        high: carry,
        low: carry,
        close: carry,
        volume: 0
      });
    }

    return padded;
  }

  private safeRr(entry: number, stopLoss: number, target: number): number {
    const risk = Math.max(Math.abs(entry - stopLoss), 0.01);
    const reward = Math.max(Math.abs(target - entry), 0.01);
    return this.round(reward / risk);
  }

  private average(values: number[]): number {
    if (values.length === 0) {
      return 0;
    }
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  private safeDiv(a: number, b: number): number {
    return b === 0 ? 0 : a / b;
  }

  private toConfidence(score: number): number {
    const normalized = Math.min(Math.abs(score), 3);
    return Math.round(52 + normalized * 14);
  }

  private round(value: number): number {
    return Math.round(value * 100) / 100;
  }
}
