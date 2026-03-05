import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, Input, OnChanges, OnDestroy, SimpleChanges, ViewChild } from '@angular/core';
import { Candle } from '../../models/market.models';

type ChartType = 'candlestick' | 'bar' | 'line' | 'area' | 'baseline' | 'histogram';
type PriceScaleMode = 'normal' | 'log' | 'percentage' | 'indexedTo100';

declare global {
  interface Window {
    LightweightCharts?: {
      createChart: (container: HTMLElement, options?: Record<string, unknown>) => {
        addCandlestickSeries: (options?: Record<string, unknown>) => {
          setData: (data: Array<Record<string, unknown>>) => void;
        };
        addBarSeries: (options?: Record<string, unknown>) => {
          setData: (data: Array<Record<string, unknown>>) => void;
        };
        addLineSeries: (options?: Record<string, unknown>) => {
          setData: (data: Array<Record<string, unknown>>) => void;
        };
        addAreaSeries: (options?: Record<string, unknown>) => {
          setData: (data: Array<Record<string, unknown>>) => void;
        };
        addBaselineSeries: (options?: Record<string, unknown>) => {
          setData: (data: Array<Record<string, unknown>>) => void;
        };
        addHistogramSeries: (options?: Record<string, unknown>) => {
          setData: (data: Array<Record<string, unknown>>) => void;
        };
        applyOptions: (options: Record<string, unknown>) => void;
        remove: () => void;
        timeScale: () => { fitContent: () => void };
      };
    };
  }
}

