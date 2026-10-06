# 📚 Bookstore Inventory API

API REST para gestionar el inventario de una cadena de librerías y **calcular el precio de venta sugerido** de cada libro a partir de la tasa de cambio USD → moneda local en tiempo real.

Desarrollada como prueba técnica (FullStack Developer, enfoque Backend) para Nextep Innovation.

| | |
|---|---|
| 🌐 **API en producción** | <https://bookstore-inventory-api-iota.vercel.app> |
| ❤️ **Health check** | <https://bookstore-inventory-api-iota.vercel.app/health> |
| 📦 **Repositorio** | <https://github.com/franciscoghp/bookstore-inventory-api> |
| 🧪 **Colección Postman** | [`postman/`](postman/) (apunta a producción) |

**Stack:** Node.js 20 · TypeScript · Express 5 · PostgreSQL · Zod · Docker · Vercel + Neon · Vitest/Supertest

---

## Tabla de contenidos

1. [Características](#-características)
2. [Probar la API en producción](#-probar-la-api-en-producción)
3. [Arquitectura](#-arquitectura)
4. [Inicio rápido](#-inicio-rápido)
5. [Variables de entorno](#-variables-de-entorno)
6. [Referencia de endpoints](#-referencia-de-endpoints)
7. [Cálculo del precio de venta](#-cálculo-del-precio-de-venta)
8. [Reglas de negocio y manejo de errores](#-reglas-de-negocio-y-manejo-de-errores)
9. [Pruebas](#-pruebas)
10. [Postman](#-postman)
11. [Despliegue](#-despliegue)
12. [Estructura del proyecto](#-estructura-del-proyecto)
13. [Decisiones de diseño](#-decisiones-de-diseño)

---

## ✨ Características

- **CRUD completo** de libros con paginación, búsqueda por categoría y consulta de stock bajo.
- **Integración externa:** `POST /books/{id}/calculate-price` consulta [exchangerate-api.com](https://api.exchangerate-api.com/v4/latest/USD), aplica el margen de ganancia (40 %) y guarda el precio calculado.
- **Resiliente:** si la API de cambio falla (red, timeout, HTTP ≠ 200, moneda inexistente), responde igualmente con una **tasa por defecto** e indica `rate_source: "fallback"`.
- **Validación en dos capas:** esquemas Zod en la API y restricciones (`CHECK`, `UNIQUE`) en la base de datos.
- **ISBN sin duplicados** aunque cambie el formato (`978-84-376-0494-7` = `9788437604947`).
- **Errores consistentes:** formato JSON único con códigos 400, 404, 409, 500 y 503.
- **Configuración 100 % por variables de entorno**, sin valores escondidos en el código: si falta una, la app no arranca y dice cuál.
- **Dockerizada** (API + PostgreSQL con un solo comando) y **desplegada en la nube** (Vercel + Neon).
- **21 pruebas automatizadas**, sin necesidad de base de datos real.

---

## 🚀 Probar la API en producción

No necesitas instalar nada. Usa la [colección de Postman](#-postman) o `curl`:

```bash
BASE=https://bookstore-inventory-api-iota.vercel.app

curl $BASE/health
# {"status":"ok","database":"up"}

# Crear un libro
curl -X POST $BASE/books -H "Content-Type: application/json" -d '{
  "title": "El Quijote",
  "author": "Miguel de Cervantes",
  "isbn": "978-84-376-0494-7",
  "cost_usd": 15.99,
  "stock_quantity": 25,
  "category": "Literatura Clásica",
  "supplier_country": "ES"
}'

# Calcular su precio de venta sugerido (usa el id devuelto arriba)
curl -X POST $BASE/books/1/calculate-price
```

> La base de datos de producción es compartida. Si ya existe un libro con el mismo ISBN, la API responde `409`; es el comportamiento esperado de la regla de duplicados.

---

## 🏗 Arquitectura

```mermaid
flowchart LR
    C[Cliente<br/>Postman / curl] -->|HTTPS · JSON| A[API Express<br/>Vercel serverless / Docker]
    A -->|SQL parametrizado| D[(PostgreSQL<br/>Neon / contenedor)]
    A -.->|solo en calculate-price| X[exchangerate-api.com]
    X -.->|tasa USD→moneda| A
```

- **Una sola app Express** (`src/app.ts`) con dos puertas de entrada: `src/server.ts` (Docker/local, escucha un puerto) y `api/index.ts` (Vercel, función serverless). Mismo código en ambos entornos.
- **PostgreSQL con `pg` directo** (sin ORM): un solo modelo, consultas parametrizadas y arranque rápido en serverless.
- **Esquema automático:** la primera petición a `/books` ejecuta `CREATE TABLE IF NOT EXISTS`; no hay pasos manuales de migración.

---

## ⚡ Inicio rápido

### Requisitos previos

| Opción | Necesitas |
|---|---|
| 🐳 **Docker** (recomendado) | Docker Desktop (o Docker Engine + Compose) |
| 💻 **Local sin Docker** | Node.js ≥ 20 y una base PostgreSQL accesible |

### Opción A · Docker (un solo comando)

```bash
git clone https://github.com/franciscoghp/bookstore-inventory-api.git
cd bookstore-inventory-api
docker compose up --build
```

Levanta PostgreSQL 16 y la API en <http://localhost:3000> (todas las variables ya están definidas en `docker-compose.yml`). Comprueba: <http://localhost:3000/health>.

Para detener: `Ctrl+C` y luego `docker compose down` (añade `-v` para borrar también los datos).

### Opción B · Node.js local

```bash
npm install
cp .env.example .env     # ajusta DATABASE_URL a tu Postgres
npm run dev              # http://localhost:3000, con recarga automática
```

Producción local: `npm run build:server && npm start`.

### Opción C · Probar sin instalar PostgreSQL

```bash
npm install
cp .env.example .env
npm run dev:mem
```

Usa una base **en memoria** (los datos se pierden al detenerla). Es solo para pruebas locales rápidas.

---

## 🔐 Variables de entorno

Todas son **obligatorias**. No hay valores por defecto en el código: si falta o es inválida una variable, la aplicación no arranca y muestra un mensaje claro (por ejemplo `Missing required environment variable: EXCHANGE_API_URL`). Plantilla en [`.env.example`](.env.example).

| Variable | Ejemplo | Descripción |
|---|---|---|
| `DATABASE_URL` | `postgres://user:pass@host:5432/db` | Cadena de conexión a PostgreSQL |
| `PORT` | `3000` | Puerto del servidor (solo local/Docker; Vercel no la usa) |
| `EXCHANGE_API_URL` | `https://api.exchangerate-api.com/v4/latest/USD` | API de tasas de cambio |
| `EXCHANGE_API_TIMEOUT_MS` | `4000` | Tiempo máximo de espera de la API externa (ms) |
| `PROFIT_MARGIN_PERCENTAGE` | `40` | Margen de ganancia (%) |
| `DEFAULT_EXCHANGE_RATE` | `1` | Tasa USD→local usada si la API falla y la moneda no tiene respaldo propio |

---

## 📖 Referencia de endpoints

| Método | Ruta | Descripción | Éxito |
|---|---|---|---|
| `POST` | `/books` | Crear libro | `201` |
| `GET` | `/books?page=1&limit=20` | Listar con paginación | `200` |
| `GET` | `/books/{id}` | Obtener libro por ID | `200` |
| `PUT` | `/books/{id}` | Actualizar libro (reemplazo completo) | `200` |
| `DELETE` | `/books/{id}` | Eliminar libro | `204` |
| `GET` | `/books/search?category={category}` | Buscar por categoría (sin distinguir mayúsculas) | `200` |
| `GET` | `/books/low-stock?threshold=10` | Libros con `stock_quantity` menor que el umbral | `200` |
| `POST` | `/books/{id}/calculate-price` | Calcular y guardar el precio de venta sugerido | `200` |
| `GET` | `/health` | Estado de la API y de la base de datos | `200` |

### Modelo `Book`

| Campo | Tipo | Notas |
|---|---|---|
| `id` | entero | Generado automáticamente |
| `title` | string | Obligatorio, máx. 255 |
| `author` | string | Obligatorio, máx. 255 |
| `isbn` | string | Obligatorio. 10 o 13 dígitos (guiones opcionales; ISBN-10 puede terminar en `X`). **Único** |
| `cost_usd` | número | Obligatorio, **> 0** |
| `selling_price_local` | número \| null | Solo lectura: lo calcula `calculate-price` |
| `stock_quantity` | entero | **≥ 0**. Por defecto `0` al crear |
| `category` | string \| null | Opcional |
| `supplier_country` | string \| null | Opcional. Código ISO de 2 letras (`ES`, `MX`, `CO`…). Determina la moneda |
| `created_at`, `updated_at` | ISO 8601 | Generados automáticamente |

### Ejemplos

<details>
<summary><b>POST /books</b> — crear libro</summary>

```bash
curl -X POST $BASE/books -H "Content-Type: application/json" -d '{
  "title": "El Quijote",
  "author": "Miguel de Cervantes",
  "isbn": "978-84-376-0494-7",
  "cost_usd": 15.99,
  "stock_quantity": 25,
  "category": "Literatura Clásica",
  "supplier_country": "ES"
}'
```

`201 Created`
```json
{
  "id": 1,
  "title": "El Quijote",
  "author": "Miguel de Cervantes",
  "isbn": "978-84-376-0494-7",
  "cost_usd": 15.99,
  "selling_price_local": null,
  "stock_quantity": 25,
  "category": "Literatura Clásica",
  "supplier_country": "ES",
  "created_at": "2026-10-06T02:49:33.256Z",
  "updated_at": "2026-10-06T02:49:33.256Z"
}
```
</details>

<details>
<summary><b>GET /books</b> — listar con paginación</summary>

```bash
curl "$BASE/books?page=1&limit=10"
```

`200 OK` (`limit` máximo 100, por defecto 20)
```json
{
  "data": [ { "id": 1, "title": "El Quijote", "...": "..." } ],
  "pagination": { "page": 1, "limit": 10, "total": 1, "total_pages": 1 }
}
```
Los endpoints `search` y `low-stock` devuelven este mismo formato.
</details>

<details>
<summary><b>GET /books/{id}</b> · <b>PUT /books/{id}</b> · <b>DELETE /books/{id}</b></summary>

```bash
curl $BASE/books/1

# PUT reemplaza todos los campos (excepto selling_price_local)
curl -X PUT $BASE/books/1 -H "Content-Type: application/json" -d '{
  "title": "El Quijote",
  "author": "Miguel de Cervantes",
  "isbn": "978-84-376-0494-7",
  "cost_usd": 15.99,
  "stock_quantity": 5,
  "category": "Literatura Clásica",
  "supplier_country": "ES"
}'

curl -X DELETE $BASE/books/1        # 204 sin cuerpo
```
</details>

<details>
<summary><b>GET /books/search</b> · <b>GET /books/low-stock</b></summary>

```bash
curl "$BASE/books/search?category=Literatura%20Cl%C3%A1sica"
curl "$BASE/books/low-stock?threshold=30"     # stock_quantity < 30, de menor a mayor
```
</details>

<details open>
<summary><b>POST /books/{id}/calculate-price</b> — precio de venta sugerido</summary>

```bash
curl -X POST $BASE/books/1/calculate-price

# Opcional: forzar la moneda en lugar de usar la del país del proveedor
curl -X POST $BASE/books/1/calculate-price -H "Content-Type: application/json" -d '{"currency":"MXN"}'
```

`200 OK`
```json
{
  "book_id": 1,
  "cost_usd": 15.99,
  "exchange_rate": 0.892,
  "cost_local": 14.26,
  "margin_percentage": 40,
  "selling_price_local": 19.96,
  "currency": "EUR",
  "rate_source": "api",
  "calculation_timestamp": "2026-10-06T02:49:38.044Z"
}
```
La tasa cambia cada día; los valores de arriba son solo un ejemplo.
</details>

---

## 💱 Cálculo del precio de venta

1. Lee el libro (`404` si no existe) y toma su `cost_usd`.
2. Determina la **moneda local**: la del `supplier_country` (`ES` → `EUR`, `MX` → `MXN`, `CO` → `COP`, `VE` → `VES`…). Si no hay país o no está mapeado, usa `USD`. También se puede forzar con `{"currency": "XXX"}` en el body.
3. Obtiene la tasa USD → moneda de la API externa (con *timeout*).
4. Calcula, redondeando a 2 decimales:
   - `cost_local = cost_usd × exchange_rate`
   - `selling_price_local = cost_local × (1 + margen / 100)`
5. **Guarda** `selling_price_local` en la base de datos y devuelve el detalle.

**Ejemplo del enunciado:** `15.99 × 0.85 = 13.59` → `13.59 × 1.40 = 19.03` (cubierto por un test).

**Tolerancia a fallos:** si la API de cambio no responde, tarda más del timeout, devuelve un error HTTP o no incluye la moneda pedida, el endpoint **no falla**: usa una tasa de respaldo (tabla interna por moneda o `DEFAULT_EXCHANGE_RATE`) y lo indica con `"rate_source": "fallback"`.

---

## 🛡 Reglas de negocio y manejo de errores

| Regla | Respuesta |
|---|---|
| `cost_usd` debe ser mayor a 0 | `400` |
| `stock_quantity` no puede ser negativo | `400` |
| `isbn` debe tener 10 o 13 dígitos | `400` |
| No se permiten libros con el mismo ISBN | `409` |
| Libro inexistente | `404` |
| Id no numérico, JSON mal formado, `supplier_country` inválido | `400` |
| Base de datos no disponible | `503` |
| Error inesperado (se registra en logs, no se expone al cliente) | `500` |
| API de cambio caída al calcular precio | `200` con `rate_source: "fallback"` |

Todos los errores comparten el mismo formato:

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Invalid data",
    "details": [
      { "field": "cost_usd", "message": "cost_usd must be greater than 0" }
    ]
  }
}
```

Códigos internos: `BAD_REQUEST`, `NOT_FOUND`, `CONFLICT`, `SERVICE_UNAVAILABLE`, `INTERNAL_ERROR`.

---

## 🧪 Pruebas

```bash
npm test             # 21 pruebas
npm run typecheck    # verificación de tipos
```

Usan Vitest + Supertest sobre PostgreSQL en memoria ([`pg-mem`](https://github.com/oguimbal/pg-mem)) y simulan la API de cambio, así que no requieren base de datos ni internet. Cubren: CRUD, paginación, búsqueda, stock bajo, todas las reglas de negocio, duplicados con distinto formato de ISBN, errores 400/404/409/503, el cálculo exacto del ejemplo (`19.03`) y el *fallback* de la API externa (error de red, HTTP 500 y moneda ausente).

---

## 📮 Postman

En la carpeta [`postman/`](postman/):

| Archivo | Uso |
|---|---|
| `bookstore-inventory-api.postman_collection.json` | Colección con todos los endpoints y tests automáticos |
| `production.postman_environment.json` | Entorno **Producción** (`baseUrl` = URL pública) |
| `local.postman_environment.json` | Entorno **Local** (`http://localhost:3000`) |

**Cómo usarla**
1. En Postman: **Import** → selecciona los tres archivos.
2. Elige el entorno **Bookstore - Producción** (arriba a la derecha).
3. Ejecuta la colección completa con **Run** (o petición por petición, en orden). La variable `bookId` se rellena sola.
4. Revisa la pestaña *Test Results*: cada petición valida su código de respuesta y el contenido.

La colección incluye una carpeta *Errores esperados* (400, 404, 409) y termina eliminando el libro creado, para dejar la base limpia.

> Si una ejecución anterior se interrumpió y el libro de prueba sigue existiendo, "Crear libro" devolverá `409`; la petición *Buscar por categoría* recupera su id automáticamente y el resto del flujo continúa.

---

## ☁️ Despliegue

| Pieza | Servicio |
|---|---|
| API | **Vercel** (función serverless a partir de `api/index.ts`; `vercel.json` reescribe todas las rutas hacia ella) |
| Base de datos | **Neon** (PostgreSQL gestionado, integración de Vercel Storage) |

Para replicarlo:

1. Importar el repositorio en Vercel (preset **Other**).
2. Definir en *Settings → Environment Variables* las variables de [`.env.example`](.env.example) (`PORT` no hace falta en Vercel).
3. En *Storage*, crear una base **Neon** y conectarla al proyecto con el prefijo `DATABASE` (define `DATABASE_URL`).
4. Redesplegar y comprobar `GET /health` → `{"status":"ok","database":"up"}`.
5. Para regenerar Postman con otra URL: `node postman/build.js https://<tu-proyecto>.vercel.app`.

El `Dockerfile` (multi-stage, usuario no root y *healthcheck*) permite desplegar la misma API en cualquier plataforma de contenedores.

---

## 🗂 Estructura del proyecto

```
.
├── api/index.ts           # Entrada serverless (Vercel)
├── src/
│   ├── app.ts             # App Express: middlewares, health, manejo central de errores
│   ├── books.ts           # Rutas, validación (Zod) y lógica de libros y precio
│   ├── exchange.ts        # Cliente de tasas de cambio + tasas de respaldo
│   ├── db.ts              # Pool de PostgreSQL y esquema
│   ├── config.ts          # Lectura y validación de variables de entorno
│   ├── errors.ts          # Errores HTTP tipados
│   ├── server.ts          # Arranque local / Docker
│   └── server-mem.ts      # Arranque local con BD en memoria (solo pruebas)
├── tests/                 # Pruebas de API y de integración externa
├── postman/               # Colección y entornos (+ build.js que los genera)
├── Dockerfile
├── docker-compose.yml     # API + PostgreSQL
├── vercel.json
└── .env.example
```

---

## 🧠 Decisiones de diseño

- **Dinero con `NUMERIC`, no `FLOAT`:** evita errores de redondeo en centavos.
- **Doble validación:** Zod devuelve mensajes claros; los `CHECK`/`UNIQUE` de PostgreSQL garantizan integridad aunque otro proceso escriba en la base.
- **Duplicados resueltos por la base:** una columna `isbn_normalized UNIQUE` (solo dígitos) evita condiciones de carrera y detecta el mismo ISBN con distinto formato.
- **Transparencia ante fallos externos:** el *fallback* no oculta el problema; `rate_source` permite saber si la tasa es en vivo.
- **`PUT` = reemplazo completo**, según la semántica REST; `selling_price_local` es derivado y por eso no se acepta como entrada.
- **Sin ORM** para un solo modelo: menos dependencias y arranque más rápido en serverless; todas las consultas están parametrizadas.

### Posibles mejoras

Caché de la tasa de cambio (por ejemplo 1 hora), autenticación (API key/JWT), documentación OpenAPI/Swagger, migraciones versionadas, validación del dígito verificador del ISBN, *rate limiting* y pruebas de integración contra PostgreSQL real en CI.
