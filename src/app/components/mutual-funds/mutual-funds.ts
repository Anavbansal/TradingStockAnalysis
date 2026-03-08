import { CommonModule, DecimalPipe } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { catchError, finalize, forkJoin, map, of } from 'rxjs';
import { MutualFundNavPoint, MutualFundScheme, MutualFundSnapshot } from '../../models/market.models';
import { MutualFundService } from '../../services/mutual-fund.service';

type RecommendationAction = 'BUY' | 'WATCH' | 'AVOID';
type RankingBucket = 'Size' | 'Sector';

interface MetricSchema {
  alpha: number;
  cagr: number;
  rollingReturn3Y: number;
  sharpeRatio: number;
  sortinoRatio: number;
  informationRatio: number;
  standardDeviation: number;
  beta: number;
  rSquared: number;
  upsideCapture: number;
  downsideCapture: number;
  expenseRatio: number | null;
  turnoverRatio: number | null;
  exitLoad: number | null;
  trackingError: number;
}

interface SegmentConfig {
  bucket: RankingBucket;
  segment: string;
  searchTerms: string[];
  benchmarkTerms: string[];
  risk: string;
  horizon: string;
}

interface RankedFund {
  bucket: RankingBucket;
  segment: string;
  schemeCode: string;
  schemeName: string;
  nav: number;
  risk: string;
  horizon: string;
  score: number;
  verdict: RecommendationAction;
  metrics: MetricSchema;
}

interface GroupedRank {
  segment: string;
  rows: RankedFund[];
}

interface SchemeRankInfo {
  bucket: RankingBucket;
  segment: string;
  rank: number;
  score: number;
}

@Component({
  selector: 'app-mutual-funds',
  standalone: true,
  imports: [CommonModule, FormsModule, DecimalPipe],
  templateUrl: './mutual-funds.html',
  styleUrl: './mutual-funds.css'
})
export class MutualFundsComponent implements OnInit {
  query = '';
  monthlySip = 5000;
  sipYears = 10;
  expectedReturnPct = 12;
  investorProfile: 'conservative' | 'balanced' | 'aggressive' = 'balanced';
  investmentHorizonYears = 7;
  backtestLumpsum = 100000;
  backtestMonthlySip = 5000;
  backtestStartPreset = '2020-03-01';

  isDirectoryLoading = false;
  isHistoryLoading = false;
  isRankingLoading = false;
  errorMessage = '';
  rankingMessage = '';
  rankedFunds: RankedFund[] = [];
  lastRefreshAt: number | null = null;
  selectedSizeSegment = '';
  selectedSectorSegment = '';

  private allSchemes: MutualFundScheme[] = [];
  filteredSchemes: MutualFundScheme[] = [];
  selected: MutualFundSnapshot | null = null;
  private schemeRankMap = new Map<string, SchemeRankInfo[]>();
  private benchmarkHistoryBySegment = new Map<string, MutualFundNavPoint[]>();
  private readonly riskFreeRate = 6.5;
  private readonly rankingMonthKeyStorage = 'anavai.mf.schema.month';
  private readonly rankingPayloadStorage = 'anavai.mf.schema.payload';
  private readonly rankingTimestampStorage = 'anavai.mf.schema.ts';

  readonly segmentConfigs: SegmentConfig[] = [
    { bucket: 'Size', segment: 'Large Cap', searchTerms: ['large cap'], benchmarkTerms: ['nifty 100 index'], risk: 'Moderate', horizon: '5+ years' },
    { bucket: 'Size', segment: 'Mid Cap', searchTerms: ['mid cap'], benchmarkTerms: ['nifty midcap 150 index'], risk: 'High', horizon: '7+ years' },
    { bucket: 'Size', segment: 'Small Cap', searchTerms: ['small cap'], benchmarkTerms: ['nifty smallcap 250 index'], risk: 'Very High', horizon: '8+ years' },
    { bucket: 'Size', segment: 'Flexi Cap', searchTerms: ['flexi cap'], benchmarkTerms: ['nifty 500 index'], risk: 'Moderately High', horizon: '5+ years' },
    { bucket: 'Size', segment: 'Multi Cap', searchTerms: ['multi cap'], benchmarkTerms: ['nifty 500 index'], risk: 'Moderately High', horizon: '6+ years' },
    { bucket: 'Sector', segment: 'Technology', searchTerms: ['technology', 'it fund'], benchmarkTerms: ['nifty it index'], risk: 'Very High', horizon: '7+ years' },
    { bucket: 'Sector', segment: 'Pharma', searchTerms: ['pharma', 'healthcare'], benchmarkTerms: ['nifty pharma index'], risk: 'High', horizon: '6+ years' },
    { bucket: 'Sector', segment: 'Banking & Financials', searchTerms: ['banking', 'financial services'], benchmarkTerms: ['nifty bank index'], risk: 'High', horizon: '6+ years' },
    { bucket: 'Sector', segment: 'Infrastructure', searchTerms: ['infrastructure'], benchmarkTerms: ['nifty infrastructure'], risk: 'Very High', horizon: '8+ years' },
    { bucket: 'Sector', segment: 'Consumption', searchTerms: ['consumption', 'fmcg'], benchmarkTerms: ['nifty india consumption'], risk: 'High', horizon: '6+ years' }
  ];

