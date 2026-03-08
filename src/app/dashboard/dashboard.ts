import { CommonModule, DecimalPipe, DatePipe } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { finalize, Subscription } from 'rxjs';
import { AiInsightsComponent } from '../components/ai-insights/ai-insights';
import { FoGreeksComponent } from '../components/fo-greeks/fo-greeks';
import { IntradayComponent } from '../components/intraday/intraday';
import { PortfolioComponent } from '../components/portfolio/portfolio';
import { TradingviewChartComponent } from '../components/tradingview-chart/tradingview-chart';
import { DeliveryComponent } from '../components/delivery/delivery';
import { MutualFundsComponent } from '../components/mutual-funds/mutual-funds';
import {
  CreatePriceAlertInput,
  DashboardState,
  MarketBreadth,
  OptionGreek,
  MarketSnapshot,
  PortfolioSummary,
  PriceAlert,
  WatchlistItem
} from '../models/market.models';
import {
  AngelGainersLosersItem,
  AngelHolding,
  AngelOptionGreekItem,
  AngelOiBuildupItem,
  AngelPcrItem,
  AngelUserProfile,
  AuthService
} from '../services/auth.service';
import { MarketDataService, SymbolSuggestion } from '../services/market-data.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IntradayComponent,
    DeliveryComponent,
    FoGreeksComponent,
    AiInsightsComponent,
    PortfolioComponent,
    TradingviewChartComponent,
    MutualFundsComponent,
    DecimalPipe,
    DatePipe
  ],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css'
})
export class DashboardComponent implements OnInit, OnDestroy {
  readonly navItems: Array<{ key: DashboardViewSection; label: string }> = [
    { key: 'home', label: 'Home' },
    { key: 'portfolio', label: 'Portfolio' },
    { key: 'watchlist', label: 'WatchList' },
    { key: 'intraday', label: 'Intraday' },
    { key: 'delivery', label: 'Delivery' },
    { key: 'fo', label: 'F&O' },
    { key: 'mutualfunds', label: 'Mutual Funds' },
    { key: 'enhancements', label: 'Enhancements' }
  ];

  readonly resolutions = [
    { label: '1m', value: '1' },
    { label: '5m', value: '5' },
    { label: '10m', value: '10' },
    { label: '15m', value: '15' },
    { label: '30m', value: '30' },
    { label: '1h', value: '60' },
    { label: '1D', value: 'D' }
  ];
  readonly intradayChartWindows: Array<{ label: string; value: string }> = [
    { label: '1m | 1D', value: '1|1' },
    { label: '5m | 3D', value: '5|3' },
    { label: '5m | 5D', value: '5|5' },
    { label: '10m | 10D', value: '10|10' },
    { label: '15m | 10D', value: '15|10' },
    { label: '30m | 1M', value: '30|30' },
    { label: '1h | 2M', value: '60|60' }
  ];
  readonly deliveryChartWindows: Array<{ label: string; value: string }> = [
    { label: '1D | 1M', value: 'D|30' },
    { label: '1D | 2M', value: 'D|60' },
    { label: '1D | 6M', value: 'D|180' },
    { label: '1D | 1Y', value: 'D|365' },
    { label: '1D | 2Y', value: 'D|730' },
    { label: '1D | 3Y', value: 'D|1095' }
  ];
  readonly intradayHistoryRanges: Array<{ label: string; days: number }> = [
    { label: '1D', days: 1 },
    { label: '3D', days: 3 },
    { label: '5D', days: 5 },
    { label: '10D', days: 10 },
  ];
  readonly longTermHistoryRanges: Array<{ label: string; days: number }> = [
    { label: '1M', days: 30 },
    { label: '2M', days: 60 },
    { label: '6M', days: 180 },
    { label: '1Y', days: 365 },
    { label: '2Y', days: 730 },
    { label: '3Y', days: 1095 }
  ];
  readonly gainersTypes: Array<{
    label: string;
    value: 'PercOILosers' | 'PercOIGainers' | 'PercPriceGainers' | 'PercPriceLosers';
  }> = [
    { label: 'OI Gainers', value: 'PercOIGainers' },
    { label: 'OI Losers', value: 'PercOILosers' },
    { label: 'Price Gainers', value: 'PercPriceGainers' },
    { label: 'Price Losers', value: 'PercPriceLosers' }
  ];
  readonly oiTypes: Array<{
    label: string;
    value: 'Long Built Up' | 'Short Built Up' | 'Short Covering' | 'Long Unwinding';
  }> = [
    { label: 'Long Built Up', value: 'Long Built Up' },
    { label: 'Short Built Up', value: 'Short Built Up' },
    { label: 'Short Covering', value: 'Short Covering' },
    { label: 'Long Unwinding', value: 'Long Unwinding' }
  ];
  readonly expiryTypes: Array<{ label: string; value: 'NEAR' | 'NEXT' | 'FAR' }> = [
    { label: 'Near', value: 'NEAR' },
    { label: 'Next', value: 'NEXT' },
    { label: 'Far', value: 'FAR' }
  ];

