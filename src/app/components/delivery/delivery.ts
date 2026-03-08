import { CommonModule, DecimalPipe } from '@angular/common';
import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Candle, MarketSnapshot } from '../../models/market.models';
import { TradingviewChartComponent } from '../tradingview-chart/tradingview-chart';

@Component({
  selector: 'app-delivery',
  standalone: true,
  imports: [CommonModule, DecimalPipe, FormsModule, TradingviewChartComponent],
  templateUrl: './delivery.html',
  styleUrl: './delivery.css'
})
export class DeliveryComponent implements OnChanges {
  @Input({ required: true }) snapshot!: MarketSnapshot;
  @Input() historyDays = 60;
  peRatio = 20;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['snapshot']) {
      this.loadPeRatio();
    }
  }

  get shortTermAction(): 'BUY' | 'SELL' | 'HOLD' {
    return this.snapshot.insight?.verdict ?? 'HOLD';
  }

  get shortTermActionClass(): string {
    return this.shortTermAction === 'BUY'
      ? 'tone-buy'
      : this.shortTermAction === 'SELL'
        ? 'tone-sell'
        : 'tone-hold';
  }

  get shortTermEntry(): number {
    return this.round(this.snapshot.insight?.entry ?? this.snapshot.strategy.entry ?? this.endPrice);
  }

  get shortTermStopLoss(): number {
    return this.round(this.snapshot.insight?.stopLoss ?? this.snapshot.strategy.stopLoss ?? this.endPrice * 0.98);
  }

  get shortTermTarget1(): number {
    const directTarget = this.snapshot.insight?.target ?? this.snapshot.strategy.target;
    if (Number.isFinite(directTarget)) {
      return this.round(Number(directTarget));
    }

    const atr = this.snapshot.executionContext?.atr ?? this.endPrice * 0.02;
    if (this.shortTermAction === 'BUY') {
      return this.round(this.shortTermEntry + atr * 1.2);
    }
    if (this.shortTermAction === 'SELL') {
      return this.round(this.shortTermEntry - atr * 1.2);
    }
    return this.round(this.shortTermEntry);
  }

  get shortTermTarget2(): number {
    const risk = Math.abs(this.shortTermEntry - this.shortTermStopLoss);
    if (this.shortTermAction === 'BUY') {
      return this.round(this.shortTermEntry + risk * 2.4);
    }
    if (this.shortTermAction === 'SELL') {
      return this.round(this.shortTermEntry - risk * 2.4);
    }
    return this.round(this.shortTermTarget1);
  }

  get shortTermRiskReward(): number {
    const risk = Math.max(Math.abs(this.shortTermEntry - this.shortTermStopLoss), 0.01);
    const reward = Math.max(Math.abs(this.shortTermTarget1 - this.shortTermEntry), 0.01);
    return this.round(reward / risk);
  }

  get longTermAction(): 'ACCUMULATE' | 'HOLD' | 'AVOID' {
    return this.investmentView;
  }

  get longTermActionClass(): string {
    return this.longTermAction === 'ACCUMULATE'
      ? 'tone-buy'
      : this.longTermAction === 'HOLD'
        ? 'tone-hold'
        : 'tone-sell';
  }

  get longTermEntryFrom(): number {
    if (this.longTermAction === 'AVOID') {
      return this.round(this.endPrice);
    }
    const base = this.longTermAction === 'ACCUMULATE' ? this.sma50 : this.sma200 || this.endPrice;
    const band = this.longTermEntryBandAbs;
    return this.round(Math.max(base - band, 0));
  }

  get longTermEntryTo(): number {
    if (this.longTermAction === 'AVOID') {
      return this.round(this.endPrice);
    }
    const base = this.longTermAction === 'ACCUMULATE' ? this.sma50 : this.endPrice;
    const band = this.longTermEntryBandAbs;
    return this.round(base + band * 0.7);
  }

  get longTermStopLoss(): number {
    if (this.longTermAction === 'AVOID') {
      return this.round(this.endPrice * 0.9);
    }
    const atr = this.dailyAtr;
    const zoneFloor = this.longTermEntryFrom - atr * 1.8;
    const smaSafety = this.sma200 > 0 ? this.sma200 * 0.96 : this.endPrice * 0.9;

    if (this.longTermAction === 'ACCUMULATE') {
      return this.round(Math.max(Math.min(zoneFloor, smaSafety), 0));
    }
    if (this.longTermAction === 'HOLD') {
      return this.round(Math.max(Math.min(zoneFloor, this.sma200 * 0.94 || smaSafety), 0));
    }
    return this.round(Math.max(smaSafety, 0));
  }

  get longTermTarget1(): number {
    if (this.longTermAction === 'AVOID') {
      return this.round(this.endPrice);
    }
    const entry = this.longTermEntryMid;
    const targetByRisk = entry + this.longTermRiskAbs * 2.0;
    const targetByStructure = this.nearResistance;
    return this.round(Math.max(targetByRisk, targetByStructure));
  }

  get longTermTarget2(): number {
    if (this.longTermAction === 'AVOID') {
      return this.round(this.endPrice);
    }
    const entry = this.longTermEntryMid;
    const extension = Math.max(this.longTermRiskAbs * 3.2, this.dailyAtr * 3.5);
    return this.round(Math.max(this.longTermTarget1 + this.dailyAtr * 1.5, entry + extension));
  }

  get longTermHorizon(): string {
    return this.longTermAction === 'ACCUMULATE' ? '6-12 months' : '3-9 months';
  }

  get chartCandles(): Candle[] {
    return this.filteredCandles;
  }

  get startPrice(): number {
    return this.filteredCandles[0]?.close ?? this.snapshot.price;
  }

  get endPrice(): number {
    return this.filteredCandles.at(-1)?.close ?? this.snapshot.price;
  }

  get returnPct(): number {
    return this.safePct(this.endPrice - this.startPrice, this.startPrice);
  }

  get sma50(): number {
    return this.movingAverage(this.filteredCandles, 50);
  }

  get sma200(): number {
    return this.movingAverage(this.filteredCandles, 200);
  }

  get maxDrawdownPct(): number {
    let peak = Number.NEGATIVE_INFINITY;
    let worst = 0;
    for (const candle of this.filteredCandles) {
      peak = Math.max(peak, candle.close);
      const dd = this.safePct(candle.close - peak, peak);
      worst = Math.min(worst, dd);
    }
    return Math.abs(this.round(worst));
  }

  get annualizedVolatilityPct(): number {
    const closes = this.filteredCandles.map((c) => c.close);
    if (closes.length < 3) {
      return 0;
    }
    const rets: number[] = [];
    for (let i = 1; i < closes.length; i += 1) {
      const prev = closes[i - 1];
      if (prev <= 0) continue;
      rets.push((closes[i] - prev) / prev);
    }
    if (rets.length < 2) return 0;
    const mean = rets.reduce((s, v) => s + v, 0) / rets.length;
    const variance = rets.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / (rets.length - 1);
    return this.round(Math.sqrt(variance) * Math.sqrt(252) * 100);
  }

  get investmentView(): 'ACCUMULATE' | 'HOLD' | 'AVOID' {
    const price = this.endPrice;
    if (price > this.sma50 && this.sma50 > this.sma200 && this.maxDrawdownPct < 25) {
      return 'ACCUMULATE';
    }
    if (price >= this.sma200 && this.maxDrawdownPct < 35) {
      return 'HOLD';
    }
    return 'AVOID';
  }

  get dataWindowLabel(): string {
    return `${this.filteredCandles.length} daily candles`;
  }

  get riskTag(): 'LOW' | 'MODERATE' | 'HIGH' {
    if (this.annualizedVolatilityPct < 22) return 'LOW';
    if (this.annualizedVolatilityPct < 35) return 'MODERATE';
    return 'HIGH';
  }

  get peBand(): 'ATTRACTIVE' | 'FAIR' | 'EXPENSIVE' {
    const pe = this.peRatio;
    if (pe <= 18) return 'ATTRACTIVE';
    if (pe <= 30) return 'FAIR';
    return 'EXPENSIVE';
  }

  get investmentViewClass(): string {
    return this.investmentView === 'ACCUMULATE'
      ? 'state-accumulate'
      : this.investmentView === 'HOLD'
        ? 'state-hold'
        : 'state-avoid';
  }

  private get longTermEntryMid(): number {
    return (this.longTermEntryFrom + this.longTermEntryTo) / 2;
  }

  private get longTermRiskAbs(): number {
    return Math.max(this.longTermEntryMid - this.longTermStopLoss, this.endPrice * 0.02);
  }

  private get longTermEntryBandAbs(): number {
    const atrBand = this.dailyAtr * 1.1;
    const pctBand = this.endPrice * 0.015;
    return Math.max(atrBand, pctBand);
  }

  private get nearResistance(): number {
    const highs = this.filteredCandles.slice(-60).map((c) => c.high);
    const localHigh = highs.length > 0 ? Math.max(...highs) : this.snapshot.resistance || this.endPrice;
    return Math.max(localHigh, this.snapshot.resistance || 0, this.endPrice);
  }

  private get dailyAtr(): number {
    const candles = this.filteredCandles.slice(-Math.min(14, this.filteredCandles.length));
    if (candles.length < 2) {
      return Math.max(this.endPrice * 0.02, 1);
    }

    let trSum = 0;
    for (let i = 0; i < candles.length; i += 1) {
      const current = candles[i];
      const prevClose = i === 0 ? current.close : candles[i - 1].close;
      const tr = Math.max(
        current.high - current.low,
        Math.abs(current.high - prevClose),
        Math.abs(current.low - prevClose)
      );
      trSum += tr;
    }
    return this.round(Math.max(trSum / candles.length, 1));
  }

  private get filteredCandles(): Candle[] {
    const sorted = [...this.snapshot.candleData].sort((a, b) => a.timestamp - b.timestamp);
    if (sorted.length === 0) return [];
    const cutoff = Date.now() - this.historyDays * 24 * 60 * 60 * 1000;
    const filtered = sorted.filter((c) => c.timestamp >= cutoff);
    return filtered.length > 0 ? filtered : sorted;
  }

  private movingAverage(candles: Candle[], period: number): number {
    if (candles.length === 0) return 0;
    const part = candles.slice(-Math.min(period, candles.length));
    const avg = part.reduce((sum, c) => sum + c.close, 0) / part.length;
    return this.round(avg);
  }

  private safePct(diff: number, base: number): number {
    if (!Number.isFinite(base) || base === 0) return 0;
    return this.round((diff / base) * 100);
  }

  private round(value: number): number {
    return Math.round(value * 100) / 100;
  }

  savePeRatio(): void {
    try {
      localStorage.setItem(this.peKey(), JSON.stringify({ peRatio: this.peRatio }));
    } catch {
      // ignore storage failures
    }
  }

  private loadPeRatio(): void {
    try {
      const raw = localStorage.getItem(this.peKey());
      if (!raw) return;
      const parsed = JSON.parse(raw) as { peRatio?: number };
      this.peRatio = Number.isFinite(parsed.peRatio) ? Math.max(Number(parsed.peRatio), 0.1) : this.peRatio;
    } catch {
      // ignore storage failures
    }
  }

  private peKey(): string {
    return `anavai.delivery.pe.${this.snapshot?.stock || 'DEFAULT'}`;
  }
}