  readonly backtestPresets: Array<{ label: string; value: string }> = [
    { label: 'Global Crisis Start (Jan 2008)', value: '2008-01-01' },
    { label: 'Covid Crash Start (Mar 2020)', value: '2020-03-01' },
    { label: 'Rate-Hike Cycle Start (Jan 2022)', value: '2022-01-01' }
  ];

  readonly costProfiles: Array<{ keywords: string[]; expenseRatio: number; turnoverRatio: number; exitLoad: number }> = [
    { keywords: ['small cap'], expenseRatio: 0.75, turnoverRatio: 35, exitLoad: 1.0 },
    { keywords: ['mid cap'], expenseRatio: 0.72, turnoverRatio: 32, exitLoad: 1.0 },
    { keywords: ['large cap'], expenseRatio: 0.55, turnoverRatio: 24, exitLoad: 1.0 },
    { keywords: ['flexi cap'], expenseRatio: 0.68, turnoverRatio: 28, exitLoad: 1.0 },
    { keywords: ['multi cap'], expenseRatio: 0.72, turnoverRatio: 30, exitLoad: 1.0 },
    { keywords: ['technology', 'it fund'], expenseRatio: 0.88, turnoverRatio: 42, exitLoad: 1.0 },
    { keywords: ['pharma', 'healthcare'], expenseRatio: 0.86, turnoverRatio: 40, exitLoad: 1.0 },
    { keywords: ['banking', 'financial services'], expenseRatio: 0.82, turnoverRatio: 36, exitLoad: 1.0 },
    { keywords: ['infrastructure'], expenseRatio: 0.9, turnoverRatio: 44, exitLoad: 1.0 },
    { keywords: ['consumption', 'fmcg'], expenseRatio: 0.84, turnoverRatio: 34, exitLoad: 1.0 }
  ];

  constructor(private readonly mfService: MutualFundService) {}

  ngOnInit(): void {
    this.loadDirectory();
  }

  get currentNav(): number {
    return this.round(this.selected?.navHistory.at(-1)?.nav ?? 0, 4);
  }

  get return1Y(): number {
    return this.returnByDays(365);
  }

