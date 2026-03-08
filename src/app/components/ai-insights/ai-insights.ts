import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { CreatePriceAlertInput, MarketSnapshot } from '../../models/market.models';

interface BacktestSummary {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  netR: number;
  maxDrawdownR: number;
}

interface JournalRow {
  ts: number;
  symbol: string;
  verdict: 'BUY' | 'SELL' | 'HOLD';
  entry: number;
  target: number;
  stopLoss: number;
  confidence: number;
}

interface CopilotLaunchResponse {
  launchUrl?: string;
}

@Component({
  selector: 'app-ai-insights',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './ai-insights.html',
  styleUrl: './ai-insights.css'
})
export class AiInsightsComponent implements OnChanges {
  @Input({ required: true }) snapshot!: MarketSnapshot;
  @Output() quickAlert = new EventEmitter<CreatePriceAlertInput>();

  lastDeltaLabel = 'Initial sync';
  capital = 200000;
  riskPerTradePct = 1;
  epsGrowthPct = 12;
  debtToEquity = 0.8;
  roePct = 14;
  peRatio = 20;
  copilotUrl: SafeResourceUrl | null = null;
  copilotError = '';
  isCopilotLaunching = false;

  constructor(
    private readonly http: HttpClient,
    private readonly sanitizer: DomSanitizer
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    const current = changes['snapshot']?.currentValue as MarketSnapshot | undefined;
    const previous = changes['snapshot']?.previousValue as MarketSnapshot | undefined;
    if (!current || !previous) {
      this.lastDeltaLabel = 'Initial sync';
      this.loadFundamentals();
      return;
    }

    const priceDiff = current.price - previous.price;
    const rsiDiff = current.rsi - previous.rsi;
    const trendChanged = current.trend !== previous.trend;

    const changesList: string[] = [];
    if (Math.abs(priceDiff) > 0.01) {
      changesList.push(`Price ${priceDiff >= 0 ? '+' : ''}${priceDiff.toFixed(2)}`);
    }
    if (Math.abs(rsiDiff) >= 0.1) {
      changesList.push(`RSI ${rsiDiff >= 0 ? '+' : ''}${rsiDiff.toFixed(2)}`);
    }
    if (trendChanged) {
      changesList.push(`Trend ${previous.trend} -> ${current.trend}`);
    }

    this.lastDeltaLabel = changesList.length > 0 ? changesList.join(' | ') : 'No major change';
    this.loadFundamentals();
  }

  get verdictClass(): string {
    if (this.snapshot.insight.verdict === 'BUY') {
      return 'verdict-buy';
    }
    if (this.snapshot.insight.verdict === 'SELL') {
      return 'verdict-sell';
    }
    return 'verdict-hold';
  }

  get gatePassed(): boolean {
    return this.snapshot.aiQuality?.ruleGate?.passed ?? true;
  }

  get gateReasons(): string[] {
    return this.snapshot.aiQuality?.ruleGate?.reasons ?? [];
  }

  get confidenceBand(): string {
    return this.snapshot.aiQuality?.confidenceBand ?? 'LOW';
  }

  get timeframeAligned(): boolean {
    const tf = this.snapshot.timeframeAnalysis;
    if (!tf) {
      return false;
    }
    return tf.m1 === tf.m5 && tf.m5 === tf.m15;
  }

  get regimeMode(): 'TREND' | 'RANGE' | 'HIGH_VOL' {
    const regime = this.snapshot.executionContext?.marketRegime ?? 'RANGE';
    if (regime === 'TREND_UP' || regime === 'TREND_DOWN') {
      return 'TREND';
    }
    if (regime === 'HIGH_VOL_CHOP') {
      return 'HIGH_VOL';
    }
    return 'RANGE';
  }

  get trendScore(): number {
    const base = this.snapshot.trendConsistency === 'CONFIRMED' ? 82 : 54;
    const alignmentBonus = this.timeframeAligned ? 10 : -8;
    return this.clamp(base + alignmentBonus, 0, 100);
  }

