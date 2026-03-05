import { CommonModule, DecimalPipe } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MutualFundNavPoint, MutualFundScheme, MutualFundSnapshot } from '../../models/market.models';
import { MutualFundService } from '../../services/mutual-fund.service';

interface CompareRow {
  schemeCode: string;
  schemeName: string;
  nav: number;
  return1Y: number;
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

  isDirectoryLoading = false;
  isHistoryLoading = false;
  errorMessage = '';

  private allSchemes: MutualFundScheme[] = [];
  filteredSchemes: MutualFundScheme[] = [];
  selected: MutualFundSnapshot | null = null;
  compareRows: CompareRow[] = [];

  constructor(private readonly mfService: MutualFundService) {}

  ngOnInit(): void {
    this.loadDirectory();
  }

  get currentNav(): number {
    const nav = this.selected?.navHistory.at(-1)?.nav ?? 0;
    return this.round(nav, 4);
  }

  get chartPath(): string {
    const points = this.selected?.navHistory ?? [];
    if (points.length < 2) {
      return '';
    }

    const min = Math.min(...points.map((p) => p.nav));
    const max = Math.max(...points.map((p) => p.nav));
    const spread = Math.max(max - min, 0.0001);
    const width = 100;
    const step = width / Math.max(points.length - 1, 1);

    return points
      .map((p, idx) => {
        const x = idx * step;
        const y = 100 - ((p.nav - min) / spread) * 100;
        return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(' ');
  }

  get return1M(): number {
    return this.returnByDays(30);
  }

  get return6M(): number {
    return this.returnByDays(180);
  }

  get return1Y(): number {
    return this.returnByDays(365);
  }

  get return3YCagr(): number {
    return this.cagrByDays(365 * 3);
  }

  get return5YCagr(): number {
    return this.cagrByDays(365 * 5);
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
    const fv = this.monthlySip * (((Math.pow(1 + r, n) - 1) / r) * (1 + r));
    return this.round(fv, 2);
  }

  get sipGain(): number {
    return this.round(this.sipFutureValue - this.sipInvested, 2);
  }

  onQueryChange(): void {
    const q = this.query.trim().toLowerCase();
    if (!q) {
      this.filteredSchemes = this.allSchemes.slice(0, 20);
      return;
    }

    this.filteredSchemes = this.allSchemes
      .filter(
        (scheme) =>
          scheme.schemeName.toLowerCase().includes(q) || scheme.schemeCode.toLowerCase().includes(q)
      )
      .slice(0, 20);
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

  addToCompare(): void {
    if (!this.selected) {
      return;
    }
    if (this.compareRows.find((row) => row.schemeCode === this.selected!.schemeCode)) {
      return;
    }
    if (this.compareRows.length >= 3) {
      this.compareRows = this.compareRows.slice(1);
    }

    this.compareRows = [
      ...this.compareRows,
      {
        schemeCode: this.selected.schemeCode,
        schemeName: this.selected.schemeName,
        nav: this.currentNav,
        return1Y: this.return1Y
      }
    ];
  }

  removeCompare(code: string): void {
    this.compareRows = this.compareRows.filter((row) => row.schemeCode !== code);
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
      },
      error: () => {
        this.isDirectoryLoading = false;
        this.errorMessage = 'Unable to load mutual fund scheme directory.';
      }
    });
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
    const pastTs = latest.timestamp - days * 24 * 60 * 60 * 1000;
    const older = this.closestBefore(history, pastTs);
    if (!older || older.nav <= 0) {
      return 0;
    }
    return this.round(((latest.nav - older.nav) / older.nav) * 100, 2);
  }

  private cagrByDays(days: number): number {
    const years = days / 365;
    const history = this.selected?.navHistory ?? [];
    if (history.length < 2 || years <= 0) {
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
    const cagr = (Math.pow(latest.nav / older.nav, 1 / years) - 1) * 100;
    return this.round(cagr, 2);
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

  private round(value: number, precision = 2): number {
    const factor = Math.pow(10, precision);
    return Math.round(value * factor) / factor;
  }
}
