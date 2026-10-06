import { config } from './config';
import { Db } from './db';

/** Tasas USD->X de respaldo (aproximadas) por si la API externa no responde y no hay caché. */
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

/**
 * Origen de la tasa:
 * - api:      recién consultada a la API externa
 * - cache:    guardada en la base de datos (vigente, o vencida pero usada porque la API falló)
 * - fallback: tasa por defecto, porque la API falló y no había caché
 */
export interface RateResult {
  rate: number;
  source: 'api' | 'cache' | 'fallback';
}

export type RateProvider = (currency: string) => Promise<RateResult>;

export const currencyForCountry = (country?: string | null): string =>
  (country && COUNTRY_CURRENCY[country.toUpperCase()]) || 'USD';

type Rates = Record<string, number>;

/** Descarga la tabla completa de tasas USD->X. Lanza si la API falla. */
async function fetchAllRates(): Promise<Rates> {
  const res = await fetch(config.exchangeApiUrl, {
    signal: AbortSignal.timeout(config.exchangeTimeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { rates?: Rates };
  if (!data.rates || typeof data.rates !== 'object') throw new Error('respuesta sin rates');
  return data.rates;
}

const isRate = (n: unknown): n is number => typeof n === 'number' && n > 0;

async function readCache(db: Db): Promise<{ rates: Rates; fetchedAt: number } | null> {
  try {
    const { rows } = await db.query('SELECT rates, fetched_at FROM exchange_rate_cache WHERE id = 1');
    if (!rows.length) return null;
    const rates = typeof rows[0].rates === 'string' ? JSON.parse(rows[0].rates) : rows[0].rates;
    return { rates, fetchedAt: new Date(rows[0].fetched_at).getTime() };
  } catch (err) {
    console.warn(`[exchange] no se pudo leer la caché: ${(err as Error).message}`);
    return null;
  }
}

async function writeCache(db: Db, rates: Rates): Promise<void> {
  try {
    await db.query(
      `INSERT INTO exchange_rate_cache (id, rates, fetched_at) VALUES (1, $1, NOW())
       ON CONFLICT (id) DO UPDATE SET rates = EXCLUDED.rates, fetched_at = NOW()`,
      [JSON.stringify(rates)],
    );
  } catch (err) {
    console.warn(`[exchange] no se pudo guardar la caché: ${(err as Error).message}`);
  }
}

/**
 * Proveedor de tasas con caché en la base de datos (compartida entre instancias serverless).
 * 1) Caché vigente (menor al TTL)        -> la usa, sin llamar a la API.
 * 2) Si no, consulta la API y refresca la caché.
 * 3) Si la API falla: usa la caché vencida si existe; si no, la tasa por defecto (fallback).
 */
export function createRateProvider(
  db: Db,
  ttlMs: number = config.exchangeCacheTtlSeconds * 1000,
): RateProvider {
  return async (currency) => {
    const cached = await readCache(db);
    const cachedRate = cached?.rates[currency];

    if (cached && isRate(cachedRate) && Date.now() - cached.fetchedAt < ttlMs) {
      return { rate: cachedRate, source: 'cache' };
    }

    try {
      const rates = await fetchAllRates();
      await writeCache(db, rates);
      const rate = rates[currency];
      if (!isRate(rate)) throw new Error(`no rate for ${currency}`);
      return { rate, source: 'api' };
    } catch (err) {
      console.warn(`[exchange] API failed (${(err as Error).message}); using cached/default rate`);
      if (isRate(cachedRate)) return { rate: cachedRate, source: 'cache' };
      return { rate: FALLBACK_RATES[currency] ?? config.defaultExchangeRate, source: 'fallback' };
    }
  };
}
