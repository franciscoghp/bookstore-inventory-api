# Documentación técnica — Bookstore Inventory API

## 1. Qué se pidió y cómo se resolvió

| Requisito de la prueba | Solución |
|---|---|
| Modelo `Book` con todos los campos | Tabla `books` en Postgres (sección 3) |
| CRUD + paginación | `POST/GET/PUT/DELETE /books`, paginación con `page` y `limit` |
| Opcionales: búsqueda por categoría y stock bajo | `/books/search` y `/books/low-stock` (implementados) |
| `POST /books/{id}/calculate-price` con API externa | Consulta `api.exchangerate-api.com`, aplica 40 %, guarda en BD y devuelve el detalle |
| Reglas de negocio | Validación con Zod + restricciones en la BD (doble barrera) |
| Errores 400, 404, 500, 503 | Middleware central de errores (sección 5) |
| Docker | `Dockerfile` multi-stage + `docker-compose.yml` (API + Postgres) |
| BD gestionada en la nube | Postgres en Neon/Supabase; **no** SQLite |
| Despliegue público | Vercel (serverless) |
| Postman apuntando a producción | Colección + entorno `production` con variable `baseUrl` |

## 2. Arquitectura

```
Cliente ──► Vercel (Express serverless) ──► Postgres gestionado (Neon)
                     │
                     └──► api.exchangerate-api.com (solo en calculate-price)
```

- **Express 5 + TypeScript**: tipado estricto, rutas simples. Express 5 propaga errores de handlers async.
- **`pg` directo (sin ORM)**: el esquema es una sola tabla; evita binarios de ORM en serverless y mantiene el arranque rápido. Todas las consultas están **parametrizadas** (sin riesgo de SQL injection).
- **Inyección de dependencias en `createApp(db, getRate)`**: permite probar con Postgres en memoria (`pg-mem`) y simular la API de cambio sin red.
- **Migración automática e idempotente**: la primera petición a `/books` ejecuta `CREATE TABLE IF NOT EXISTS`. No hay que correr scripts manuales en el despliegue.
- **Vercel**: `api/index.ts` exporta la app Express; `vercel.json` reescribe todas las rutas a esa función, de modo que las URL son las mismas que en local (`/books/...`).

## 3. Modelo de datos

| Campo | Tipo | Notas |
|---|---|---|
| `id` | SERIAL PK | |
| `title`, `author` | VARCHAR(255) | obligatorios |
| `isbn` | VARCHAR(20) | tal como lo envía el cliente (ej. `978-84-376-0494-7`) |
| `isbn_normalized` | VARCHAR(13) **UNIQUE** | solo dígitos/X; garantiza "no duplicados" aunque cambie el formato con guiones. No se expone en la API |
| `cost_usd` | NUMERIC(10,2) | `CHECK > 0` |
| `selling_price_local` | NUMERIC(12,2) NULL | solo lo escribe `calculate-price` |
| `stock_quantity` | INTEGER | `CHECK >= 0`, default 0 |
| `category` | VARCHAR(100) | |
| `supplier_country` | CHAR(2) | código ISO (ES, MX, CO…), determina la moneda |
| `created_at`, `updated_at` | TIMESTAMPTZ | |

Se usa `NUMERIC` (no `FLOAT`) para dinero, evitando errores de redondeo binario.

## 4. Lógica de `calculate-price`

1. Lee el libro (404 si no existe).
2. Determina la moneda local: la del `supplier_country` (ES→EUR, MX→MXN, CO→COP…; país no mapeado → USD). Se puede forzar enviando `{"currency": "MXN"}` en el body.
3. Obtiene la tasa de `https://api.exchangerate-api.com/v4/latest/USD` (timeout 4 s).
4. `cost_local = round2(cost_usd × tasa)`; `selling_price_local = round2(cost_local × 1.40)`.
5. Guarda `selling_price_local` (y `updated_at`) en la BD.
6. Responde con el cálculo detallado.

Ejemplo del enunciado: 15.99 × 0.85 = **13.59**; 13.59 × 1.4 = **19.03** (verificado en los tests).

**Fallo de la API de cambio** (red caída, timeout, HTTP ≠ 200, moneda ausente): no se devuelve error; se usa una tasa de respaldo (tabla `FALLBACK_RATES` en `src/exchange.ts`, o `DEFAULT_EXCHANGE_RATE` si la moneda no está en la tabla) y la respuesta incluye `"rate_source": "fallback"` para que el cliente sepa que no es una tasa en vivo.

