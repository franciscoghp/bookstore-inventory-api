import 'dotenv/config';

/** Lee una variable de entorno obligatoria; si falta, falla con un mensaje claro. */
export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function requireNumber(name: string): number {
  const n = Number(requireEnv(name));
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Environment variable ${name} must be a positive number`);
  return n;
}

// Sin valores por defecto: todo se configura por variables de entorno (ver .env.example).
export const config = {
  exchangeApiUrl: requireEnv('EXCHANGE_API_URL'),
  exchangeTimeoutMs: requireNumber('EXCHANGE_API_TIMEOUT_MS'),
  marginPercentage: requireNumber('PROFIT_MARGIN_PERCENTAGE'),
  defaultExchangeRate: requireNumber('DEFAULT_EXCHANGE_RATE'),
  exchangeCacheTtlSeconds: requireNumber('EXCHANGE_RATE_CACHE_TTL_SECONDS'),
};