  get volatilityScore(): number {
    const vol = this.snapshot.executionContext?.volatilityPct ?? 0;
    if (vol <= 0.8) return 78;
    if (vol <= 1.4) return 70;
    if (vol <= 2.2) return 58;
    return 44;
  }

  get newsScore(): number {
    const news = this.snapshot.insight.latestNews;
    if (!news || news.length === 0) {
      return 62;
    }
    const bull = news.filter((n) => n.sentiment === 'BULLISH').length;
    const bear = news.filter((n) => n.sentiment === 'BEARISH').length;
    const score = 62 + (bull - bear) * 8;
    return this.clamp(score, 35, 85);
  }

  get qualityScore(): number {
    const band = this.snapshot.aiQuality?.confidenceBand ?? 'LOW';
    if (band === 'HIGH') return 84;
    if (band === 'MEDIUM') return 70;
    return 56;
  }

  get blendedConfidence(): number {
    const avg = (this.trendScore + this.volatilityScore + this.newsScore + this.qualityScore) / 4;
    return this.round(avg);
  }

  get entry(): number {
    return Number(this.snapshot.insight.entry ?? this.snapshot.price);
  }

  get stopLoss(): number {
    return Number(this.snapshot.insight.stopLoss ?? this.snapshot.price);
  }

  get target(): number {
    return Number(this.snapshot.insight.target ?? this.snapshot.price);
  }

  get riskPerShare(): number {
    return Math.max(Math.abs(this.entry - this.stopLoss), 0.01);
  }

  get riskCapital(): number {
    return (this.capital * this.riskPerTradePct) / 100;
  }

  get regimeRiskMultiplier(): number {
    if (this.regimeMode === 'HIGH_VOL') return 0.5;
    if (this.regimeMode === 'RANGE') return 0.7;
    return 1;
  }

  get suggestedQty(): number {
    const raw = Math.floor(this.riskCapital / this.riskPerShare);
    return Math.max(Math.floor(raw * this.regimeRiskMultiplier), 0);
  }

  get suggestedPositionValue(): number {
    return this.round(this.suggestedQty * this.entry);
  }

  get reliabilityFlags(): string[] {
    const flags: string[] = [];
    const freshness = this.snapshot.aiQuality?.dataFreshnessMs ?? Math.max(Date.now() - this.snapshot.updatedAt, 0);
    if (freshness > 15 * 60 * 1000) {
      flags.push('Data is stale (>15m).');
    }
    if (!this.gatePassed) {
      flags.push('Rule gate blocked execution.');
    }
    if (this.snapshot.trendConsistency === 'DIVERGENT') {
      flags.push('Timeframe trend divergence detected.');
    }
    if ((this.snapshot.executionContext?.volatilityPct ?? 0) > 2.2) {
      flags.push('High volatility regime active.');
    }
    return flags;
  }

  get explainabilityRows(): Array<{ k: string; v: string }> {
    return [
      { k: 'Trend Consistency', v: this.snapshot.trendConsistency ?? 'UNKNOWN' },
      { k: 'Timeframe Alignment', v: this.timeframeAligned ? 'ALIGNED' : 'NOT ALIGNED' },
      { k: 'VWAP Distance', v: `${this.round(this.snapshot.executionContext?.vwapDistancePct ?? 0)}%` },
      { k: 'ATR', v: `${this.round(this.snapshot.executionContext?.atr ?? 0)}` },
      { k: 'Volume Ratio', v: `${this.round(this.snapshot.executionContext?.volumeRatio ?? 0)}x` },
      { k: 'Regime', v: this.regimeMode }
    ];
  }

  get backtest(): BacktestSummary {
    return this.computeBacktest();
  }

