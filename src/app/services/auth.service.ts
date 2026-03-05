import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, catchError, map, tap, throwError, timeout } from 'rxjs';

interface LoginRequest {
  action?: string;
}

interface LoginResponse {
  ok?: boolean;
  status?: boolean;
  userId?: string;
  clientCode?: string;
}

export interface AngelUserProfile {
  clientcode: string;
  name: string;
  email: string;
  mobileno: string;
  exchanges: string[];
  products: string[];
  lastlogintime: string;
  brokerid: string;
}

export interface AngelHolding {
  tradingsymbol: string;
  exchange: string;
  isin: string;
  t1quantity: number;
  realisedquantity: number;
  product: string;
  quantity: number;
  authorisedquantity: number;
  collateralquantity: number | null;
  collateraltype: string | null;
  haircut: number;
  averageprice: number;
  ltp: number;
  symboltoken: string;
  close: number;
  profitandloss: number;
  pnlpercentage: number;
}

export interface AngelGainersLosersItem {
  tradingSymbol: string;
  percentChange: number;
  symbolToken: string;
  opnInterest: number;
  netChangeOpnInterest: number;
}

export interface AngelPcrItem {
  pcr: number;
  tradingSymbol: string;
}

export interface AngelOiBuildupItem {
  symbolToken: string;
  ltp: number;
  netChange: number;
  percentChange: number;
  opnInterest: number;
  netChangeOpnInterest: number;
  tradingSymbol: string;
}

export interface AngelOptionGreekItem {
  strikePrice: number;
  optionType: 'CE' | 'PE';
  delta: number;
  theta: number;
  vega: number;
  gamma: number;
  iv: number;
  ltp: number;
  tradeVolume: number;
  oi: number;
}

export interface AngelGttOrder {
  gttId: string;
  userId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  triggerPrice: number;
  quantity: number;
  targetPrice?: number;
  stopLoss?: number;
  notes?: string;
  status: 'ACTIVE' | 'CANCELLED';
  createdAt: number;
  updatedAt: number;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly loginUrl = '/api/AnavAngleone';
  private readonly storageKey = 'anavai.auth.angel';
  private readonly requestTimeoutMs = 15000;

  constructor(private readonly http: HttpClient) {}

  login(): Observable<void> {
    const request: LoginRequest = { action: 'login' };

    return this.http.post<LoginResponse>(this.loginUrl, request).pipe(
      map((response) => {
        if (response.ok !== true && response.status !== true) {
          throw new Error('Login failed.');
        }
        return response;
      }),
      tap((response) => {
        localStorage.setItem(
          this.storageKey,
          JSON.stringify({
            loggedIn: true,
            at: Date.now(),
            userId: response.userId ?? 'default-user',
            clientCode: response.clientCode ?? ''
          })
        );
      }),
      map(() => void 0),
      catchError((error: unknown) => {
        if (error instanceof HttpErrorResponse) {
          const message = error.error?.message;
          if (typeof message === 'string' && message.trim().length > 0) {
            return throwError(() => new Error(message));
          }
        }

        return throwError(() =>
          error instanceof Error ? error : new Error('Login failed. Check credentials and try again.')
        );
      })
    );
  }

  getProfile(): Observable<AngelUserProfile> {
    return this.http
      .get<{ ok?: boolean; profile?: Partial<AngelUserProfile> }>(`${this.loginUrl}?action=profile`)
      .pipe(
        timeout(this.requestTimeoutMs),
        map((response) => {
          const profile = response.profile ?? {};
          return {
            clientcode: String(profile.clientcode ?? ''),
            name: String(profile.name ?? ''),
            email: String(profile.email ?? ''),
            mobileno: String(profile.mobileno ?? ''),
            exchanges: Array.isArray(profile.exchanges) ? profile.exchanges.map((v) => String(v)) : [],
            products: Array.isArray(profile.products) ? profile.products.map((v) => String(v)) : [],
            lastlogintime: String(profile.lastlogintime ?? ''),
            brokerid: String(profile.brokerid ?? '')
          };
        })
      );
  }