## 5. Validaciones y manejo de errores

| Situación | Código |
|---|---|
| `cost_usd <= 0`, `stock_quantity < 0`, ISBN con formato inválido, país no ISO, id no numérico, JSON mal formado, query params inválidos | **400** |
| Libro inexistente (GET/PUT/DELETE/calculate-price) o ruta desconocida | **404** |
| ISBN duplicado (POST/PUT) — detectado por la restricción UNIQUE (`23505`), sin condiciones de carrera | **409** |
| Base de datos caída o inaccesible | **503** |
| Error no previsto (se registra en logs, no se filtra al cliente) | **500** |

ISBN válido: 10 dígitos (el último puede ser `X`) o 13 dígitos, con o sin guiones/espacios. Siguiendo el enunciado se valida el **formato** (no el dígito verificador).

> Decisión: `PUT` es un reemplazo completo (semántica REST). `selling_price_local` no se acepta en POST/PUT porque es un valor derivado.

## 6. Pruebas

`npm test` ejecuta 21 pruebas con Vitest + Supertest sobre Postgres en memoria (`pg-mem`): CRUD, paginación, búsqueda, stock bajo, todas las reglas de negocio, duplicados con distinto formato de ISBN, 404/400/503, cálculo exacto del ejemplo (19.03), y el fallback de la API de cambio (error de red, HTTP 500, moneda ausente).

## 7. Despliegue en Vercel + Neon

Necesitas: cuenta de GitHub y de Vercel (ya las tienes). La base de datos se crea desde Vercel, gratis.

1. **Subir el código a GitHub**: crea un repositorio vacío `bookstore-inventory-api` y, desde la carpeta del proyecto:
   ```bash
   git remote add origin https://github.com/<tu-usuario>/bookstore-inventory-api.git
   git push -u origin main
   ```
2. **Importar en Vercel**: *Add New → Project →* elige el repositorio. Framework preset: **Other**. No cambies build/output (Vercel detecta `api/index.ts`). *Aún no hagas Deploy* (o hazlo y redeploya luego del paso 3).
3. **Crear la base de datos**: en el proyecto de Vercel → pestaña **Storage** → **Create Database → Neon (Postgres)** → plan gratuito → *Connect to project*. Vercel añade automáticamente variables como `DATABASE_URL` (si tu integración crea otro nombre, como `POSTGRES_URL`, copia su valor).
4. **Variable `DATABASE_URL`**: en *Settings → Environment Variables* confirma que existe `DATABASE_URL` con la cadena de conexión de Neon (para Production). Si no existe, créala pegando la cadena.
5. **Deploy**: *Deployments → Redeploy*. Prueba `https://<tu-proyecto>.vercel.app/health` → `{"status":"ok","database":"up"}`.
6. **Postman**: regenera la colección con tu URL y súbela al repo:
   ```bash
   node postman/build.js https://<tu-proyecto>.vercel.app
   ```
   (o edita la variable `baseUrl` en `postman/production.postman_environment.json`). Actualiza también la URL pública al inicio del README.
7. **Desactiva "Deployment Protection"** si Vercel la activó (*Settings → Deployment Protection → Vercel Authentication: Disabled*), o los evaluadores recibirán 401 al entrar a la API.

### Alternativas
- **Supabase** en lugar de Neon: crea un proyecto, copia la cadena de conexión *Transaction pooler* y úsala como `DATABASE_URL`.
- **Render / Railway / Fly.io**: el `Dockerfile` ya está listo; define `DATABASE_URL` y el servicio arranca con `node dist/server.js`.

## 8. Contenerización

- `Dockerfile` multi-stage (build con dev-deps → imagen final solo con dependencias de producción, usuario no root, `HEALTHCHECK`).
- `docker-compose.yml` levanta Postgres 16 (con healthcheck) y la API que espera a que la BD esté lista.

## 9. Mejoras posibles (fuera del alcance)

Caché de la tasa de cambio (p. ej. 1 h) para no llamar a la API en cada cálculo, autenticación (API key/JWT), OpenAPI/Swagger, migraciones versionadas (Prisma/Knex), validación del dígito verificador del ISBN, rate limiting.
