import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newDb } from 'pg-mem';
import { SCHEMA_SQL } from '../src/db';
import { createRateProvider } from '../src/exchange';

const TTL = 3600_000;
const apiOk = (rates: Record<string, number>) => vi.fn(async () => new Response(JSON.stringify({ rates })));

let db: any;

beforeEach(async () => {
  const { Pool } = newDb().adapters.createPg();
  db = new Pool();
  await db.query(SCHEMA_SQL);
});
afterEach(() => vi.unstubAllGlobals());

describe('proveedor de tasas con caché', () => {
  it('consulta la API la primera vez (source = api)', async () => {
    vi.stubGlobal('fetch', apiOk({ EUR: 0.85 }));
    expect(await createRateProvider(db, TTL)('EUR')).toEqual({ rate: 0.85, source: 'api' });
  });

  it('reutiliza la caché vigente sin llamar de nuevo a la API', async () => {
    const f = apiOk({ EUR: 0.85, MXN: 17 });
    vi.stubGlobal('fetch', f);
    const rate = createRateProvider(db, TTL);
    await rate('EUR');
    expect(await rate('MXN')).toEqual({ rate: 17, source: 'cache' }); // otra moneda, misma consulta
    expect(await rate('EUR')).toEqual({ rate: 0.85, source: 'cache' });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('la caché se comparte entre instancias (misma base de datos)', async () => {
    const f = apiOk({ EUR: 0.85 });
    vi.stubGlobal('fetch', f);
    await createRateProvider(db, TTL)('EUR');
    expect((await createRateProvider(db, TTL)('EUR')).source).toBe('cache');
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('refresca cuando la caché venció (TTL)', async () => {
    const f = apiOk({ EUR: 0.85 });
    vi.stubGlobal('fetch', f);
    const rate = createRateProvider(db, 0); // TTL 0: siempre vencida
    await rate('EUR');
    expect((await rate('EUR')).source).toBe('api');
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('si la API falla usa la caché vencida (source = cache)', async () => {
    vi.stubGlobal('fetch', apiOk({ EUR: 0.85 }));
    await createRateProvider(db, 0)('EUR'); // llena la caché
    vi.stubGlobal('fetch', async () => {
      throw new Error('network');
    });
    expect(await createRateProvider(db, 0)('EUR')).toEqual({ rate: 0.85, source: 'cache' });
  });

  it('sin caché y con la API caída usa la tasa por defecto (fallback)', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('network');
    });
    const r = await createRateProvider(db, TTL)('EUR');
    expect(r.source).toBe('fallback');
    expect(r.rate).toBeGreaterThan(0);
  });

  it('fallback si la API responde HTTP 500 o no incluye la moneda', async () => {
    vi.stubGlobal('fetch', async () => new Response('err', { status: 500 }));
    expect((await createRateProvider(db, TTL)('EUR')).source).toBe('fallback');
    vi.stubGlobal('fetch', apiOk({ MXN: 17 }));
    expect((await createRateProvider(db, TTL)('XYZ')).source).toBe('fallback');
  });
});