@Component({
  selector: 'app-tradingview-chart',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './tradingview-chart.html',
  styleUrl: './tradingview-chart.css'
})
export class TradingviewChartComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() symbol = 'NSE:NIFTY';
  @Input() interval = '5';
  @Input() candles: Candle[] = [];
  @Input() height = 380;
  @Input() chartType: ChartType = 'candlestick';
  @Input() showTypeSelector = true;
  @Input() timezone = 'Asia/Kolkata';
  @Input() enforceIndianSession = true;

  @ViewChild('container', { static: true }) containerRef!: ElementRef<HTMLDivElement>;
  private chart: ReturnType<NonNullable<Window['LightweightCharts']>['createChart']> | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private static scriptLoadPromise: Promise<void> | null = null;
  private initialized = false;
  selectedChartType: ChartType = 'candlestick';
  selectedPriceScaleMode: PriceScaleMode = 'normal';
  selectedTimeZone = 'Asia/Kolkata';
  selectedBarSpacing = 10;
  selectedRightOffset = 3;
  isPriceScaleInverted = false;
  readonly chartTypes: Array<{ label: string; value: ChartType }> = [
    { label: 'Candlestick', value: 'candlestick' },
    { label: 'Bar', value: 'bar' },
    { label: 'Line', value: 'line' },
    { label: 'Area', value: 'area' },
    { label: 'Baseline', value: 'baseline' },
    { label: 'Histogram', value: 'histogram' }
  ];
  readonly priceScaleModes: Array<{ label: string; value: PriceScaleMode }> = [
    { label: 'Normal', value: 'normal' },
    { label: 'Logarithmic', value: 'log' },
    { label: 'Percentage', value: 'percentage' },
    { label: 'Indexed to 100', value: 'indexedTo100' }
  ];
  readonly timeZones: Array<{ label: string; value: string }> = [
    { label: 'Asia/Kolkata', value: 'Asia/Kolkata' },
    { label: 'UTC', value: 'UTC' },
    { label: 'Asia/Dubai', value: 'Asia/Dubai' },
    { label: 'Europe/London', value: 'Europe/London' },
    { label: 'America/New_York', value: 'America/New_York' }
  ];

  get advancedChartUrl(): string {
    const symbol = encodeURIComponent(this.toTradingViewSymbol(this.symbol));
    const interval = encodeURIComponent(String(this.interval || '5'));
    return `https://in.tradingview.com/advanced-charts/?symbol=${symbol}&interval=${interval}`;
  }

  ngAfterViewInit(): void {
    this.initialized = true;
    this.selectedChartType = this.toChartType(this.chartType);
    this.selectedTimeZone = this.timezone || 'Asia/Kolkata';
    this.mount();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.initialized) {
      return;
    }
    if (changes['chartType']) {
      this.selectedChartType = this.toChartType(this.chartType);
    }
    if (changes['timezone']) {
      this.selectedTimeZone = this.timezone || 'Asia/Kolkata';
    }
    if (
      changes['symbol'] ||
      changes['interval'] ||
      changes['candles'] ||
      changes['height'] ||
      changes['chartType'] ||
      changes['timezone']
    ) {
      this.mount();
    }
  }

  ngOnDestroy(): void {
    this.destroyChart();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }

  private mount(): void {
    this.ensureScriptLoaded()
      .then(() => {
        this.renderChart();
      })
      .catch(() => {
        // No-op. Host screen still renders trading cards without chart.
      });
  }

  private ensureScriptLoaded(): Promise<void> {
    if (window.LightweightCharts?.createChart) {
      return Promise.resolve();
    }

    if (TradingviewChartComponent.scriptLoadPromise) {
      return TradingviewChartComponent.scriptLoadPromise;
    }

    TradingviewChartComponent.scriptLoadPromise = new Promise<void>((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>('script[data-tv-widget="lightweight"]');
      if (existing) {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error('Failed to load TradingView script')), { once: true });
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js';
      script.async = true;
      script.dataset['tvWidget'] = 'lightweight';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load Lightweight Charts script'));
      document.head.appendChild(script);
    });

    return TradingviewChartComponent.scriptLoadPromise;
  }

  private renderChart(): void {
    if (!window.LightweightCharts?.createChart) {
      return;
    }

    this.destroyChart();
    const host = this.containerRef.nativeElement;
    host.innerHTML = '';

    const width = Math.max(host.clientWidth, 320);
    const priceScaleId = 'right';
    this.chart = window.LightweightCharts.createChart(host, {
      width,
      height: this.height,
      layout: {
        background: { type: 'solid', color: '#0b121b' },
        textColor: '#8ea4bc'
      },
      localization: {
        timeFormatter: (timeValue: unknown) => this.formatTime(timeValue)
      },
      grid: {
        vertLines: { color: '#1d3042' },
        horzLines: { color: '#1d3042' }
      },
      crosshair: {
        mode: 1
      },
      rightPriceScale: {
        borderColor: '#213245',
        mode: this.toPriceScaleModeValue(this.selectedPriceScaleMode),
        invertScale: this.isPriceScaleInverted,
        autoScale: true,
        scaleMargins: {
          top: 0.12,
          bottom: 0.22
        }
      },
      timeScale: {
        borderColor: '#213245',
        timeVisible: true,
        secondsVisible: false,
        barSpacing: this.selectedBarSpacing,
        rightOffset: this.selectedRightOffset,
        lockVisibleTimeRangeOnResize: true,
        fixLeftEdge: false,
        minBarSpacing: 0.5
      }
    });

    const normalizedCandles = this.toSeriesData(this.candles);
    const lineData = normalizedCandles.map((bar) => ({ time: bar.time, value: bar.close }));

    if (this.selectedChartType === 'candlestick') {
      const series = this.chart.addCandlestickSeries({
        upColor: '#4bdd9f',
        downColor: '#ff8092',
        borderVisible: false,
        wickUpColor: '#4bdd9f',
        wickDownColor: '#ff8092',
        priceScaleId
      });
      series.setData(normalizedCandles);
    } else if (this.selectedChartType === 'bar') {
      const series = this.chart.addBarSeries({
        upColor: '#4bdd9f',
        downColor: '#ff8092',
        thinBars: false,
        priceScaleId
      });
      series.setData(normalizedCandles);
    } else if (this.selectedChartType === 'line') {
      const series = this.chart.addLineSeries({
        color: '#4bdd9f',
        lineWidth: 2,
        priceScaleId
      });
      series.setData(lineData);
    } else if (this.selectedChartType === 'area') {
      const series = this.chart.addAreaSeries({
        lineColor: '#4bdd9f',
        topColor: 'rgba(75, 221, 159, 0.3)',
        bottomColor: 'rgba(75, 221, 159, 0.05)',
        lineWidth: 2,
        priceScaleId
      });
      series.setData(lineData);
    } else if (this.selectedChartType === 'baseline') {
      const baseValue = lineData[0]?.value ?? 0;
      const series = this.chart.addBaselineSeries({
        baseValue: { type: 'price', price: baseValue },
        topLineColor: '#4bdd9f',
        topFillColor1: 'rgba(75, 221, 159, 0.25)',
        topFillColor2: 'rgba(75, 221, 159, 0.03)',
        bottomLineColor: '#ff8092',
        bottomFillColor1: 'rgba(255, 128, 146, 0.2)',
        bottomFillColor2: 'rgba(255, 128, 146, 0.03)',
        lineWidth: 2,
        priceScaleId
      });
      series.setData(lineData);
    } else {
      const series = this.chart.addHistogramSeries({
        priceScaleId
      });
      series.setData(
        lineData.map((bar, index) => {
          const prev = lineData[index - 1]?.value ?? bar.value;
          return {
            time: bar.time,
            value: bar.value,
            color: bar.value >= prev ? 'rgba(75, 221, 159, 0.8)' : 'rgba(255, 128, 146, 0.8)'
          };
        })
      );
    }

    if (this.selectedChartType !== 'histogram') {
      const volumeSeries = this.chart.addHistogramSeries({
        priceFormat: { type: 'volume' },
        priceScaleId: ''
      });
      volumeSeries.setData(
        normalizedCandles.map((bar) => ({
          time: bar.time,
          value: bar.volume,
          color: bar.close >= bar.open ? 'rgba(75, 221, 159, 0.45)' : 'rgba(255, 128, 146, 0.45)'
        }))
      );
    }

    this.chart.timeScale().fitContent();
    this.ensureResizeObserver();
  }

  private destroyChart(): void {
    if (this.chart) {
      this.chart.remove();
    }
    this.chart = null;
  }

  private ensureResizeObserver(): void {
    if (!this.chart) {
      return;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = new ResizeObserver((entries) => {
      const width = Math.max(entries[0]?.contentRect.width ?? 0, 320);
      this.chart?.applyOptions({ width, height: this.height });
    });
    this.resizeObserver.observe(this.containerRef.nativeElement);
  }

  private toSeriesData(candles: Candle[]): Array<{
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }> {
    if (!Array.isArray(candles) || candles.length === 0) {
      const now = Math.floor(Date.now() / 1000);
      return [
        { time: now - 60, open: 0, high: 0, low: 0, close: 0, volume: 0 },
        { time: now, open: 0, high: 0, low: 0, close: 0, volume: 0 }
      ];
    }

    const normalized = candles
      .map((candle) => ({
        time: this.toZonedUnixSeconds(this.toUnixSeconds(candle.timestamp), this.selectedTimeZone),
        open: Number(candle.open ?? 0),
        high: Number(candle.high ?? 0),
        low: Number(candle.low ?? 0),
        close: Number(candle.close ?? 0),
        volume: Number(candle.volume ?? 0)
      }))
      .filter((bar) => Number.isFinite(bar.time))
      .sort((a, b) => a.time - b.time);

    if (!this.enforceIndianSession || this.normalizeInterval(this.interval) === 'D') {
      return normalized;
    }

    return normalized.filter((bar) => this.isWithinIndianMarketSession(bar.time));
  }

  private toUnixSeconds(rawTimestamp: number): number {
    const numeric = Number(rawTimestamp ?? 0);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return Math.floor(Date.now() / 1000);
    }
    // If timestamp is already in seconds, keep it; if in ms, convert to seconds.
    return numeric > 100000000000 ? Math.floor(numeric / 1000) : Math.floor(numeric);
  }

  private formatTime(timeValue: unknown): string {
    const seconds = Number(timeValue ?? 0);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return '';
    }
    return new Intl.DateTimeFormat('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: 'short',
      timeZone: this.selectedTimeZone,
      hour12: false
    }).format(new Date(seconds * 1000));
  }

  onChartTypeChange(value: string): void {
    this.selectedChartType = this.toChartType(value);
    this.mount();
  }

  onPriceScaleModeChange(value: string): void {
    this.selectedPriceScaleMode = this.toPriceScaleMode(value);
    this.mount();
  }

  onTimeZoneChange(value: string): void {
    this.selectedTimeZone = value || 'Asia/Kolkata';
    this.mount();
  }

  onBarSpacingChange(value: string): void {
    const parsed = Number(value);
    this.selectedBarSpacing = Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
    this.mount();
  }

  onRightOffsetChange(value: string): void {
    const parsed = Number(value);
    this.selectedRightOffset = Number.isFinite(parsed) ? parsed : 3;
    this.mount();
  }

  onInvertScaleChange(checked: boolean): void {
    this.isPriceScaleInverted = checked;
    this.mount();
  }

  private toChartType(value: string): ChartType {
    const normalized = String(value || '').toLowerCase();
    if (
      normalized === 'candlestick' ||
      normalized === 'bar' ||
      normalized === 'line' ||
      normalized === 'area' ||
      normalized === 'baseline' ||
      normalized === 'histogram'
    ) {
      return normalized;
    }
    return 'candlestick';
  }

  private toPriceScaleMode(value: string): PriceScaleMode {
    const normalized = String(value || '').toLowerCase();
    if (normalized === 'normal' || normalized === 'log' || normalized === 'percentage' || normalized === 'indexedto100') {
      return normalized === 'indexedto100' ? 'indexedTo100' : (normalized as PriceScaleMode);
    }
    return 'normal';
  }

  private toPriceScaleModeValue(mode: PriceScaleMode): number {
    if (mode === 'log') return 1;
    if (mode === 'percentage') return 2;
    if (mode === 'indexedTo100') return 3;
    return 0;
  }

  private toTradingViewSymbol(rawSymbol: string): string {
    const clean = String(rawSymbol || 'NSE:NIFTY').trim().toUpperCase();
    return clean.includes(':') ? clean : `NSE:${clean}`;
  }

  private toZonedUnixSeconds(unixSeconds: number, zone: string): number {
    if (!zone || zone.toUpperCase() === 'UTC') {
      return unixSeconds;
    }
    const date = new Date(unixSeconds * 1000);
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(date);

    const read = (type: string): number =>
      Number(parts.find((part) => part.type === type)?.value ?? 0);

    const shifted = Date.UTC(
      read('year'),
      Math.max(read('month') - 1, 0),
      read('day'),
      read('hour'),
      read('minute'),
      read('second')
    );
    return Math.floor(shifted / 1000);
  }

  private normalizeInterval(value: string): string {
    const normalized = String(value || '').trim().toUpperCase();
    return normalized === '1D' ? 'D' : normalized;
  }

  private isWithinIndianMarketSession(zonedUnixSeconds: number): boolean {
    const d = new Date(zonedUnixSeconds * 1000);
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(d);

    const weekday = parts.find((p) => p.type === 'weekday')?.value || '';
    if (weekday === 'Sat' || weekday === 'Sun') {
      return false;
    }

    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    const totalMinutes = hour * 60 + minute;
    return totalMinutes >= 9 * 60 + 15 && totalMinutes <= 15 * 60 + 30;
  }
}