  getHoldings(): Observable<AngelHolding[]> {
    return this.http
      .get<{ ok?: boolean; holdings?: Array<Partial<AngelHolding>>; data?: Array<Partial<AngelHolding>> }>(
        `${this.loginUrl}?action=holdings`
      )
      .pipe(
        timeout(this.requestTimeoutMs),
        map((response) =>
          (response.holdings ?? response.data ?? []).map((item) => ({
            tradingsymbol: String(item.tradingsymbol ?? ''),
            exchange: String(item.exchange ?? ''),
            isin: String(item.isin ?? ''),
            t1quantity: Number(item.t1quantity ?? 0),
            realisedquantity: Number(item.realisedquantity ?? 0),
            product: String(item.product ?? ''),
            quantity: Number(item.quantity ?? 0),
            authorisedquantity: Number(item.authorisedquantity ?? 0),
            collateralquantity:
              item.collateralquantity === null || item.collateralquantity === undefined
                ? null
                : Number(item.collateralquantity),
            collateraltype:
              item.collateraltype === null || item.collateraltype === undefined
                ? null
                : String(item.collateraltype),
            haircut: Number(item.haircut ?? 0),
            averageprice: Number(item.averageprice ?? 0),
            ltp: Number(item.ltp ?? 0),
            symboltoken: String(item.symboltoken ?? ''),
            close: Number(item.close ?? 0),
            profitandloss: Number(item.profitandloss ?? 0),
            pnlpercentage: Number(item.pnlpercentage ?? 0)
          }))
        )
      );
  }

  getGainersLosers(
    datatype: 'PercOILosers' | 'PercOIGainers' | 'PercPriceGainers' | 'PercPriceLosers',
    expirytype: 'NEAR' | 'NEXT' | 'FAR'
  ): Observable<AngelGainersLosersItem[]> {
    return this.http
      .post<{ ok?: boolean; data?: Array<Partial<AngelGainersLosersItem>> }>(this.loginUrl, {
        action: 'gainersLosers',
        datatype,
        expirytype
      })
      .pipe(
        map((response) =>
          (response.data ?? []).map((item) => ({
            tradingSymbol: String(item.tradingSymbol ?? ''),
            percentChange: Number(item.percentChange ?? 0),
            symbolToken: String(item.symbolToken ?? ''),
            opnInterest: Number(item.opnInterest ?? 0),
            netChangeOpnInterest: Number(item.netChangeOpnInterest ?? 0)
          }))
        )
      );
  }

  getPutCallRatio(): Observable<AngelPcrItem[]> {
    return this.http
      .get<{ ok?: boolean; data?: Array<Partial<AngelPcrItem>> }>(`${this.loginUrl}?action=putCallRatio`)
      .pipe(
        map((response) =>
          (response.data ?? []).map((item) => ({
            pcr: Number(item.pcr ?? 0),
            tradingSymbol: String(item.tradingSymbol ?? '')
          }))
        )
      );
  }

  getOiBuildup(
    datatype: 'Long Built Up' | 'Short Built Up' | 'Short Covering' | 'Long Unwinding',
    expirytype: 'NEAR' | 'NEXT' | 'FAR'
  ): Observable<AngelOiBuildupItem[]> {
    return this.http
      .post<{ ok?: boolean; data?: Array<Partial<AngelOiBuildupItem>> }>(this.loginUrl, {
        action: 'oiBuildup',
        datatype,
        expirytype
      })
      .pipe(
        map((response) =>
          (response.data ?? []).map((item) => ({
            symbolToken: String(item.symbolToken ?? ''),
            ltp: Number(item.ltp ?? 0),
            netChange: Number(item.netChange ?? 0),
            percentChange: Number(item.percentChange ?? 0),
            opnInterest: Number(item.opnInterest ?? 0),
            netChangeOpnInterest: Number(item.netChangeOpnInterest ?? 0),
            tradingSymbol: String(item.tradingSymbol ?? '')
          }))
        )
      );
  }

