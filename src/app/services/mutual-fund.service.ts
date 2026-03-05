import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, of, shareReplay } from 'rxjs';
import { MutualFundNavPoint, MutualFundScheme, MutualFundSnapshot } from '../models/market.models';

interface MfApiScheme {
  schemeCode?: string | number;
  schemeName?: string;
}

interface MfApiHistoryResponse {
  meta?: {
    scheme_code?: string | number;
    scheme_name?: string;
    fund_house?: string;
    scheme_category?: string;
  };
  data?: Array<{ date?: string; nav?: string | number }>;
}

@Injectable({
  providedIn: 'root'
})
export class MutualFundService {
  private readonly baseUrl = 'https://api.mfapi.in';
  private readonly fallbackSchemes: MutualFundScheme[] = [
    { schemeCode: '118989', schemeName: 'Axis Bluechip Fund - Direct Plan - Growth' },
    { schemeCode: '120503', schemeName: 'Parag Parikh Flexi Cap Fund - Direct Plan - Growth' },
    { schemeCode: '120716', schemeName: 'SBI Small Cap Fund - Direct Plan - Growth' },
    { schemeCode: '120465', schemeName: 'Mirae Asset Large Cap Fund - Direct Plan - Growth' }
  ];

  private directory$?: Observable<MutualFundScheme[]>;

  constructor(private readonly http: HttpClient) {}

  getSchemeDirectory(): Observable<MutualFundScheme[]> {
    if (this.directory$) {
      return this.directory$;
    }

    this.directory$ = this.http.get<MfApiScheme[]>(`${this.baseUrl}/mf`).pipe(
      map((rows) =>
        (rows || [])
          .map((row) => ({
            schemeCode: String(row.schemeCode ?? '').trim(),
            schemeName: String(row.schemeName ?? '').trim()
          }))
          .filter((row) => row.schemeCode.length > 0 && row.schemeName.length > 0)
      ),
      map((rows) => (rows.length > 0 ? rows : this.fallbackSchemes)),
      catchError(() => of(this.fallbackSchemes)),
      shareReplay(1)
    );

    return this.directory$;
  }

  getSchemeHistory(schemeCode: string): Observable<MutualFundSnapshot> {
    const safeCode = String(schemeCode || '').trim();
    if (!safeCode) {
      return of(this.syntheticSnapshot('120503', 'Parag Parikh Flexi Cap Fund - Direct Plan - Growth'));
    }

    return this.http.get<MfApiHistoryResponse>(`${this.baseUrl}/mf/${encodeURIComponent(safeCode)}`).pipe(
      map((payload) => this.toSnapshot(payload, safeCode)),
      catchError(() => of(this.syntheticSnapshot(safeCode, `Scheme ${safeCode}`)))
    );
  }

  private toSnapshot(payload: MfApiHistoryResponse, fallbackCode: string): MutualFundSnapshot {
    const meta = payload?.meta ?? {};
    const points = (payload?.data || [])
      .map((row) => this.toPoint(row.date, row.nav))
      .filter((row): row is MutualFundNavPoint => row !== null)
      .sort((a, b) => a.timestamp - b.timestamp);

    if (points.length === 0) {
      return this.syntheticSnapshot(
        String(meta.scheme_code ?? fallbackCode),
        String(meta.scheme_name ?? `Scheme ${fallbackCode}`)
      );
    }

    return {
      schemeCode: String(meta.scheme_code ?? fallbackCode),
      schemeName: String(meta.scheme_name ?? `Scheme ${fallbackCode}`),
      amc: String(meta.fund_house ?? ''),
      category: String(meta.scheme_category ?? ''),
      navHistory: points
    };
  }

  private toPoint(dateRaw: string | undefined, navRaw: string | number | undefined): MutualFundNavPoint | null {
    const date = String(dateRaw ?? '').trim();
    const nav = Number(navRaw ?? 0);
    if (!date || !Number.isFinite(nav) || nav <= 0) {
      return null;
    }

    const parts = date.split('-');
    if (parts.length !== 3) {
      return null;
    }

    const dd = Number(parts[0]);
    const mm = Number(parts[1]);
    const yyyy = Number(parts[2]);
    if (!Number.isFinite(dd) || !Number.isFinite(mm) || !Number.isFinite(yyyy)) {
      return null;
    }

    const timestamp = new Date(yyyy, mm - 1, dd).getTime();
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      return null;
    }

    return { date, nav, timestamp };
  }

  private syntheticSnapshot(schemeCode: string, schemeName: string): MutualFundSnapshot {
    const history: MutualFundNavPoint[] = [];
    const now = new Date();
    let nav = 100;

    for (let i = 900; i >= 0; i -= 1) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      if (d.getDay() === 0 || d.getDay() === 6) {
        continue;
      }
      nav = Math.max(10, nav * (1 + (Math.random() - 0.48) * 0.004));
      history.push({
        date: `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`,
        nav: Math.round(nav * 10000) / 10000,
        timestamp: d.getTime()
      });
    }

    return {
      schemeCode,
      schemeName,
      amc: 'Synthetic AMC',
      category: 'Fallback Data',
      navHistory: history
    };
  }
}

