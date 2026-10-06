import express, { NextFunction, Request, Response } from 'express';
import { Db, lazyDb, migrate } from './db';
import { booksRouter } from './books';
import { HttpError, badRequest, notFound, unavailable } from './errors';
import { RateProvider, fetchRate } from './exchange';

const DB_DOWN = ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', '57P01', '08006', '08001'];

export function createApp(db: Db = lazyDb, getRate: RateProvider = fetchRate) {
  const app = express();
  app.use(express.json());

  app.get('/', (_req, res) => {
    res.json({ name: 'bookstore-inventory-api', status: 'ok', books: '/books', health: '/health' });
  });

  app.get('/health', async (_req, res, next) => {
    try {
      await db.query('SELECT 1');
      res.json({ status: 'ok', database: 'up' });
    } catch {
      next(unavailable('Database unavailable'));
    }
  });

  // Garantiza que el esquema exista antes de atender /books
  app.use('/books', async (_req, _res, next) => {
    try {
      await migrate(db);
      next();
    } catch (e) {
      console.error('[db] migration failed', e);
      next(unavailable('Database unavailable'));
    }
  });
  app.use('/books', booksRouter(db, getRate));

  app.use((_req, _res, next) => next(notFound('Route not found')));

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    let e: HttpError;
    if (err instanceof HttpError) e = err;
    else if (err?.type === 'entity.parse.failed') e = badRequest('Malformed JSON');
    else if (DB_DOWN.includes(err?.code)) e = unavailable('Database unavailable');
    else {
      console.error(err);
      e = new HttpError(500, 'INTERNAL_ERROR', 'Internal server error');
    }
    res.status(e.status).json({ error: { code: e.code, message: e.message, details: e.details } });
  });

  return app;
}