  symbol = 'NIFTY';
  symbolSuggestions: SymbolSuggestion[] = [];
  isSymbolSearchLoading = false;
  showSymbolSuggestions = false;
  alertName = '';
  alertComparisonType: PriceAlert['comparisonType'] = 'LTP';
  alertCondition: PriceAlert['condition'] = 'GTE';
  alertPrice: number | null = null;
  alertNotes = '';
  alerts: PriceAlert[] = [];
  selectedRes = '5';
  selectedIntradayDays = 5;
  selectedLongTermDays = 365;
  selectedChartWindow = '5|5';
  activeSection: DashboardViewSection = 'home';
  innerSearch = '';
  dateFrom = '';
  dateTo = '';
  useWebSocket = false;
  wsMode: 'CONNECTING' | 'LIVE' | 'FALLBACK' | 'OFF' = 'OFF';
  selectedExpiryType: 'NEAR' | 'NEXT' | 'FAR' = 'NEAR';
  selectedOptionGreekExpiry = '';
  selectedGainersType: 'PercOILosers' | 'PercOIGainers' | 'PercPriceGainers' | 'PercPriceLosers' = 'PercOIGainers';
  selectedOiType: 'Long Built Up' | 'Short Built Up' | 'Short Covering' | 'Long Unwinding' = 'Long Built Up';
  foViewMode: 'gainers' | 'pcr' | 'oi' = 'gainers';

  isLoading = false;
  isManualSubmitting = false;
  isAlertLoading = false;
  isAlertSaving = false;
  isHoldingsLoading = false;
  isDerivativesLoading = false;
  errorMessage = '';
  alertMessage = '';
  holdingsMessage = '';
  derivativesMessage = '';
  state: DashboardState | null = null;
  userProfile: AngelUserProfile | null = null;
  angelHoldings: AngelHolding[] = [];
  selectedPortfolioSymbol = '';
  gainersLosersRows: AngelGainersLosersItem[] = [];
  pcrRows: AngelPcrItem[] = [];
  oiBuildupRows: AngelOiBuildupItem[] = [];