  get chartPath(): string {
    const points = this.selected?.navHistory ?? [];
    if (points.length < 2) {
      return '';
    }
    const min = Math.min(...points.map((p) => p.nav));
    const max = Math.max(...points.map((p) => p.nav));
    const spread = Math.max(max - min, 0.0001);
    const step = 100 / Math.max(points.length - 1, 1);
    return points
      .map((p, idx) => {
        const x = idx * step;
        const y = 100 - ((p.nav - min) / spread) * 100;
        return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(' ');
  }

  get sizeGroups(): GroupedRank[] {
    return this.groupBySegment('Size');
  }

  get sectorGroups(): GroupedRank[] {
    return this.groupBySegment('Sector');
  }

  get nextMonthlyRefreshAt(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
  }

  get sizeSegments(): string[] {
    return this.sizeGroups.map((g) => g.segment);
  }

  get sectorSegments(): string[] {
    return this.sectorGroups.map((g) => g.segment);
  }

  get activeSizeRows(): RankedFund[] {
    const active = this.sizeGroups.find((g) => g.segment === this.selectedSizeSegment);
    return active?.rows ?? [];
  }

  get activeSectorRows(): RankedFund[] {
    const active = this.sectorGroups.find((g) => g.segment === this.selectedSectorSegment);
    return active?.rows ?? [];
  }

  get selectedMetrics(): MetricSchema | null {
    const fund = this.selected;
    if (!fund || fund.navHistory.length < 12) {
      return null;
    }
    const segment = this.inferSegmentForSelected(fund);
    const benchmark = this.benchmarkHistoryBySegment.get(segment) ?? [];
    return this.computeMetrics(fund.navHistory, benchmark, fund.schemeName);
  }

  get selectedScore(): number {
    const metrics = this.selectedMetrics;
    if (!metrics) {
      return 0;
    }
    return this.computeScore(metrics);
  }

  get selectedVerdict(): RecommendationAction {
    const metrics = this.selectedMetrics;
    if (!metrics) {
      return 'WATCH';
    }

    const score = this.selectedScore;
    const riskHigh = metrics.standardDeviation > 28 || metrics.downsideCapture > 110;
    if (score < 45 || metrics.sharpeRatio < 0 || metrics.cagr < 8) {
      return 'AVOID';
    }
    if (this.investorProfile === 'conservative' && score >= 72 && !riskHigh && this.investmentHorizonYears >= 7) {
      return 'BUY';
    }
    if (this.investorProfile === 'balanced' && score >= 65 && this.investmentHorizonYears >= 5) {
      return 'BUY';
    }
    if (this.investorProfile === 'aggressive' && score >= 58 && this.investmentHorizonYears >= 4) {
      return 'BUY';
    }
    return 'WATCH';
  }

  get selectedTechnicalReasons(): string[] {
    const m = this.selectedMetrics;
    if (!m) {
      return [];
    }
    return [
      `Alpha ${m.alpha}% and Information Ratio ${m.informationRatio} indicate active outperformance consistency.`,
      `CAGR ${m.cagr}% and Rolling 3Y ${m.rollingReturn3Y}% show return durability.`,
      `Sharpe ${m.sharpeRatio}, Sortino ${m.sortinoRatio}, and Std Dev ${m.standardDeviation}% define risk-adjusted efficiency.`,
      `Beta ${m.beta}, R2 ${m.rSquared}, Upside Capture ${m.upsideCapture}, Downside Capture ${m.downsideCapture}, Tracking Error ${m.trackingError}.`
    ];
  }

  get selectedNonTechnicalReasons(): string[] {
    const m = this.selectedMetrics;
    if (!m) {
      return [];
    }
    const reasons: string[] = [
      `Profile set as ${this.investorProfile} with ${this.investmentHorizonYears}-year horizon.`,
      this.investmentHorizonYears < 5 ? 'Short horizon increases timing risk for equity mutual funds.' : 'Horizon is aligned with equity mutual-fund cycles.'
    ];
    if (m.standardDeviation > 28) {
      reasons.push('Volatility is high, so SIP discipline and drawdown tolerance are required.');
    } else {
      reasons.push('Volatility is moderate relative to peer equity categories.');
    }
    reasons.push(`Estimated TER ${m.expenseRatio ?? 'NA'}%, PTR ${m.turnoverRatio ?? 'NA'}%, Exit Load ${m.exitLoad ?? 'NA'}%. Verify actual AMC factsheet values before investing.`);
    return reasons;
  }

  get backtestSummary():
    | {
        lumpsumInvested: number;
        lumpsumValue: number;
        lumpsumReturnPct: number;
        sipInvested: number;
        sipValue: number;
        sipXirrApprox: number;
      }
    | null {
    const history = this.selected?.navHistory ?? [];
    if (history.length < 60) {
      return null;
    }

    const start = new Date(this.backtestStartPreset).getTime();
    const filtered = history.filter((p) => p.timestamp >= start);
    if (filtered.length < 12) {
      return null;
    }

    const startNav = filtered[0].nav;
    const endNav = filtered.at(-1)?.nav ?? startNav;
    if (startNav <= 0 || endNav <= 0) {
      return null;
    }

    const lumpsumUnits = this.backtestLumpsum / startNav;
    const lumpsumValue = lumpsumUnits * endNav;
    const lumpsumReturnPct = ((lumpsumValue - this.backtestLumpsum) / this.backtestLumpsum) * 100;

    const monthly = this.toMonthly(filtered);
    let sipUnits = 0;
    for (const point of monthly) {
      if (point.nav > 0) {
        sipUnits += this.backtestMonthlySip / point.nav;
      }
    }
    const sipInvested = monthly.length * this.backtestMonthlySip;
    const sipValue = sipUnits * endNav;
    const years = Math.max(1 / 12, monthly.length / 12);
    const sipXirrApprox = sipInvested > 0 ? (Math.pow(sipValue / sipInvested, 1 / years) - 1) * 100 : 0;

    return {
      lumpsumInvested: this.round(this.backtestLumpsum, 2),
      lumpsumValue: this.round(lumpsumValue, 2),
      lumpsumReturnPct: this.round(lumpsumReturnPct, 2),
      sipInvested: this.round(sipInvested, 2),
      sipValue: this.round(sipValue, 2),
      sipXirrApprox: this.round(sipXirrApprox, 2)
    };
  }

  getSchemeRankLabel(schemeCode: string): string {
    const ranks = this.schemeRankMap.get(schemeCode) ?? [];
    if (ranks.length === 0) {
      return '';
    }
    return ranks
      .map((item) => `${item.bucket}: ${item.segment} #${item.rank}`)
      .join(' | ');
  }

  get sipInvested(): number {
    return this.monthlySip * this.sipYears * 12;
  }

  get sipFutureValue(): number {
    const n = this.sipYears * 12;
    const r = this.expectedReturnPct / 100 / 12;
    if (r <= 0) {
      return this.sipInvested;
    }
    return this.round(this.monthlySip * (((Math.pow(1 + r, n) - 1) / r) * (1 + r)), 2);
  }

  get sipGain(): number {
    return this.round(this.sipFutureValue - this.sipInvested, 2);
  }

  onQueryChange(): void {
    const q = this.query.trim().toLowerCase();
    this.filteredSchemes = !q
      ? this.allSchemes.slice(0, 20)
      : this.allSchemes.filter((s) => s.schemeName.toLowerCase().includes(q) || s.schemeCode.toLowerCase().includes(q)).slice(0, 20);
  }

  selectScheme(code: string): void {
    this.isHistoryLoading = true;
    this.errorMessage = '';
    this.mfService.getSchemeHistory(code).subscribe({
      next: (snapshot) => {
        this.selected = snapshot;
        this.isHistoryLoading = false;
      },
      error: () => {
        this.errorMessage = 'Unable to load mutual fund NAV history.';
        this.isHistoryLoading = false;
      }
    });
  }

  refreshRankingsNow(): void {
    this.loadRankings(true);
  }

  private loadDirectory(): void {
    this.isDirectoryLoading = true;
    this.mfService.getSchemeDirectory().subscribe({
      next: (schemes) => {
        this.allSchemes = schemes;
        this.filteredSchemes = schemes.slice(0, 20);
        this.isDirectoryLoading = false;
        if (schemes.length > 0) {
          this.selectScheme(schemes[0].schemeCode);
        }
        this.loadRankings(false);
      },
      error: () => {
        this.isDirectoryLoading = false;
        this.errorMessage = 'Unable to load mutual fund scheme directory.';
      }
    });
  }

  private loadRankings(forceRefresh: boolean): void {
    const monthKey = this.currentMonthKey();
    if (!forceRefresh && this.loadRankingsFromCache(monthKey)) {
      return;
    }

    const candidates = this.collectCandidates();
    if (candidates.length === 0) {
      this.rankingMessage = 'No funds found for configured size/sector segments.';
      return;
    }

    const benchmarkBySegment = new Map<string, MutualFundScheme | null>();
    for (const config of this.segmentConfigs) {
      benchmarkBySegment.set(config.segment, this.findBenchmark(config));
    }

    const benchmarkSchemes = Array.from(new Map(
      Array.from(benchmarkBySegment.values())
        .filter((x): x is MutualFundScheme => x !== null)
        .map((scheme) => [scheme.schemeCode, scheme])
    ).values());

    this.isRankingLoading = true;
    this.rankingMessage = '';

    const benchmarkReq = benchmarkSchemes.map((scheme) =>
      this.mfService.getSchemeHistory(scheme.schemeCode).pipe(
        map((snapshot) => ({ code: scheme.schemeCode, history: snapshot.navHistory })),
        catchError(() => of({ code: scheme.schemeCode, history: [] as MutualFundNavPoint[] }))
      )
    );

    const candidateReq = candidates.map((candidate) =>
      this.mfService.getSchemeHistory(candidate.schemeCode).pipe(
        map((snapshot) => ({ candidate, snapshot })),
        catchError(() => of(null))
      )
    );

    forkJoin([forkJoin(benchmarkReq), forkJoin(candidateReq)])
      .pipe(finalize(() => (this.isRankingLoading = false)))
      .subscribe({
        next: ([benchRows, fundRows]) => {
          const benchmarkHistoryByCode = new Map<string, MutualFundNavPoint[]>(benchRows.map((x) => [x.code, x.history]));
          const output: RankedFund[] = [];
          this.benchmarkHistoryBySegment.clear();
          for (const cfg of this.segmentConfigs) {
            const benchScheme = benchmarkBySegment.get(cfg.segment);
            const history = benchScheme ? benchmarkHistoryByCode.get(benchScheme.schemeCode) ?? [] : [];
            this.benchmarkHistoryBySegment.set(cfg.segment, history);
          }

          for (const row of fundRows) {
            if (!row) {
              continue;
            }
            const benchScheme = benchmarkBySegment.get(row.candidate.segment);
            const benchHistory = benchScheme ? benchmarkHistoryByCode.get(benchScheme.schemeCode) ?? [] : [];
            const metrics = this.computeMetrics(row.snapshot.navHistory, benchHistory, row.snapshot.schemeName);
            const score = this.computeScore(metrics);
            output.push({
              bucket: row.candidate.bucket,
              segment: row.candidate.segment,
              schemeCode: row.snapshot.schemeCode,
              schemeName: row.snapshot.schemeName,
              nav: this.round(row.snapshot.navHistory.at(-1)?.nav ?? 0, 4),
              risk: row.candidate.risk,
              horizon: row.candidate.horizon,
              score,
              verdict: this.verdict(score),
              metrics
            });
          }

          this.rankedFunds = this.topFivePerSegment(output);
          this.rebuildSchemeRankMap();
          this.syncSegmentDropdowns();
          this.lastRefreshAt = Date.now();
          this.persistRankings(monthKey);
        },
        error: () => {
          this.rankingMessage = 'Ranking refresh failed.';
        }
      });
  }

  private collectCandidates(): Array<SegmentConfig & { schemeCode: string }> {
    const rows: Array<SegmentConfig & { schemeCode: string }> = [];
    for (const config of this.segmentConfigs) {
      const picked = this.findFunds(config).slice(0, 10);
      for (const scheme of picked) {
        rows.push({ ...config, schemeCode: scheme.schemeCode });
      }
    }
    return rows;
  }

  private findFunds(config: SegmentConfig): MutualFundScheme[] {
    return this.allSchemes.filter((scheme) => {
      const name = scheme.schemeName.toLowerCase();
      const hasTerm = config.searchTerms.some((term) => name.includes(term));
      if (!hasTerm) {
        return false;
      }
      if (!name.includes('direct plan') || !name.includes('growth')) {
        return false;
      }
      const avoid = ['idcw', 'dividend', 'etf', 'fof', 'regular plan'];
      return !avoid.some((term) => name.includes(term));
    });
  }

  private findBenchmark(config: SegmentConfig): MutualFundScheme | null {
    const exact = this.allSchemes.find((scheme) => {
      const name = scheme.schemeName.toLowerCase();
      return config.benchmarkTerms.some((term) => name.includes(term))
        && name.includes('index fund')
        && name.includes('direct plan')
        && name.includes('growth');
    });
    if (exact) {
      return exact;
    }
    return this.allSchemes.find((scheme) => scheme.schemeName.toLowerCase().includes('nifty 500 index fund')) ?? null;
  }

  private computeMetrics(fundHistory: MutualFundNavPoint[], benchHistory: MutualFundNavPoint[], schemeName: string): MetricSchema {
    const fundM = this.toMonthly(fundHistory);
    const benchM = this.toMonthly(benchHistory);
    const aligned = this.alignReturns(fundM, benchM);
    const rfM = Math.pow(1 + this.riskFreeRate / 100, 1 / 12) - 1;

    const f = aligned.fund;
    const b = aligned.benchmark;
    const excessF = f.map((x) => x - rfM);
    const excessB = b.map((x) => x - rfM);

    const std = this.stdDev(f) * Math.sqrt(12) * 100;
    const beta = this.variance(excessB) > 0 ? this.covariance(excessF, excessB) / this.variance(excessB) : 1;
    const alpha = (this.mean(excessF) - beta * this.mean(excessB)) * 12 * 100;
    const cagr = this.cagrMonths(fundM, 60) || this.cagrMonths(fundM, 36);
    const rolling = this.rolling3Y(fundM);
    const annF = this.mean(f) * 12 * 100;
    const annB = this.mean(b) * 12 * 100;
    const sharpe = std > 0 ? (annF - this.riskFreeRate) / std : 0;
    const sortinoDen = this.downsideDeviation(excessF) * Math.sqrt(12) * 100;
    const sortino = sortinoDen > 0 ? (annF - this.riskFreeRate) / sortinoDen : 0;
    const active = f.map((x, idx) => x - (b[idx] ?? 0));
    const tracking = this.stdDev(active) * Math.sqrt(12) * 100;
    const info = tracking > 0 ? (annF - annB) / tracking : 0;
    const corr = this.correlation(f, b);
    const rsq = Math.pow(corr, 2) * 100;
    const capture = this.captureRatios(f, b);
    const costs = this.resolveCostProfile(schemeName);

    return {
      alpha: this.round(alpha, 2),
      cagr: this.round(cagr, 2),
      rollingReturn3Y: this.round(rolling, 2),
      sharpeRatio: this.round(sharpe, 3),
      sortinoRatio: this.round(sortino, 3),
      informationRatio: this.round(info, 3),
      standardDeviation: this.round(std, 2),
      beta: this.round(beta, 3),
      rSquared: this.round(rsq, 2),
      upsideCapture: this.round(capture.upside, 2),
      downsideCapture: this.round(capture.downside, 2),
      expenseRatio: costs.expenseRatio,
      turnoverRatio: costs.turnoverRatio,
      exitLoad: costs.exitLoad,
      trackingError: this.round(tracking, 2)
    };
  }

  private computeScore(m: MetricSchema): number {
    const alpha = this.scale(m.alpha, -8, 12, 0, 14);
    const cagr = this.scale(m.cagr, 0, 25, 0, 14);
    const rolling = this.scale(m.rollingReturn3Y, 0, 22, 0, 12);
    const sharpe = this.scale(m.sharpeRatio, -0.2, 1.4, 0, 12);
    const sortino = this.scale(m.sortinoRatio, -0.2, 2.2, 0, 10);
    const info = this.scale(m.informationRatio, -0.2, 1.2, 0, 8);
    const r2 = this.scale(m.rSquared, 30, 95, 0, 8);
    const up = this.scale(m.upsideCapture, 70, 150, 0, 6);
    const volPenalty = this.scale(m.standardDeviation, 10, 45, 0, 8);
    const betaPenalty = this.scale(Math.abs(m.beta - 1), 0, 0.8, 0, 6);
    const downPenalty = this.scale(m.downsideCapture, 60, 140, 0, 8);
    const tePenalty = this.scale(m.trackingError, 1, 12, 0, 6);
    const terPenalty = m.expenseRatio !== null ? this.scale(m.expenseRatio, 0.4, 1.2, 0, 4) : 0;
    const ptrPenalty = m.turnoverRatio !== null ? this.scale(m.turnoverRatio, 15, 60, 0, 3) : 0;
    const exitPenalty = m.exitLoad !== null ? this.scale(m.exitLoad, 0, 1.5, 0, 2) : 0;
    const raw =
      alpha + cagr + rolling + sharpe + sortino + info + r2 + up - volPenalty - betaPenalty - downPenalty - tePenalty - terPenalty - ptrPenalty - exitPenalty;
    return Math.max(0, Math.min(100, this.round(raw, 1)));
  }

  private topFivePerSegment(rows: RankedFund[]): RankedFund[] {
    const groups = new Map<string, RankedFund[]>();
    for (const row of rows) {
      const key = `${row.bucket}|${row.segment}`;
      const curr = groups.get(key) ?? [];
      curr.push(row);
      groups.set(key, curr);
    }
    const out: RankedFund[] = [];
    for (const items of groups.values()) {
      out.push(...items.sort((a, b) => b.score - a.score).slice(0, 5));
    }
    return out;
  }

  private groupBySegment(bucket: RankingBucket): GroupedRank[] {
    const ordered = this.segmentConfigs.filter((x) => x.bucket === bucket).map((x) => x.segment);
    return ordered
      .map((segment) => ({
        segment,
        rows: this.rankedFunds.filter((x) => x.bucket === bucket && x.segment === segment).sort((a, b) => b.score - a.score)
      }))
      .filter((x) => x.rows.length > 0);
  }

  private verdict(score: number): RecommendationAction {
    if (score >= 68) {
      return 'BUY';
    }
    if (score < 45) {
      return 'AVOID';
    }
    return 'WATCH';
  }

  private currentMonthKey(date = new Date()): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  private loadRankingsFromCache(monthKey: string): boolean {
    try {
      const month = localStorage.getItem(this.rankingMonthKeyStorage);
      const payload = localStorage.getItem(this.rankingPayloadStorage);
      const ts = localStorage.getItem(this.rankingTimestampStorage);
      if (!month || month !== monthKey || !payload) {
        return false;
      }
      const parsed = JSON.parse(payload) as RankedFund[];
      if (!Array.isArray(parsed) || parsed.length === 0) {
        return false;
      }
      this.rankedFunds = parsed;
      this.rebuildSchemeRankMap();
      this.syncSegmentDropdowns();
      this.lastRefreshAt = Number(ts ?? 0) || null;
      return true;
    } catch {
      return false;
    }
  }

  private persistRankings(monthKey: string): void {
    try {
      localStorage.setItem(this.rankingMonthKeyStorage, monthKey);
      localStorage.setItem(this.rankingPayloadStorage, JSON.stringify(this.rankedFunds));
      localStorage.setItem(this.rankingTimestampStorage, String(this.lastRefreshAt ?? Date.now()));
    } catch {
      // ignore
    }
  }

  private syncSegmentDropdowns(): void {
    if (!this.selectedSizeSegment || !this.sizeSegments.includes(this.selectedSizeSegment)) {
      this.selectedSizeSegment = this.sizeSegments[0] ?? '';
    }
    if (!this.selectedSectorSegment || !this.sectorSegments.includes(this.selectedSectorSegment)) {
      this.selectedSectorSegment = this.sectorSegments[0] ?? '';
    }
  }

  private rebuildSchemeRankMap(): void {
    const next = new Map<string, SchemeRankInfo[]>();
    for (const bucket of ['Size', 'Sector'] as RankingBucket[]) {
      const groups = this.groupBySegment(bucket);
      for (const group of groups) {
        group.rows.forEach((row, idx) => {
          const list = next.get(row.schemeCode) ?? [];
          list.push({
            bucket,
            segment: group.segment,
            rank: idx + 1,
            score: row.score
          });
          next.set(row.schemeCode, list);
        });
      }
    }
    this.schemeRankMap = next;
  }

  private inferSegmentForSelected(fund: MutualFundSnapshot): string {
    const text = `${fund.schemeName} ${fund.category ?? ''}`.toLowerCase();
    const matched = this.segmentConfigs.find((cfg) => cfg.searchTerms.some((term) => text.includes(term)));
    return matched?.segment ?? 'Flexi Cap';
  }

  private resolveCostProfile(schemeName: string): { expenseRatio: number | null; turnoverRatio: number | null; exitLoad: number | null } {
    const text = schemeName.toLowerCase();
    const match = this.costProfiles.find((item) => item.keywords.some((k) => text.includes(k)));
    if (!match) {
      return { expenseRatio: null, turnoverRatio: null, exitLoad: null };
    }
    return {
      expenseRatio: match.expenseRatio,
      turnoverRatio: match.turnoverRatio,
      exitLoad: match.exitLoad
    };
  }

  private toMonthly(history: MutualFundNavPoint[]): MutualFundNavPoint[] {
    const mapByMonth = new Map<string, MutualFundNavPoint>();
    for (const point of history) {
      const d = new Date(point.timestamp);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      mapByMonth.set(key, point);
    }
    return Array.from(mapByMonth.values()).sort((a, b) => a.timestamp - b.timestamp);
  }

  private alignReturns(fund: MutualFundNavPoint[], bench: MutualFundNavPoint[]): { fund: number[]; benchmark: number[] } {
    const f = this.toReturns(fund);
    if (bench.length < 2) {
      return { fund: f, benchmark: f.map(() => 0) };
    }

    const bMap = new Map<string, MutualFundNavPoint>();
    const fMap = new Map<string, MutualFundNavPoint>();
    for (const item of fund) {
      const d = new Date(item.timestamp);
      fMap.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, item);
    }
    for (const item of bench) {
      const d = new Date(item.timestamp);
      bMap.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, item);
    }

    const keys = Array.from(fMap.keys()).filter((k) => bMap.has(k)).sort();
    if (keys.length < 3) {
      return { fund: f, benchmark: f.map(() => 0) };
    }
    const fundPoints = keys.map((k) => fMap.get(k)!);
    const benchPoints = keys.map((k) => bMap.get(k)!);
    return { fund: this.toReturns(fundPoints), benchmark: this.toReturns(benchPoints) };
  }