  getOptionGreeks(name: string, expirydate: string): Observable<AngelOptionGreekItem[]> {
    return this.http
      .post<{ ok?: boolean; status?: boolean; data?: Array<Record<string, unknown>> }>(this.loginUrl, {
        action: 'optionGreek',
        name,
        expirydate
      })
      .pipe(
        map((response) =>
          (response.data ?? []).map((item) => {
            const optionTypeRaw = String(item['optionType'] ?? item['optiontype'] ?? '').toUpperCase();
            const normalizedOptionType: 'CE' | 'PE' = optionTypeRaw === 'PE' ? 'PE' : 'CE';

            return {
              strikePrice: Number(item['strikePrice'] ?? item['strikeprice'] ?? 0),
              optionType: normalizedOptionType,
              delta: Number(item['delta'] ?? 0),
              theta: Number(item['theta'] ?? 0),
              vega: Number(item['vega'] ?? 0),
              gamma: Number(item['gamma'] ?? 0),
              iv: Number(
                item['iv'] ??
                  item['impliedVolatility'] ??
                  item['impliedvolatility'] ??
                  item['impliedvolatlity'] ??
                  0
              ),
              ltp: Number(item['ltp'] ?? item['lastPrice'] ?? item['lastTradedPrice'] ?? 0),
              tradeVolume: Number(item['tradeVolume'] ?? item['tradevolume'] ?? item['totalTradeVolume'] ?? 0),
              oi: Number(item['oi'] ?? item['openInterest'] ?? item['opnInterest'] ?? 0)
            };
          })
        )
      );
  }

  createGttOrder(input: {
    symbol: string;
    side: 'BUY' | 'SELL';
    triggerPrice: number;
    quantity?: number;
    targetPrice?: number;
    stopLoss?: number;
    notes?: string;
  }): Observable<AngelGttOrder> {
    return this.http
      .post<{ ok?: boolean; gtt?: Partial<AngelGttOrder> }>(this.loginUrl, {
        action: 'gtt_create',
        ...input
      })
      .pipe(map((response) => this.toGttOrder(response.gtt ?? {})));
  }

  getGttOrders(): Observable<AngelGttOrder[]> {
    return this.http
      .get<{ ok?: boolean; gtts?: Array<Partial<AngelGttOrder>> }>(`${this.loginUrl}?action=gtt_list`)
      .pipe(map((response) => (response.gtts ?? []).map((item) => this.toGttOrder(item))));
  }

  deleteGttOrder(gttId: string): Observable<void> {
    return this.http
      .post<{ ok?: boolean }>(this.loginUrl, { action: 'gtt_delete', gttId })
      .pipe(map(() => void 0));
  }

  isAuthenticated(): boolean {
    return localStorage.getItem(this.storageKey) !== null;
  }

  logout(): void {
    localStorage.removeItem(this.storageKey);
  }

  private toGttOrder(input: Partial<AngelGttOrder>): AngelGttOrder {
    const side = String(input.side ?? 'BUY').toUpperCase();
    const status = String(input.status ?? 'ACTIVE').toUpperCase();
    return {
      gttId: String(input.gttId ?? ''),
      userId: String(input.userId ?? 'default-user'),
      symbol: String(input.symbol ?? ''),
      side: side === 'SELL' ? 'SELL' : 'BUY',
      triggerPrice: Number(input.triggerPrice ?? 0),
      quantity: Math.max(1, Number(input.quantity ?? 1)),
      targetPrice: input.targetPrice === undefined ? undefined : Number(input.targetPrice),
      stopLoss: input.stopLoss === undefined ? undefined : Number(input.stopLoss),
      notes: input.notes ? String(input.notes) : undefined,
      status: status === 'CANCELLED' ? 'CANCELLED' : 'ACTIVE',
      createdAt: Number(input.createdAt ?? Date.now()),
      updatedAt: Number(input.updatedAt ?? Date.now())
    };
  }
}
