import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { Db } from './db';
import { badRequest, conflict, notFound } from './errors';
import { config } from './config';
import { RateProvider, currencyForCountry } from './exchange';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const normalizeIsbn = (isbn: string) => isbn.replace(/[\s-]/g, '').toUpperCase();

const isbnSchema = z
  .string()
  .trim()
  .refine((v) => /^[\dxX\s-]+$/.test(v) && /^(\d{9}[\dX]|\d{13})$/.test(normalizeIsbn(v)), {
    message: 'isbn debe tener 10 o 13 dígitos (se permiten guiones; ISBN-10 puede terminar en X)',
  });

const base = {
  title: z.string().trim().min(1).max(255),
  author: z.string().trim().min(1).max(255),
  isbn: isbnSchema,
  cost_usd: z.number('cost_usd debe ser numérico').gt(0, 'cost_usd debe ser mayor a 0').max(99999999),
  stock_quantity: z
    .number('stock_quantity debe ser numérico')
    .int()
    .min(0, 'stock_quantity no puede ser negativo'),
  category: z.string().trim().max(100).nullish(),
  supplier_country: z
    .string()
    .trim()
    .length(2, 'supplier_country debe ser un código ISO de 2 letras')
    .transform((s) => s.toUpperCase())
    .nullish(),
};

// selling_price_local es de solo lectura: lo calcula calculate-price.
const createSchema = z.object({ ...base, stock_quantity: base.stock_quantity.default(0) });
const updateSchema = z.object(base); // PUT = reemplazo completo

const calcSchema = z
  .object({ currency: z.string().trim().length(3).transform((s) => s.toUpperCase()).optional() })
  .default({});

const idSchema = z.coerce.number().int().positive();

const parse = <T extends z.ZodType>(schema: T, data: unknown): z.output<T> => {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw badRequest(
      'Datos inválidos',
      r.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    );
  }
  return r.data;
};

const parseId = (raw: string) => {
  const r = idSchema.safeParse(raw);
  if (!r.success) throw badRequest('El id debe ser un entero positivo');
  return r.data;
};

const serialize = (r: any) => ({
  id: r.id,
  title: r.title,
  author: r.author,
  isbn: r.isbn,
  cost_usd: Number(r.cost_usd),
  selling_price_local: r.selling_price_local === null ? null : Number(r.selling_price_local),
  stock_quantity: r.stock_quantity,
  category: r.category,
  supplier_country: r.supplier_country?.trim() ?? null,
  created_at: new Date(r.created_at).toISOString(),
  updated_at: new Date(r.updated_at).toISOString(),
});

const COLS =
  'id, title, author, isbn, cost_usd, selling_price_local, stock_quantity, category, supplier_country, created_at, updated_at';

const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const pagination = (q: Request['query']) => {
  const p = parse(
    z.object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    }),
    q,
  );
  return { ...p, offset: (p.page - 1) * p.limit };
};

async function listWhere(db: Db, where: string, params: unknown[], q: Request['query'], order: string) {
  const { page, limit, offset } = pagination(q);
  const total = Number(
    (await db.query(`SELECT COUNT(*) AS n FROM books ${where}`, params)).rows[0].n,
  );
  const { rows } = await db.query(
    `SELECT ${COLS} FROM books ${where} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  return {
    data: rows.map(serialize),
    pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
  };
}

export function booksRouter(db: Db, getRate: RateProvider): Router {
  const r = Router();

  r.post('/', wrap(async (req, res) => {
    const b = parse(createSchema, req.body);
    try {
      const { rows } = await db.query(
        `INSERT INTO books (title, author, isbn, isbn_normalized, cost_usd, stock_quantity, category, supplier_country)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${COLS}`,
        [b.title, b.author, b.isbn, normalizeIsbn(b.isbn), b.cost_usd, b.stock_quantity, b.category ?? null, b.supplier_country ?? null],
      );
      res.status(201).json(serialize(rows[0]));
    } catch (e: any) {
      if (e.code === '23505') throw conflict(`Ya existe un libro con el ISBN ${b.isbn}`);
      throw e;
    }
  }));

  r.get('/', wrap(async (req, res) => {
    res.json(await listWhere(db, '', [], req.query, 'id ASC'));
  }));

  // Rutas fijas ANTES de /:id
  r.get('/search', wrap(async (req, res) => {
    const { category } = parse(z.object({ category: z.string().trim().min(1, 'category es requerido') }), req.query);
    res.json(await listWhere(db, 'WHERE LOWER(category) = LOWER($1)', [category], req.query, 'id ASC'));
  }));

  r.get('/low-stock', wrap(async (req, res) => {
    const { threshold } = parse(z.object({ threshold: z.coerce.number().int().min(0).default(10) }), req.query);
    res.json(await listWhere(db, 'WHERE stock_quantity < $1', [threshold], req.query, 'stock_quantity ASC, id ASC'));
  }));

  r.get('/:id', wrap(async (req, res) => {
    const id = parseId(req.params.id as string);
    const { rows } = await db.query(`SELECT ${COLS} FROM books WHERE id = $1`, [id]);
    if (!rows.length) throw notFound(`Libro ${id} no encontrado`);
    res.json(serialize(rows[0]));
  }));

  r.put('/:id', wrap(async (req, res) => {
    const id = parseId(req.params.id as string);
    const b = parse(updateSchema, req.body);
    try {
      const { rows } = await db.query(
        `UPDATE books SET title=$1, author=$2, isbn=$3, isbn_normalized=$4, cost_usd=$5, stock_quantity=$6,
           category=$7, supplier_country=$8, updated_at=NOW() WHERE id=$9 RETURNING ${COLS}`,
        [b.title, b.author, b.isbn, normalizeIsbn(b.isbn), b.cost_usd, b.stock_quantity, b.category ?? null, b.supplier_country ?? null, id],
      );
      if (!rows.length) throw notFound(`Libro ${id} no encontrado`);
      res.json(serialize(rows[0]));
    } catch (e: any) {
      if (e.code === '23505') throw conflict(`Ya existe otro libro con el ISBN ${b.isbn}`);
      throw e;
    }
  }));

  r.delete('/:id', wrap(async (req, res) => {
    const id = parseId(req.params.id as string);
    const { rowCount } = await db.query('DELETE FROM books WHERE id = $1', [id]);
    if (!rowCount) throw notFound(`Libro ${id} no encontrado`);
    res.status(204).end();
  }));

  r.post('/:id/calculate-price', wrap(async (req, res) => {
    const id = parseId(req.params.id as string);
    const { currency: override } = parse(calcSchema, req.body);
    const { rows } = await db.query(`SELECT ${COLS} FROM books WHERE id = $1`, [id]);
    if (!rows.length) throw notFound(`Libro ${id} no encontrado`);
    const book = serialize(rows[0]);

    const currency = override ?? currencyForCountry(book.supplier_country);
    const { rate, source } = await getRate(currency);
    const costLocal = round2(book.cost_usd * rate);
    const margin = config.marginPercentage;
    const selling = round2(costLocal * (1 + margin / 100));

    await db.query('UPDATE books SET selling_price_local=$1, updated_at=NOW() WHERE id=$2', [selling, id]);

    res.json({
      book_id: id,
      cost_usd: book.cost_usd,
      exchange_rate: rate,
      cost_local: costLocal,
      margin_percentage: margin,
      selling_price_local: selling,
      currency,
      rate_source: source,
      calculation_timestamp: new Date().toISOString(),
    });
  }));

  return r;
}
