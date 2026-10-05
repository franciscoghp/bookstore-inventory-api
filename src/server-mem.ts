// Servidor SOLO para pruebas locales: usa Postgres en memoria (pg-mem), no requiere instalar nada.
// Los datos se pierden al detenerlo. NO se usa en producción.
import { newDb } from 'pg-mem';
import { config } from './config';
import { createApp } from './app';

const { Pool } = newDb().adapters.createPg();

createApp(new Pool()).listen(config.port, () => {
  console.log(`API (BD en memoria) en http://localhost:${config.port}`);
});
