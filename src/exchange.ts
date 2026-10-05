import { config } from './config';

/** Tasas USD->X de respaldo (aproximadas) por si la API externa no responde. */
export const FALLBACK_RATES: Record<string, number> = {
  USD: 1, EUR: 0.92, GBP: 0.79, MXN: 17.5, COP: 4000, ARS: 950, CLP: 950, PEN: 3.75,
  BRL: 5.5, UYU: 40, BOB: 6.9, VES: 40, DOP: 59, GTQ: 7.7, CRC: 520, PAB: 1,
};

/** País del proveedor (ISO-3166 alfa-2) -> moneda local. */
export const COUNTRY_CURRENCY: Record<string, string> = {
  US: 'USD', ES: 'EUR', FR: 'EUR', DE: 'EUR', IT: 'EUR', PT: 'EUR', NL: 'EUR', IE: 'EUR',
  GB: 'GBP', MX: 'MXN', CO: 'COP', AR: 'ARS', CL: 'CLP', PE: 'PEN', BR: 'BRL', UY: 'UYU',
  BO: 'BOB', VE: 'VES', DO: 'DOP', GT: 'GTQ', CR: 'CRC', PA: 'PAB', EC: 'USD', SV: 'USD',
};

export interface RateResult {
  rate: number;
  source: 'api' | 'fallback';
}

export type RateProvider = (currency: string) => Promise<RateResult>;

export const currencyForCountry = (country?: string | null): string =>
  (country && COUNTRY_CURRENCY[country.toUpperCase()]) || 'USD';

/** Consulta la API; ante cualquier fallo usa la tasa por defecto (regla de negocio). */
export const fetchRate: RateProvider = async (currency) => {
  try {
    const res = await fetch(config.exchangeApiUrl, {
      signal: AbortSignal.timeout(config.exchangeTimeoutMs),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { rates?: Record<string, number> };
    const rate = data.rates?.[currency];
    if (typeof rate !== 'number' || !(rate > 0)) throw new Error(`sin tasa para ${currency}`);
    return { rate, source: 'api' };
  } catch (err) {
    console.warn(`[exchange] API fallida (${(err as Error).message}); usando tasa por defecto`);
    return { rate: FALLBACK_RATES[currency] ?? config.defaultExchangeRate, source: 'fallback' };
  }
};