  private toReturns(points: MutualFundNavPoint[]): number[] {
    if (points.length < 2) {
      return [];
    }
    const out: number[] = [];
    for (let i = 1; i < points.length; i += 1) {
      const prev = points[i - 1].nav;
      const curr = points[i].nav;
      if (prev > 0) {
        out.push((curr - prev) / prev);
      }
    }
    return out;
  }

  private cagrMonths(points: MutualFundNavPoint[], months: number): number {
    if (points.length < months + 1) {
      return 0;
    }
    const start = points.at(-(months + 1));
    const end = points.at(-1);
    if (!start || !end || start.nav <= 0) {
      return 0;
    }
    const years = months / 12;
    return (Math.pow(end.nav / start.nav, 1 / years) - 1) * 100;
  }

  private rolling3Y(points: MutualFundNavPoint[]): number {
    const window = 36;
    if (points.length < window + 1) {
      return 0;
    }
    const out: number[] = [];
    for (let i = window; i < points.length; i += 1) {
      const start = points[i - window];
      const end = points[i];
      if (start.nav > 0) {
        out.push((Math.pow(end.nav / start.nav, 1 / 3) - 1) * 100);
      }
    }
    return out.length > 0 ? this.mean(out) : 0;
  }

  private captureRatios(fund: number[], bench: number[]): { upside: number; downside: number } {
    const upFund: number[] = [];
    const upBench: number[] = [];
    const downFund: number[] = [];
    const downBench: number[] = [];
    const len = Math.min(fund.length, bench.length);

    for (let i = 0; i < len; i += 1) {
      if (bench[i] > 0) {
        upFund.push(fund[i]);
        upBench.push(bench[i]);
      } else if (bench[i] < 0) {
        downFund.push(fund[i]);
        downBench.push(bench[i]);
      }
    }

    const upF = this.compound(upFund);
    const upB = this.compound(upBench);
    const downF = this.compound(downFund);
    const downB = this.compound(downBench);
    const upside = upB !== 0 ? (upF / upB) * 100 : 100;
    const downside = downB !== 0 ? (downF / downB) * 100 : 100;
    return { upside: Number.isFinite(upside) ? upside : 100, downside: Number.isFinite(downside) ? downside : 100 };
  }