  get fundamentalScore(): number {
    const eps = this.clamp(this.epsGrowthPct, -20, 40);
    const debt = this.clamp(this.debtToEquity, 0, 4);
    const roe = this.clamp(this.roePct, 0, 35);
    const pe = this.clamp(this.peRatio, 1, 120);
    // Reward relatively lower valuation without overpowering growth/profitability.
    const peScore = this.clamp(100 - ((pe - 10) / 50) * 100, 0, 100);
    const score = 45 + eps * 0.85 + roe * 0.75 - debt * 8 + peScore * 0.18;
    return this.round(this.clamp(score, 0, 100));
  }

  get journal(): JournalRow[] {
    return this.readJournal();
  }

  saveFundamentals(): void {
    try {
      const key = this.fundamentalKey();
      localStorage.setItem(
        key,
        JSON.stringify({
          epsGrowthPct: this.epsGrowthPct,
          debtToEquity: this.debtToEquity,
          roePct: this.roePct,
          peRatio: this.peRatio
        })
      );
    } catch {
      // ignore storage failures
    }
  }

  addJournalRow(): void {
    const current = this.readJournal();
    const next: JournalRow = {
      ts: Date.now(),
      symbol: this.snapshot.stock,
      verdict: this.snapshot.insight.verdict,
      entry: this.round(this.entry),
      target: this.round(this.target),
      stopLoss: this.round(this.stopLoss),
      confidence: this.snapshot.insight.confidence
    };

    const merged = [next, ...current].slice(0, 40);
    try {
      localStorage.setItem(this.journalKey(), JSON.stringify(merged));
    } catch {
      // ignore storage failures
    }
  }

  clearJournal(): void {
    try {
      localStorage.removeItem(this.journalKey());
    } catch {
      // ignore storage failures
    }
  }

  createQuickAlert(kind: 'entry' | 'target' | 'stopLoss'): void {
    const side = this.snapshot.insight.verdict;
    const value = kind === 'entry' ? this.entry : kind === 'target' ? this.target : this.stopLoss;
    let condition: CreatePriceAlertInput['condition'] = 'GTE';
    if (kind === 'stopLoss') {
      condition = side === 'BUY' ? 'LTE' : 'GTE';
    } else if (kind === 'target') {
      condition = side === 'BUY' ? 'GTE' : 'LTE';
    } else {
      condition = side === 'SELL' ? 'LTE' : 'GTE';
    }

    this.quickAlert.emit({
      name: `${this.snapshot.stock} ${kind.toUpperCase()} ${this.round(value)}`,
      symbol: this.snapshot.stock,
      comparisonType: 'LTP',
      condition,
      value: this.round(value),
      notes: `Quick ${kind} alert from AI Insight`
    });
  }

  openCopilot(): void {
    if (this.isCopilotLaunching) {
      return;
    }

    this.isCopilotLaunching = true;
    this.copilotError = '';

    this.http
      .post<CopilotLaunchResponse>('/api/copilot/session-token', {
        symbol: this.snapshot.stock,
        userId: this.currentCopilotUserId()
      })
      .subscribe({
        next: (response) => {
          const launchUrl = String(response.launchUrl || '').trim();
          if (!launchUrl) {
            this.copilotError = 'Copilot launch URL is missing.';
            this.copilotUrl = null;
            this.isCopilotLaunching = false;
            return;
          }
          this.copilotUrl = this.sanitizer.bypassSecurityTrustResourceUrl(launchUrl);
          this.isCopilotLaunching = false;
        },
        error: () => {
          this.copilotError = 'Unable to initialize Copilot session.';
          this.isCopilotLaunching = false;
        }
      });
  }

  private currentCopilotUserId(): string {
    try {
      const raw = localStorage.getItem('anavai.auth.angel');
      if (!raw) {
        return 'default-user';
      }
      const parsed = JSON.parse(raw) as { userId?: string };
      const userId = String(parsed.userId || '').trim();
      return userId || 'default-user';
    } catch {
      return 'default-user';
    }
  }

