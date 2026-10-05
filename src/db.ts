import { Pool } from 'pg';
import { config } from './config';

export interface Db {
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
}

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS books (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  author VARCHAR(255) NOT NULL,
  isbn VARCHAR(20) NOT NULL,
  isbn_normalized VARCHAR(13) NOT NULL UNIQUE,
  cost_usd NUMERIC(10,2) NOT NULL CHECK (cost_usd > 0),
  selling_price_local NUMERIC(12,2),
  stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  category VARCHAR(100),
  supplier_country CHAR(2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_books_stock ON books (stock_quantity);
`;

let pool: Pool | undefined;

/** Pool compartido (se reutiliza entre invocaciones en entornos serverless). */
export function getPool(): Pool {
  if (!pool) {
    if (!config.databaseUrl) throw new Error('DATABASE_URL no está configurada');
    const local = /localhost|127\.0\.0\.1|@db[:/]/.test(config.databaseUrl);
    pool = new Pool({
      connectionString: config.databaseUrl,
      ssl: local ? undefined : { rejectUnauthorized: false },
      max: 5,
    });
  }
  return pool;
}

const migrations = new WeakMap<object, Promise<void>>();

/** Crea el esquema si no existe (idempotente, una vez por instancia de db). */
export function migrate(db: Db): Promise<void> {
  let p = migrations.get(db);
  if (!p) {
    p = db.query(SCHEMA_SQL).then(() => undefined);
    p.catch(() => migrations.delete(db));
    migrations.set(db, p);
  }
  return p;
}

/** Db perezosa: el pool se crea en la primera consulta, no al importar el módulo. */
export const lazyDb: Db = {
  query: (text, params) => getPool().query(text, params as any[]),
};