  private compound(values: number[]): number {
    if (values.length === 0) {
      return 0;
    }
    return values.reduce((acc, x) => acc * (1 + x), 1) - 1;
  }

  private downsideDeviation(values: number[]): number {
    if (values.length === 0) {
      return 0;
    }
    const d = values.map((x) => Math.min(x, 0));
    const v = d.reduce((sum, x) => sum + x * x, 0) / d.length;
    return Math.sqrt(v);
  }

  private returnByDays(days: number): number {
    const history = this.selected?.navHistory ?? [];
    if (history.length < 2) {
      return 0;
    }
    const latest = history.at(-1);
    if (!latest) {
      return 0;
    }
    const older = this.closestBefore(history, latest.timestamp - days * 24 * 60 * 60 * 1000);
    if (!older || older.nav <= 0) {
      return 0;
    }
    return this.round(((latest.nav - older.nav) / older.nav) * 100, 2);
  }

  private closestBefore(history: MutualFundNavPoint[], targetTs: number): MutualFundNavPoint | null {
    let candidate: MutualFundNavPoint | null = null;
    for (const point of history) {
      if (point.timestamp <= targetTs) {
        candidate = point;
      } else {
        break;
      }
    }
    return candidate ?? history[0] ?? null;
  }

  private mean(values: number[]): number {
    return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
  }

