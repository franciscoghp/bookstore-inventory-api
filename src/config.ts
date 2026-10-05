import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL,
  exchangeApiUrl: process.env.EXCHANGE_API_URL ?? 'https://api.exchangerate-api.com/v4/latest/USD',
  exchangeTimeoutMs: Number(process.env.EXCHANGE_API_TIMEOUT_MS ?? 4000),
  marginPercentage: Number(process.env.PROFIT_MARGIN_PERCENTAGE ?? 40),
  defaultExchangeRate: Number(process.env.DEFAULT_EXCHANGE_RATE ?? 1),
};
