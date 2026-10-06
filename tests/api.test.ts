import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { newDb } from 'pg-mem';
import { createApp } from '../src/app';
import { RateProvider } from '../src/exchange';

const book = {
  title: 'El Quijote',
  author: 'Miguel de Cervantes',
  isbn: '978-84-376-0494-7',
  cost_usd: 15.99,
  stock_quantity: 25,
  category: 'Literatura Clásica',
  supplier_country: 'ES',
};

let rate: RateProvider;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  const { Pool } = newDb().adapters.createPg();
  rate = async () => ({ rate: 0.85, source: 'api' });
  app = createApp(new Pool(), (c) => rate(c));
});

describe('CRUD', () => {
  it('crea, obtiene, actualiza y elimina', async () => {
    const created = await request(app).post('/books').send(book);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ id: 1, cost_usd: 15.99, selling_price_local: null, supplier_country: 'ES' });

    expect((await request(app).get('/books/1')).body.title).toBe('El Quijote');

    const upd = await request(app).put('/books/1').send({ ...book, stock_quantity: 3 });
    expect(upd.status).toBe(200);
    expect(upd.body.stock_quantity).toBe(3);

    expect((await request(app).delete('/books/1')).status).toBe(204);
    expect((await request(app).get('/books/1')).status).toBe(404);
  });

  it('lista con paginación', async () => {
    for (const isbn of ['0306406152', '9780306406157', '0-8044-2957-X']) {
      await request(app).post('/books').send({ ...book, isbn });
    }
    const res = await request(app).get('/books?page=2&limit=2');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.pagination).toEqual({ page: 2, limit: 2, total: 3, total_pages: 2 });
  });

  it('search por categoría y low-stock', async () => {
    await request(app).post('/books').send(book);
    await request(app).post('/books').send({ ...book, isbn: '0306406152', category: 'Ciencia', stock_quantity: 2 });
    const s = await request(app).get('/books/search?category=ciencia');
    expect(s.body.data).toHaveLength(1);
    const l = await request(app).get('/books/low-stock?threshold=10');
    expect(l.body.data.map((b: any) => b.stock_quantity)).toEqual([2]);
  });
});

describe('reglas de negocio', () => {
  it.each([
    ['cost_usd = 0', { cost_usd: 0 }],
    ['cost_usd negativo', { cost_usd: -5 }],
    ['stock negativo', { stock_quantity: -1 }],
    ['isbn corto', { isbn: '12345' }],
    ['isbn con letras', { isbn: 'abcdefghij' }],
    ['país inválido', { supplier_country: 'ESP' }],
  ])('400: %s', async (_n, patch) => {
    const res = await request(app).post('/books').send({ ...book, ...patch });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  it('acepta ISBN-10 con guiones', async () => {
    expect((await request(app).post('/books').send({ ...book, isbn: '0-306-40615-2' })).status).toBe(201);
  });

  it('409 con ISBN duplicado (incluso con otro formato)', async () => {
    await request(app).post('/books').send(book);
    const dup = await request(app).post('/books').send({ ...book, isbn: '9788437604947' });
    expect(dup.status).toBe(409);
  });

  it('400 con id inválido y 404 con id inexistente', async () => {
    expect((await request(app).get('/books/abc')).status).toBe(400);
    expect((await request(app).get('/books/999')).status).toBe(404);
    expect((await request(app).put('/books/999').send(book)).status).toBe(404);
    expect((await request(app).delete('/books/999')).status).toBe(404);
    expect((await request(app).post('/books/999/calculate-price')).status).toBe(404);
  });

  it('400 con JSON mal formado', async () => {
    const res = await request(app).post('/books').set('Content-Type', 'application/json').send('{oops');
    expect(res.status).toBe(400);
  });
});

describe('calculate-price', () => {
  it('calcula con margen 40% y guarda selling_price_local', async () => {
    await request(app).post('/books').send(book);
    const res = await request(app).post('/books/1/calculate-price');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      book_id: 1,
      cost_usd: 15.99,
      exchange_rate: 0.85,
      cost_local: 13.59,
      margin_percentage: 40,
      selling_price_local: 19.03,
      currency: 'EUR',
      rate_source: 'api',
    });
    expect(res.body.calculation_timestamp).toBeTruthy();
    expect((await request(app).get('/books/1')).body.selling_price_local).toBe(19.03);
  });

  it('permite sobreescribir la moneda', async () => {
    await request(app).post('/books').send(book);
    let asked = '';
    rate = async (c) => ((asked = c), { rate: 17, source: 'api' });
    const res = await request(app).post('/books/1/calculate-price').send({ currency: 'mxn' });
    expect(asked).toBe('MXN');
    expect(res.body.currency).toBe('MXN');
  });

  it('responde 200 con tasa de respaldo si la API de cambio falla', async () => {
    await request(app).post('/books').send(book);
    rate = async () => ({ rate: 0.92, source: 'fallback' });
    const res = await request(app).post('/books/1/calculate-price');
    expect(res.status).toBe(200);
    expect(res.body.rate_source).toBe('fallback');
  });
});

describe('infraestructura', () => {
  it('503 si la base de datos no responde', async () => {
    const down = createApp({
      query: async () => {
        throw Object.assign(new Error('x'), { code: 'ECONNREFUSED' });
      },
    });
    expect((await request(down).get('/health')).status).toBe(503);
    expect((await request(down).get('/books')).status).toBe(503);
  });

  it('404 en rutas desconocidas', async () => {
    expect((await request(app).get('/nope')).status).toBe(404);
  });
});

describe('documentación', () => {
  it('sirve la especificación OpenAPI y la página /docs', async () => {
    const spec = await request(app).get('/openapi.json');
    expect(spec.status).toBe(200);
    expect(spec.body.openapi).toMatch(/^3\./);
    expect(Object.keys(spec.body.paths)).toContain('/books/{id}/calculate-price');
    const docs = await request(app).get('/docs');
    expect(docs.status).toBe(200);
    expect(docs.text).toContain('swagger-ui');
  });
});
