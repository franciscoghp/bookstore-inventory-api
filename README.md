# Bookstore Inventory API

API REST para gestionar el inventario de una cadena de librerías, con cálculo del precio de venta sugerido a partir de la tasa de cambio USD → moneda local en tiempo real.

- **Stack:** Node.js 20 · TypeScript · Express 5 · PostgreSQL (`pg`) · Zod (validación) · Vitest + Supertest (tests)
- **Despliegue:** Vercel (serverless) + Postgres gestionado (Neon / Supabase)

> **URL pública:** `https://REEMPLAZA-CON-TU-URL.vercel.app`

## Requisitos previos

| Opción | Necesitas |
|---|---|
| Docker (recomendado) | Docker + Docker Compose |
| Local sin Docker | Node.js ≥ 20 y una base PostgreSQL accesible |

## Ejecutar con Docker (un solo comando)

```bash
docker compose up --build
```

Levanta Postgres 16 y la API en <http://localhost:3000>. La tabla se crea automáticamente.

## Ejecutar localmente (sin Docker)

```bash
npm install
cp .env.example .env        # y edita DATABASE_URL
npm run dev                 # http://localhost:3000 (recarga automática)
```

Producción local: `npm run build && npm start`.

**Probar sin instalar Postgres:** `npm run dev:mem` levanta la API con una base en memoria (datos temporales, solo para pruebas).

### Variables de entorno

| Variable | Default | Descripción |
|---|---|---|
| `DATABASE_URL` | – (**obligatoria**) | Cadena de conexión Postgres |
| `PORT` | `3000` | Puerto (solo servidor local/Docker) |
| `EXCHANGE_API_URL` | `https://api.exchangerate-api.com/v4/latest/USD` | API de tasas de cambio |
| `EXCHANGE_API_TIMEOUT_MS` | `4000` | Timeout de la API externa |
| `PROFIT_MARGIN_PERCENTAGE` | `40` | Margen de ganancia |
| `DEFAULT_EXCHANGE_RATE` | `1` | Tasa si la API falla y la moneda no tiene respaldo |

## Tests

```bash
npm test          # 21 tests (usa Postgres en memoria, no requiere base real)
npm run typecheck
```

## Endpoints

| Método | Ruta | Descripción | Éxito |
|---|---|---|---|
| POST | `/books` | Crear libro | 201 |
| GET | `/books?page=1&limit=20` | Listar (paginado) | 200 |
| GET | `/books/{id}` | Obtener por ID | 200 |
| PUT | `/books/{id}` | Actualizar (reemplazo completo) | 200 |
| DELETE | `/books/{id}` | Eliminar | 204 |
| GET | `/books/search?category=Ciencia` | Buscar por categoría (sin distinguir mayúsculas) | 200 |
| GET | `/books/low-stock?threshold=10` | Libros con `stock_quantity < threshold` | 200 |
| POST | `/books/{id}/calculate-price` | Calcular y guardar precio de venta | 200 |
| GET | `/health` | Estado de la API y la BD | 200 |

Errores: `400` validación · `404` no existe · `409` ISBN duplicado · `500` error interno · `503` BD no disponible. Formato:

```json
{ "error": { "code": "BAD_REQUEST", "message": "Invalid data", "details": [{ "field": "cost_usd", "message": "cost_usd must be greater than 0" }] } }
```

### Ejemplos (curl)

```bash
BASE=http://localhost:3000   # o la URL pública

# Crear
curl -X POST $BASE/books -H "Content-Type: application/json" -d '{
  "title": "El Quijote", "author": "Miguel de Cervantes", "isbn": "978-84-376-0494-7",
  "cost_usd": 15.99, "stock_quantity": 25, "category": "Literatura Clásica", "supplier_country": "ES"
}'

# Listar / obtener / buscar / stock bajo
curl "$BASE/books?page=1&limit=10"
curl $BASE/books/1
curl "$BASE/books/search?category=Literatura%20Cl%C3%A1sica"
curl "$BASE/books/low-stock?threshold=30"

# Actualizar (PUT = todos los campos)
curl -X PUT $BASE/books/1 -H "Content-Type: application/json" -d '{
  "title": "El Quijote", "author": "Miguel de Cervantes", "isbn": "978-84-376-0494-7",
  "cost_usd": 15.99, "stock_quantity": 5, "category": "Literatura Clásica", "supplier_country": "ES"
}'

# Calcular precio de venta (moneda según supplier_country; opcional forzar con {"currency":"MXN"})
curl -X POST $BASE/books/1/calculate-price

# Eliminar
curl -X DELETE $BASE/books/1
```

Respuesta de `calculate-price`:

```json
{
  "book_id": 1,
  "cost_usd": 15.99,
  "exchange_rate": 0.889,
  "cost_local": 14.22,
  "margin_percentage": 40,
  "selling_price_local": 19.91,
  "currency": "EUR",
  "rate_source": "api",
  "calculation_timestamp": "2026-10-05T18:50:00.000Z"
}
```

`rate_source` es `"api"` si la tasa vino de la API externa o `"fallback"` si esta falló y se usó la tasa por defecto.

## Postman

En [postman/](postman/): importa `bookstore-inventory-api.postman_collection.json` y el entorno `production.postman_environment.json` (apunta a la URL pública) o `local.postman_environment.json`. Selecciona el entorno y ejecuta la colección en orden (Runner); incluye tests automáticos.

## Estructura

```
api/index.ts        Entrada serverless (Vercel)
src/app.ts          App Express, middlewares y manejo de errores
src/books.ts        Rutas, validación y lógica de libros / precio
src/exchange.ts     Cliente de tasas de cambio + fallback
src/db.ts           Pool de Postgres y esquema
src/server.ts       Arranque local/Docker
tests/              Tests de API y de integración externa
postman/            Colección y entornos
Dockerfile · docker-compose.yml · vercel.json
```

## Despliegue (Vercel + Neon)

1. Importar el repositorio en Vercel (preset **Other**).
2. En *Storage* crear una base **Neon (Postgres)** y conectarla al proyecto, lo que define `DATABASE_URL`.
3. Redesplegar y comprobar `GET /health` → `{"status":"ok","database":"up"}`.
4. La tabla se crea automáticamente en la primera petición a `/books`.
5. Para apuntar Postman a la URL pública: `node postman/build.js https://<tu-proyecto>.vercel.app`.
