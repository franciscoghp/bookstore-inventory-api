// Servidor SOLO para pruebas locales: usa Postgres en memoria (pg-mem), no requiere instalar nada.
// Los datos se pierden al detenerlo. NO se usa en producción.
import { newDb } from 'pg-mem';
import { requireEnv } from './config';
import { createApp } from './app';

const { Pool } = newDb().adapters.createPg();

const port = Number(requireEnv('PORT'));

createApp(new Pool()).listen(port, () => {
  console.log(`API (in-memory DB) on http://localhost:${port}`);
});
