import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Las variables son obligatorias; los tests usan valores propios y una BD en memoria.
    env: {
      EXCHANGE_API_URL: 'https://api.exchangerate-api.com/v4/latest/USD',
      EXCHANGE_API_TIMEOUT_MS: '4000',
      PROFIT_MARGIN_PERCENTAGE: '40',
      DEFAULT_EXCHANGE_RATE: '1',
      EXCHANGE_RATE_CACHE_TTL_SECONDS: '3600',
    },
  },
});