  private wsSub: Subscription | null = null;
  private symbolSearchSub: Subscription | null = null;
  private symbolSearchDebounce: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly marketDataService: MarketDataService,
    private readonly authService: AuthService
  ) {
    this.refreshDateWindow();
    this.syncChartWindowForSection();
    this.selectedOptionGreekExpiry = this.nextWeeklyExpiry();
  }

  get snapshot(): MarketSnapshot | null {
    return this.state?.snapshot ?? null;
  }

  get watchlist(): WatchlistItem[] {
    return this.state?.watchlist ?? [];
  }

  get breadth(): MarketBreadth | null {
    return this.state?.breadth ?? null;
  }

  get portfolio(): PortfolioSummary | null {
    if (this.angelHoldings.length > 0) {
      return this.toPortfolioFromHoldings(this.angelHoldings);
    }
    return this.state?.portfolio ?? null;
  }

  get avgPcr(): number {
    if (this.pcrRows.length === 0) {
      return 0;
    }
    const sum = this.pcrRows.reduce((acc, row) => acc + row.pcr, 0);
    return this.round(sum / this.pcrRows.length);
  }

  get topPcrSymbol(): string {
    if (this.pcrRows.length === 0) {
      return '-';
    }
    const top = [...this.pcrRows].sort((a, b) => b.pcr - a.pcr)[0];
    return top?.tradingSymbol ?? '-';
  }

  get gainersAvgChange(): number {
    if (this.gainersLosersRows.length === 0) {
      return 0;
    }
    const sum = this.gainersLosersRows.reduce((acc, row) => acc + row.percentChange, 0);
    return this.round(sum / this.gainersLosersRows.length);
  }

  get oiNetChangeTotal(): number {
    return this.round(this.oiBuildupRows.reduce((acc, row) => acc + row.netChangeOpnInterest, 0));
  }

  get homeChartCandles(): Array<{ timestamp: number; close: number; volume: number; high: number; low: number; open: number }> {
    return (this.snapshot?.candleData ?? []).slice(-72);
  }

  get homeCandleBars(): Array<{
    x: number;
    width: number;
    wickWidth: number;
    wickTop: number;
    wickHeight: number;
    bodyTop: number;
    bodyHeight: number;
    bullish: boolean;
  }> {
    const candles = this.homeChartCandles;
    if (candles.length === 0) {
      return [];
    }

    const high = this.homeChartHigh;
    const low = this.homeChartLow;
    const spread = Math.max(high - low, 0.01);
    const slot = 100 / candles.length;
    const width = Math.max(slot * 0.56, 0.55);

    const toY = (price: number): number => 100 - ((price - low) / spread) * 100;

    return candles.map((candle, idx) => {
      const openY = toY(candle.open);
      const closeY = toY(candle.close);
      const highY = toY(candle.high);
      const lowY = toY(candle.low);
      const bodyTop = Math.min(openY, closeY);
      const bodyHeight = Math.max(Math.abs(openY - closeY), 0.85);

      return {
        x: idx * slot + (slot - width) / 2,
        width,
        wickWidth: Math.max(width * 0.06, 0.18),
        wickTop: highY,
        wickHeight: Math.max(lowY - highY, 0.9),
        bodyTop,
        bodyHeight,
        bullish: candle.close >= candle.open
      };
    });
  }

  get homeChartHigh(): number {
    const candles = this.homeChartCandles;
    if (candles.length === 0) {
      return 0;
    }
    return candles.reduce((max, candle) => Math.max(max, candle.high), Number.NEGATIVE_INFINITY);
  }

  get homeChartLow(): number {
    const candles = this.homeChartCandles;
    if (candles.length === 0) {
      return 0;
    }
    return candles.reduce((min, candle) => Math.min(min, candle.low), Number.POSITIVE_INFINITY);
  }

  get homeDayChangePercent(): number {
    const snap = this.snapshot;
    if (!snap || snap.previousClose === 0) {
      return 0;
    }
    return this.round(((snap.price - snap.previousClose) / snap.previousClose) * 100);
  }

  get homeChartPositive(): boolean {
    return this.homeDayChangePercent >= 0;
  }

  get homeChartPath(): string {
    const points = this.homeChartPoints;
    if (points.length === 0) {
      return '';
    }
    return points
      .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
      .join(' ');
  }

  get homeChartAreaPath(): string {
    const points = this.homeChartPoints;
    if (points.length === 0) {
      return '';
    }
    const first = points[0];
    const last = points.at(-1);
    if (!first || !last) {
      return '';
    }
    return `${this.homeChartPath} L ${last.x.toFixed(2)} 100 L ${first.x.toFixed(2)} 100 Z`;
  }

  get homeMaxVolume(): number {
    const volumes = this.homeChartCandles.map((candle) => candle.volume);
    return Math.max(...volumes, 1);
  }

  get selectedPortfolioHolding():
    | {
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
    | null {
    const list = this.portfolio?.holdings ?? [];
    if (list.length === 0) {
      return null;
    }
    const matched = list.find((item) => item.symbol === this.selectedPortfolioSymbol);
    return matched ?? list[0] ?? null;
  }

  get selectedAngelHolding(): AngelHolding | null {
    const list = this.angelHoldings;
    if (list.length === 0) {
      return null;
    }
    const matched = list.find((item) => item.tradingsymbol === this.selectedPortfolioSymbol);
    return matched ?? list[0] ?? null;
  }

  get selectedAngelInvestedValue(): number {
    const h = this.selectedAngelHolding;
    if (!h) {
      return 0;
    }
    return this.round(h.quantity * h.averageprice);
  }

  get selectedAngelMarketValue(): number {
    const h = this.selectedAngelHolding;
    if (!h) {
      return 0;
    }
    return this.round(h.quantity * h.ltp);
  }

  get selectedAngelDayPnl(): number {
    const h = this.selectedAngelHolding;
    if (!h) {
      return 0;
    }
    return this.round(h.quantity * (h.ltp - h.close));
  }

  ngOnInit(): void {
    this.marketDataService.loadRecentSearches().subscribe({
      next: () => this.startRefreshStream(),
      error: () => this.startRefreshStream()
    });
    this.refreshBrokerData();
    this.loadPriceAlerts();
    this.loadDerivativesData('gainers');
  }

  ngOnDestroy(): void {
    this.wsSub?.unsubscribe();
    this.symbolSearchSub?.unsubscribe();
    if (this.symbolSearchDebounce) {
      clearTimeout(this.symbolSearchDebounce);
      this.symbolSearchDebounce = null;
    }
  }

  setResolution(resolution: string): void {
    this.selectedRes = resolution;
    this.restartRefreshStream();
  }

  setChartWindow(value: string): void {
    const [resolution, daysRaw] = String(value || '').split('|');
    const days = Math.max(1, Number(daysRaw) || 5);
    this.selectedChartWindow = `${resolution || this.selectedRes}|${days}`;
    this.selectedRes = resolution || this.selectedRes;
    this.selectedIntradayDays = days;
    this.selectedLongTermDays = days;
    this.restartRefreshStream();
  }

  setHistoryRange(days: number): void {
    const parsed = Math.max(1, Number(days) || 1);
    if (this.activeSection === 'intraday') {
      this.selectedIntradayDays = parsed;
    } else {
      this.selectedLongTermDays = parsed;
    }
    this.restartRefreshStream();
  }

  get activeHistoryRanges(): Array<{ label: string; days: number }> {
    return this.activeSection === 'intraday' ? this.intradayHistoryRanges : this.longTermHistoryRanges;
  }

  get selectedHistoryDays(): number {
    return this.activeSection === 'intraday' ? this.selectedIntradayDays : this.selectedLongTermDays;
  }

  get chartWindowOptions(): Array<{ label: string; value: string }> {
    return this.activeSection === 'delivery' ? this.deliveryChartWindows : this.intradayChartWindows;
  }

  get showChartWindowSelector(): boolean {
    return this.activeSection === 'home' || this.activeSection === 'intraday' || this.activeSection === 'fo' || this.activeSection === 'delivery';
  }

  setSymbol(symbol: string): void {
    const clean = symbol.trim().toUpperCase();
    if (!clean) {
      return;
    }

    this.symbol = clean;
    this.clearSymbolSuggestions();
    this.marketDataService.recordRecentSearch(clean).subscribe();
    this.restartRefreshStream();
  }

  onSymbolInputChange(value: string): void {
    this.symbol = String(value ?? '').toUpperCase();
    this.queueSymbolSearch(this.symbol);
  }

  onSymbolInputFocus(): void {
    if (this.symbolSuggestions.length > 0) {
      this.showSymbolSuggestions = true;
    }
  }

  onSymbolInputBlur(): void {
    setTimeout(() => {
      this.showSymbolSuggestions = false;
    }, 120);
  }

  onSymbolSuggestionPick(item: SymbolSuggestion): void {
    this.symbol = item.symbol;
    this.setSymbol(item.symbol);
  }

  onRefreshConfigChange(): void {
    this.restartRefreshStream();
  }

  onManualRefresh(): void {
    if (this.isManualSubmitting) {
      return;
    }

    const clean = this.symbol.trim().toUpperCase();
    if (clean) {
      this.symbol = clean;
      this.clearSymbolSuggestions();
      this.marketDataService.recordRecentSearch(clean).subscribe();
    }

    this.isManualSubmitting = true;
    this.errorMessage = '';
    this.fetchState(false, () => {
      this.loadOptionGreeks();
      this.isManualSubmitting = false;
      this.activeSection = 'home';
    });
  }

  onWatchlistPick(symbol: string): void {
    this.setSymbol(symbol);
  }

  onPortfolioHoldingSelect(symbol: string): void {
    const clean = symbol.trim().toUpperCase();
    if (!clean) {
      return;
    }
    this.selectedPortfolioSymbol = clean;
  }

  setSection(section: DashboardViewSection): void {
    this.activeSection = section;
    this.syncChartWindowForSection();
    this.innerSearch = '';
    if (section === 'home' && this.symbol !== 'NIFTY') {
      this.symbol = 'NIFTY';
    }
    if (section === 'portfolio') {
      this.refreshBrokerData();
    }
    if (section === 'fo') {
      this.loadDerivativesData(this.foViewMode);
      this.loadOptionGreeks();
    }
    this.restartRefreshStream();
  }

  createAlert(): void {
    const symbol = this.symbol.trim().toUpperCase();
    const value = Number(this.alertPrice);
    const name = this.alertName.trim() || `${symbol} ${this.alertCondition} ${value}`;

    if (!symbol || !Number.isFinite(value) || value <= 0) {
      this.alertMessage = 'Enter a valid symbol and trigger price.';
      return;
    }

    const payload: CreatePriceAlertInput = {
      name,
      symbol,
      comparisonType: this.alertComparisonType,
      condition: this.alertCondition,
      value,
      notes: this.alertNotes.trim() || undefined
    };

    this.isAlertSaving = true;
    this.alertMessage = '';

    this.marketDataService.createPriceAlert(payload).subscribe({
      next: (created) => {
        this.alerts = [created, ...this.alerts].filter((item, idx, arr) => idx === arr.findIndex((a) => a.alertId === item.alertId));
        this.alertMessage = `Alert created for ${created.symbol} at ${created.value}.`;
        this.isAlertSaving = false;
      },
      error: () => {
        this.alertMessage = 'Failed to create alert.';
        this.isAlertSaving = false;
      }
    });
  }

  onQuickAlertCreate(payload: CreatePriceAlertInput): void {
    this.isAlertSaving = true;
    this.alertMessage = '';
    const side: 'BUY' | 'SELL' = payload.condition === 'LTE' || payload.condition === 'LT' ? 'SELL' : 'BUY';

    this.authService
      .createGttOrder({
        symbol: payload.symbol,
        side,
        triggerPrice: payload.value,
        quantity: 1,
        notes: payload.notes
      })
      .subscribe({
        next: (gtt) => {
          this.alertMessage = `Broker GTT created (${gtt.side}) for ${gtt.symbol} @ ${gtt.triggerPrice}.`;
          this.isAlertSaving = false;
        },
        error: () => {
          this.marketDataService.createPriceAlert(payload).subscribe({
            next: (created) => {
              this.alerts = [created, ...this.alerts].filter(
                (item, idx, arr) => idx === arr.findIndex((a) => a.alertId === item.alertId)
              );
              this.alertMessage = `Quick alert created for ${created.symbol} at ${created.value}.`;
              this.isAlertSaving = false;
            },
            error: () => {
              this.alertMessage = 'Failed to create quick alert.';
              this.isAlertSaving = false;
            }
          });
        }
      });
  }

  deleteAlert(alertId: string): void {
    if (!alertId) {
      return;
    }

    this.marketDataService.deletePriceAlert(alertId).subscribe({
      next: () => {
        this.alerts = this.alerts.filter((item) => item.alertId !== alertId);
      },
      error: () => {
        this.alertMessage = 'Failed to delete alert.';
      }
    });
  }

  refreshAlerts(): void {
    this.loadPriceAlerts();
  }

  refreshBrokerData(): void {
    this.loadUserProfile();
    this.loadHoldings();
  }

  refreshDerivativesData(): void {
    this.loadDerivativesData(this.foViewMode);
    this.loadOptionGreeks();
  }

  setFoViewMode(mode: 'gainers' | 'pcr' | 'oi'): void {
    this.foViewMode = mode;
    this.loadDerivativesData(mode);
  }

  onInnerSearch(section: DashboardViewSection): void {
    const clean = this.innerSearch.trim().toUpperCase();
    if (!clean) {
      return;
    }

    this.symbol = clean;
    this.marketDataService.recordRecentSearch(clean).subscribe();
    this.isManualSubmitting = true;
    this.errorMessage = '';
    this.fetchState(false, () => {
      this.isManualSubmitting = false;
      this.activeSection = section;
      if (section === 'fo') {
        this.loadDerivativesData(this.foViewMode);
        this.loadOptionGreeks();
      }
    });
  }

  private startRefreshStream(): void {
    this.wsSub?.unsubscribe();

    if (this.useWebSocket) {
      this.startWebSocketStream();
      return;
    }

    this.wsMode = 'OFF';
    this.fetchState();
  }

  private loadPriceAlerts(): void {
    this.isAlertLoading = true;
    this.marketDataService.getPriceAlerts().subscribe({
      next: (alerts) => {
        this.alerts = alerts;
        this.isAlertLoading = false;
      },
      error: () => {
        this.isAlertLoading = false;
      }
    });
  }

  private loadUserProfile(): void {
    this.authService.getProfile().subscribe({
      next: (profile) => {
        this.userProfile = profile;
      },
      error: () => {
        this.userProfile = null;
      }
    });
  }

  private loadHoldings(): void {
    this.isHoldingsLoading = true;
    this.holdingsMessage = '';

    this.authService.getHoldings().pipe(
      finalize(() => {
        this.isHoldingsLoading = false;
      })
    ).subscribe({
      next: (holdings) => {
        this.angelHoldings = holdings;
        if (holdings.length > 0 && !this.selectedPortfolioSymbol) {
          this.selectedPortfolioSymbol = holdings[0].tradingsymbol;
        }
      },
      error: () => {
        this.angelHoldings = [];
        this.holdingsMessage = 'Unable to load Angel holdings.';
      }
    });
  }

  private loadDerivativesData(mode: 'gainers' | 'pcr' | 'oi'): void {
    this.isDerivativesLoading = true;
    this.derivativesMessage = '';
    if (mode === 'gainers') {
      this.authService.getGainersLosers(this.selectedGainersType, this.selectedExpiryType).subscribe({
        next: (rows) => {
          this.gainersLosersRows = rows;
          this.isDerivativesLoading = false;
        },
        error: () => {
          this.gainersLosersRows = [];
          this.derivativesMessage = 'Unable to load Top Gainers/Losers data.';
          this.isDerivativesLoading = false;
        }
      });
      return;
    }

    if (mode === 'pcr') {
      this.authService.getPutCallRatio().subscribe({
        next: (rows) => {
          this.pcrRows = rows;
          this.isDerivativesLoading = false;
        },
        error: () => {
          this.pcrRows = [];
          this.derivativesMessage = 'Unable to load PCR data.';
          this.isDerivativesLoading = false;
        }
      });
      return;
    }

    this.authService.getOiBuildup(this.selectedOiType, this.selectedExpiryType).subscribe({
      next: (rows) => {
        this.oiBuildupRows = rows;
        this.isDerivativesLoading = false;
      },
      error: () => {
        this.oiBuildupRows = [];
        this.derivativesMessage = 'Unable to load OI Buildup data.';
        this.isDerivativesLoading = false;
      }
    });
  }

  private toPortfolioFromHoldings(holdings: AngelHolding[]): PortfolioSummary {
    const rawHoldings = holdings.map((item) => {
      const marketValue = this.round(item.quantity * item.ltp);
      const investedValue = this.round(item.quantity * item.averageprice);
      const pnl = this.round(item.profitandloss);
      const pnlPercent =
        investedValue === 0 ? 0 : this.round((pnl / investedValue) * 100);

      return {
        symbol: item.tradingsymbol,
        quantity: item.quantity,
        averagePrice: this.round(item.averageprice),
        lastPrice: this.round(item.ltp),
        marketValue,
        investedValue,
        pnl,
        pnlPercent
      };
    });

    const totalValue = this.round(rawHoldings.reduce((sum, item) => sum + item.marketValue, 0));
    const investedValue = this.round(rawHoldings.reduce((sum, item) => sum + item.investedValue, 0));
    const totalPnl = this.round(rawHoldings.reduce((sum, item) => sum + item.pnl, 0));
    const dayPnl = this.round(
      holdings.reduce((sum, item) => sum + item.quantity * (item.ltp - item.close), 0)
    );

    const normalized = rawHoldings.map((item) => ({
      ...item,
      allocationPercent: totalValue === 0 ? 0 : this.round((item.marketValue / totalValue) * 100)
    }));

    return {
      totalValue,
      investedValue,
      dayPnl,
      totalPnl,
      totalPnlPercent: investedValue === 0 ? 0 : this.round((totalPnl / investedValue) * 100),
      holdings: normalized
    };
  }

  private round(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private queueSymbolSearch(value: string): void {
    const clean = value.trim().toUpperCase();
    if (this.symbolSearchDebounce) {
      clearTimeout(this.symbolSearchDebounce);
      this.symbolSearchDebounce = null;
    }
    this.symbolSearchSub?.unsubscribe();

    if (clean.length < 2) {
      this.clearSymbolSuggestions();
      return;
    }

    this.symbolSearchDebounce = setTimeout(() => {
      const requested = clean;
      this.isSymbolSearchLoading = true;
      this.symbolSearchSub = this.marketDataService.searchSymbols(requested).subscribe({
        next: (rows) => {
          const current = this.symbol.trim().toUpperCase();
          if (current !== requested) {
            return;
          }
          this.symbolSuggestions = rows;
          this.showSymbolSuggestions = rows.length > 0;
          this.isSymbolSearchLoading = false;
        },
        error: () => {
          this.isSymbolSearchLoading = false;
          this.clearSymbolSuggestions();
        }
      });
    }, 220);
  }

  private clearSymbolSuggestions(): void {
    this.symbolSuggestions = [];
    this.showSymbolSuggestions = false;
    this.isSymbolSearchLoading = false;
    if (this.symbolSearchDebounce) {
      clearTimeout(this.symbolSearchDebounce);
      this.symbolSearchDebounce = null;
    }
  }

  private startWebSocketStream(): void {
    this.wsMode = 'CONNECTING';
    this.isLoading = true;
    this.errorMessage = '';

    this.refreshDateWindow();
    this.wsSub?.unsubscribe();
    this.wsSub = this.marketDataService
      .getLiveDashboardStateStream(
        this.symbol,
        this.getRequestedResolution(),
        this.dateFrom,
        this.dateTo,
        this.getRollingWindowMinutes()
      )
      .subscribe({
        next: (state) => {
          this.state = state;
          this.errorMessage = state.warningMessage ?? '';
          this.isLoading = false;
          this.wsMode = 'LIVE';
        },
        error: () => {
          this.wsMode = 'FALLBACK';
          this.errorMessage = 'Live WebSocket unavailable. Use Reload for manual updates.';
          this.fetchState(true);
        }
      });
  }

  private restartRefreshStream(): void {
    this.startRefreshStream();
  }

  private fetchState(preserveError = false, onComplete?: () => void): void {
    this.refreshDateWindow();
    this.isLoading = true;
    if (!preserveError) {
      this.errorMessage = '';
    }

    this.marketDataService
      .getDashboardState(
        this.symbol,
        this.getRequestedResolution(),
        this.dateFrom,
        this.dateTo,
        this.getRollingWindowMinutes()
      )
      .pipe(
        finalize(() => {
          this.isLoading = false;
          this.isManualSubmitting = false;
        })
      )
      .subscribe({
        next: (state) => {
          this.state = state;
          this.loadOptionGreeks();
          this.errorMessage = state.warningMessage ?? (preserveError ? this.errorMessage : '');
          onComplete?.();
        },
        error: () => {
          this.errorMessage = 'Failed to sync live market stream.';
          onComplete?.();
        }
      });
  }

  private loadOptionGreeks(): void {
    const underlying = this.toOptionUnderlying(this.symbol);
    if (!underlying || !this.selectedOptionGreekExpiry) {
      return;
    }

    this.authService.getOptionGreeks(underlying, this.selectedOptionGreekExpiry).subscribe({
      next: (rows) => {
        if (rows.length === 0 || !this.state?.snapshot) {
          return;
        }
        const mapped = rows
          .map((item) => this.toOptionGreek(item))
          .filter((item) => Number.isFinite(item.strikePrice) && item.strikePrice > 0);

        if (mapped.length === 0) {
          return;
        }

        this.state = {
          ...this.state,
          snapshot: {
            ...this.state.snapshot,
            foGreeks: mapped
          }
        };
      },
      error: () => {
        // Keep existing chain data; this call is enrichment-only.
      }
    });
  }

  private toOptionGreek(item: AngelOptionGreekItem): OptionGreek {
    return {
      strikePrice: this.round(item.strikePrice),
      optionType: item.optionType,
      delta: this.round(item.delta),
      theta: this.round(item.theta),
      vega: this.round(item.vega),
      gamma: this.round(item.gamma),
      iv: this.round(item.iv),
      ltp: this.round(item.ltp),
      tradeVolume: Math.round(item.tradeVolume),
      oi: Math.round(item.oi)
    };
  }

  private toOptionUnderlying(symbol: string): string {
    const clean = symbol.trim().toUpperCase();
    if (clean.startsWith('NSE:')) {
      const withoutPrefix = clean.split(':')[1] ?? '';
      return withoutPrefix.replace('-EQ', '');
    }
    return clean.replace('-EQ', '');
  }

  private nextWeeklyExpiry(reference = new Date()): string {
    const base = new Date(reference);
    const day = base.getDay();
    const offset = (4 - day + 7) % 7;
    base.setDate(base.getDate() + offset);
    const dd = String(base.getDate()).padStart(2, '0');
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const mon = months[base.getMonth()];
    const yyyy = base.getFullYear();
    return `${dd}${mon}${yyyy}`;
  }

  private get homeChartPoints(): Array<{ x: number; y: number }> {
    const candles = this.homeChartCandles;
    if (candles.length === 0) {
      return [];
    }

    const high = this.homeChartHigh;
    const low = this.homeChartLow;
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

  private toDateString(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  private refreshDateWindow(): void {
    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - this.selectedHistoryDays);
    this.dateFrom = this.toDateString(from);
    this.dateTo = this.toDateString(to);
  }

  private getRollingWindowMinutes(): number | null {
    const parsed = Number(this.getRequestedResolution());
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }
    return this.selectedHistoryDays * 24 * 60;
  }

  private getRequestedResolution(): string {
    return this.activeSection === 'delivery' ? 'D' : this.selectedRes;
  }

  private syncChartWindowForSection(): void {
    if (this.activeSection === 'delivery') {
      this.selectedChartWindow = `D|${this.selectedLongTermDays}`;
      this.selectedRes = 'D';
      return;
    }
    if (this.selectedRes === 'D') {
      this.selectedRes = '5';
    }
    this.selectedChartWindow = `${this.selectedRes}|${this.selectedIntradayDays}`;
  }

}

type DashboardViewSection =
  | 'home'
  | 'portfolio'
  | 'watchlist'
  | 'intraday'
  | 'delivery'
  | 'fo'
  | 'mutualfunds'
  | 'enhancements';

