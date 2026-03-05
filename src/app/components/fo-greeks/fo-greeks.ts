import { CommonModule, DecimalPipe } from '@angular/common';
import { Component, Input } from '@angular/core';
import { MarketSnapshot, OptionGreek } from '../../models/market.models';
import { TradingviewChartComponent } from '../tradingview-chart/tradingview-chart';

interface GreekRow {
  strike: number;
  ce: OptionGreek | null;
  pe: OptionGreek | null;
}

@Component({
  selector: 'app-fo-greeks',
  standalone: true,
  imports: [CommonModule, DecimalPipe, TradingviewChartComponent],
  templateUrl: './fo-greeks.html',
  styleUrl: './fo-greeks.css'
})
export class FoGreeksComponent {
  @Input({ required: true }) snapshot!: MarketSnapshot;
  @Input() interval = '5';

  get chainRows(): GreekRow[] {
    const rows = new Map<number, GreekRow>();

    for (const greek of this.snapshot.foGreeks) {
      const current = rows.get(greek.strikePrice) ?? {
        strike: greek.strikePrice,
        ce: null,
        pe: null
      };

      if (greek.optionType === 'CE') {
        current.ce = greek;
      } else {
        current.pe = greek;
      }

      rows.set(greek.strikePrice, current);
    }

    return Array.from(rows.values()).sort((a, b) => a.strike - b.strike);
  }

  isAtm(strike: number): boolean {
    return Math.abs(strike - this.snapshot.price) <= 25;
  }

  get totalCallOi(): number {
    return this.snapshot.foGreeks
      .filter((item) => item.optionType === 'CE')
      .reduce((sum, item) => sum + item.oi, 0);
  }

  get totalPutOi(): number {
    return this.snapshot.foGreeks
      .filter((item) => item.optionType === 'PE')
      .reduce((sum, item) => sum + item.oi, 0);
  }

  get putCallRatio(): number {
    const ce = Math.max(this.totalCallOi, 1);
    return this.round(this.totalPutOi / ce, 2);
  }

  get atmStrike(): number {
    const strikes = [...new Set(this.snapshot.foGreeks.map((item) => item.strikePrice))];
    if (strikes.length === 0) {
      return 0;
    }

    return strikes.reduce((closest, strike) =>
      Math.abs(strike - this.snapshot.price) < Math.abs(closest - this.snapshot.price) ? strike : closest
    );
  }

  get atmStraddlePremium(): number {
    const ce = this.snapshot.foGreeks.find((item) => item.optionType === 'CE' && item.strikePrice === this.atmStrike);
    const pe = this.snapshot.foGreeks.find((item) => item.optionType === 'PE' && item.strikePrice === this.atmStrike);
    return this.round((ce?.ltp ?? 0) + (pe?.ltp ?? 0), 2);
  }

  get ivSkew(): number {
    const ceAvg = this.average(this.snapshot.foGreeks.filter((item) => item.optionType === 'CE').map((item) => item.iv));
    const peAvg = this.average(this.snapshot.foGreeks.filter((item) => item.optionType === 'PE').map((item) => item.iv));
    return this.round(peAvg - ceAvg, 2);
  }

  get ceVolume(): number {
    return this.snapshot.foGreeks
      .filter((item) => item.optionType === 'CE')
      .reduce((sum, item) => sum + item.tradeVolume, 0);
  }

  get peVolume(): number {
    return this.snapshot.foGreeks
      .filter((item) => item.optionType === 'PE')
      .reduce((sum, item) => sum + item.tradeVolume, 0);
  }

  get volumeDominance(): 'CALLS' | 'PUTS' | 'NEUTRAL' {
    const gap = this.ceVolume - this.peVolume;
    if (Math.abs(gap) < Math.max(this.ceVolume, this.peVolume) * 0.03) {
      return 'NEUTRAL';
    }
    return gap > 0 ? 'CALLS' : 'PUTS';
  }

  get maxPainStrike(): number {
    const rows = this.chainRows;
    if (rows.length === 0) {
      return 0;
    }

    let minPain = Number.POSITIVE_INFINITY;
    let bestStrike = rows[0].strike;

    for (const settle of rows) {
      const pain = rows.reduce((sum, row) => {
        const callPain = Math.max(settle.strike - row.strike, 0) * (row.ce?.oi ?? 0);
        const putPain = Math.max(row.strike - settle.strike, 0) * (row.pe?.oi ?? 0);
        return sum + callPain + putPain;
      }, 0);

      if (pain < minPain) {
        minPain = pain;
        bestStrike = settle.strike;
      }
    }

    return bestStrike;
  }

  get callWallStrike(): number {
    const ceRows = this.snapshot.foGreeks.filter((item) => item.optionType === 'CE');
    if (ceRows.length === 0) {
      return 0;
    }
    return ceRows.reduce((best, item) => (item.oi > best.oi ? item : best)).strikePrice;
  }

  get putWallStrike(): number {
    const peRows = this.snapshot.foGreeks.filter((item) => item.optionType === 'PE');
    if (peRows.length === 0) {
      return 0;
    }
    return peRows.reduce((best, item) => (item.oi > best.oi ? item : best)).strikePrice;
  }

  get atmGamma(): number {
    const rows = this.snapshot.foGreeks.filter((item) => item.strikePrice === this.atmStrike);
    if (rows.length === 0) {
      return 0;
    }
    return this.round(this.average(rows.map((item) => item.gamma)), 4);
  }

  get netDeltaOi(): number {
    return Math.round(
      this.snapshot.foGreeks.reduce((sum, item) => sum + item.delta * item.oi, 0)
    );
  }

  private average(values: number[]): number {
    if (values.length === 0) {
      return 0;
    }
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  private round(value: number, precision = 2): number {
    const factor = Math.pow(10, precision);
    return Math.round(value * factor) / factor;
  }
}