  private loadFundamentals(): void {
    try {
      const raw = localStorage.getItem(this.fundamentalKey());
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as { epsGrowthPct?: number; debtToEquity?: number; roePct?: number; peRatio?: number };
      this.epsGrowthPct = Number.isFinite(parsed.epsGrowthPct) ? Number(parsed.epsGrowthPct) : this.epsGrowthPct;
      this.debtToEquity = Number.isFinite(parsed.debtToEquity) ? Number(parsed.debtToEquity) : this.debtToEquity;
      this.roePct = Number.isFinite(parsed.roePct) ? Number(parsed.roePct) : this.roePct;
      this.peRatio = Number.isFinite(parsed.peRatio) ? Number(parsed.peRatio) : this.peRatio;
    } catch {
      // ignore storage failures
    }
  }

  private computeBacktest(): BacktestSummary {
    const candles = [...(this.snapshot.candleData || [])].sort((a, b) => a.timestamp - b.timestamp).slice(-320);
    if (candles.length < 80) {
      return { trades: 0, wins: 0, losses: 0, winRate: 0, netR: 0, maxDrawdownR: 0 };
    }

    const closes = candles.map((c) => c.close);
    const ema = this.ema(closes, 20);
    let wins = 0;
    let losses = 0;
    let equityR = 0;
    let peak = 0;
    let maxDd = 0;

    for (let i = 25; i < candles.length - 6; i += 1) {
      const entry = closes[i];
      const side: 'BUY' | 'SELL' = entry >= ema[i] ? 'BUY' : 'SELL';
      const atr = this.atr(candles.slice(Math.max(0, i - 14), i + 1));
      const risk = Math.max(atr * 1.1, entry * 0.004);
      const stop = side === 'BUY' ? entry - risk : entry + risk;
      const target = side === 'BUY' ? entry + risk * 1.6 : entry - risk * 1.6;

      let outcomeR = -1;
      for (let j = i + 1; j <= Math.min(i + 5, candles.length - 1); j += 1) {
        const c = candles[j];
        const hitStop = side === 'BUY' ? c.low <= stop : c.high >= stop;
        const hitTarget = side === 'BUY' ? c.high >= target : c.low <= target;
        if (hitTarget && !hitStop) {
          outcomeR = 1.6;
          break;
        }
        if (hitStop && !hitTarget) {
          outcomeR = -1;
          break;
        }
        if (hitStop && hitTarget) {
          outcomeR = -1;
          break;
        }
      }

      equityR += outcomeR;
      peak = Math.max(peak, equityR);
      maxDd = Math.max(maxDd, peak - equityR);

      if (outcomeR > 0) wins += 1;
      else losses += 1;
    }

    const trades = wins + losses;
    return {
      trades,
      wins,
      losses,
      winRate: trades === 0 ? 0 : this.round((wins / trades) * 100),
      netR: this.round(equityR),
      maxDrawdownR: this.round(maxDd)
    };
  }

  private ema(values: number[], period: number): number[] {
    if (values.length === 0) {
      return [];
    }
    const k = 2 / (period + 1);
    const out = [values[0]];
    for (let i = 1; i < values.length; i += 1) {
      out.push(values[i] * k + out[i - 1] * (1 - k));
    }
    return out;
  }

  private atr(candles: Array<{ high: number; low: number; close: number }>): number {
    if (candles.length < 2) {
      return 0;
    }
    let sum = 0;
    for (let i = 0; i < candles.length; i += 1) {
      const c = candles[i];
      const prevClose = i === 0 ? c.close : candles[i - 1].close;
      sum += Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
    }
    return sum / candles.length;
  }

  private readJournal(): JournalRow[] {
    try {
      const raw = localStorage.getItem(this.journalKey());
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.slice(0, 40) as JournalRow[];
    } catch {
      return [];
    }
  }

  private fundamentalKey(): string {
    return `anavai.fundamental.${this.snapshot.stock || 'DEFAULT'}`;
  }

  private journalKey(): string {
    return `anavai.journal.${this.snapshot.stock || 'DEFAULT'}`;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }

  private round(value: number): number {
    return Math.round(value * 100) / 100;
  }
}