  private variance(values: number[]): number {
    if (values.length === 0) {
      return 0;
    }
    const m = this.mean(values);
    return values.reduce((sum, v) => sum + Math.pow(v - m, 2), 0) / values.length;
  }

  private stdDev(values: number[]): number {
    return Math.sqrt(this.variance(values));
  }

  private covariance(a: number[], b: number[]): number {
    const len = Math.min(a.length, b.length);
    if (len === 0) {
      return 0;
    }
    const aa = a.slice(0, len);
    const bb = b.slice(0, len);
    const ma = this.mean(aa);
    const mb = this.mean(bb);
    let sum = 0;
    for (let i = 0; i < len; i += 1) {
      sum += (aa[i] - ma) * (bb[i] - mb);
    }
    return sum / len;
  }

  private correlation(a: number[], b: number[]): number {
    const len = Math.min(a.length, b.length);
    if (len === 0) {
      return 0;
    }
    const aa = a.slice(0, len);
    const bb = b.slice(0, len);
    const sa = this.stdDev(aa);
    const sb = this.stdDev(bb);
    if (sa <= 0 || sb <= 0) {
      return 0;
    }
    return this.covariance(aa, bb) / (sa * sb);
  }

  private scale(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
    if (!Number.isFinite(value)) {
      return outMin;
    }
    if (inMax <= inMin) {
      return outMin;
    }
    const ratio = (value - inMin) / (inMax - inMin);
    const clamped = Math.max(0, Math.min(1, ratio));
    return outMin + clamped * (outMax - outMin);
  }

  private round(value: number, precision = 2): number {
    const factor = Math.pow(10, precision);
    return Math.round(value * factor) / factor;
  }
}
