import { afterEach, expect, it, vi } from 'vitest';
import { fetchRate } from '../src/exchange';

afterEach(() => vi.unstubAllGlobals());

it('usa la tasa de la API cuando responde', async () => {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ rates: { EUR: 0.85 } })));
  expect(await fetchRate('EUR')).toEqual({ rate: 0.85, source: 'api' });
});

it('usa tasa de respaldo si la API falla (red)', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new Error('network');
  });
  const r = await fetchRate('EUR');
  expect(r.source).toBe('fallback');
  expect(r.rate).toBeGreaterThan(0);
});

it('usa tasa de respaldo si responde HTTP 500 o sin la moneda', async () => {
  vi.stubGlobal('fetch', async () => new Response('err', { status: 500 }));
  expect((await fetchRate('EUR')).source).toBe('fallback');
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ rates: {} })));
  expect((await fetchRate('EUR')).source).toBe('fallback');
});
