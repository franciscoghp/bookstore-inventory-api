# Guía para entender (y defender) la prueba

Pensada para leerla de arriba abajo. Al final sabrás qué piden, cómo está resuelto, cómo probarlo y qué responder si te preguntan en la entrevista.

---

## 1. De qué trata la prueba, en una frase

> Una librería importa libros pagándolos en dólares. Necesita una **API** (un programa al que otros programas le piden cosas por internet) que guarde su inventario y que, dado el costo en USD de un libro, le diga **a cuánto venderlo en moneda local**, usando la tasa de cambio de hoy y un 40 % de ganancia.

Una **API REST** es un conjunto de "direcciones" (URLs) + "verbos" (GET = leer, POST = crear, PUT = actualizar, DELETE = borrar). Ejemplo: `GET /books/1` significa "dame el libro 1". Quien consume la API (Postman, una app, un evaluador) manda la petición y recibe JSON.

## 2. Las piezas y cómo conversan

```
 Postman / curl / evaluador
          │  HTTP (JSON)
          ▼
   ┌─────────────────┐        ┌──────────────────────────┐
   │  Tu API         │ ─────► │ api.exchangerate-api.com │  (solo al calcular precio)
   │ Node + Express  │ ◄───── │ "1 USD = 0.889 EUR"      │
   └────────┬────────┘        └──────────────────────────┘
            │ SQL
            ▼
   ┌─────────────────┐
   │ PostgreSQL      │  (la tabla "books"; en producción vive en Neon, en la nube)
   └─────────────────┘
```

- **Node.js**: ejecuta JavaScript fuera del navegador. **TypeScript**: JavaScript con tipos (atrapa errores antes de correr).
- **Express**: librería para definir rutas ("cuando llegue `GET /books`, ejecuta esto").
- **PostgreSQL**: base de datos donde se guardan los libros. Obligatoria en la nube (la prueba prohíbe SQLite en producción).
- **Docker**: empaqueta la app con todo lo que necesita para que corra igual en cualquier computador.
- **Vercel**: donde se publica para que cualquiera la use por internet. **Neon**: la base de datos en la nube.
- **Postman**: programa para probar APIs con clics en vez de escribir comandos.

## 3. Mapa del código (qué hace cada archivo)

| Archivo | Para qué sirve |
|---|---|
| `src/server.ts` | Arranca el servidor en un puerto (local/Docker). |
| `api/index.ts` | Lo mismo pero para Vercel (no "escucha" un puerto; Vercel lo invoca). |
| `src/app.ts` | Arma la app: JSON, `/health`, crea la tabla si falta, conecta las rutas y **convierte cualquier error en una respuesta JSON limpia** (400/404/409/500/503). |
| `src/books.ts` | **El corazón.** Las rutas de libros, las validaciones y el cálculo de precio. |
| `src/exchange.ts` | Llama a la API de tasas de cambio. Si falla, usa una tasa de respaldo. |
| `src/db.ts` | Conexión a Postgres y definición de la tabla `books`. |
| `src/config.ts` | Lee variables de entorno (`DATABASE_URL`, margen, etc.). |
| `src/errors.ts` | Errores con código HTTP (`notFound`, `badRequest`...). |
| `tests/` | Pruebas automáticas (21). |
| `Dockerfile`, `docker-compose.yml` | Contenerización. |
| `vercel.json` | Le dice a Vercel que mande todas las rutas a `api/index.ts`. |
| `postman/` | Colección y entornos para el evaluador. |

## 4. Cómo viaja una petición (ejemplo: crear un libro)

`POST /books` con el JSON del libro:

1. Express recibe la petición y lee el JSON.
2. `app.ts` se asegura de que la tabla exista.
3. `books.ts` **valida** con Zod: ¿`cost_usd > 0`? ¿stock ≥ 0? ¿ISBN de 10 o 13 dígitos? Si algo falla → responde **400** y explica qué campo.
4. Inserta en Postgres. El ISBN se guarda también "normalizado" (sin guiones) en una columna **UNIQUE**; si ya existía, Postgres rechaza y la API responde **409** (así `978-84-376-0494-7` y `9788437604947` cuentan como el mismo libro).
5. Responde **201** con el libro creado.

## 5. El cálculo de precio, paso a paso

`POST /books/1/calculate-price`:

1. Busca el libro (si no existe → **404**). Ej.: `cost_usd = 15.99`, `supplier_country = ES`.
2. País → moneda: ES → **EUR**.
3. Pide a la API externa las tasas USD y toma la de EUR. Ej.: `0.889` (cambia cada día; el enunciado usaba 0.85 solo de ejemplo).
4. `cost_local = 15.99 × 0.889 = 14.22`
5. `selling_price_local = 14.22 × 1.40 = 19.91` (margen 40 %)
6. Guarda ese precio en la tabla y responde con todo el detalle.

**Si la API de cambio falla** (sin internet, lenta, error), no se cae: usa una tasa fija de respaldo y avisa con `"rate_source": "fallback"`. Esa es la regla "si la API falla, usar tasa por defecto".

## 6. Cómo probarlo tú, sin instalar nada raro

Ya tienes Node instalado. Desde la carpeta del proyecto (`C:\Users\franc\bookstore-inventory-api`):

### Opción A — Tests automáticos (lo más rápido)
```powershell
npm test
```
Verás 21 pruebas en verde. Cada una es una regla de la prueba (duplicados, stock negativo, fallback, 19.03...). Léelas en `tests/api.test.ts`: son la mejor "documentación viva".

### Opción B — Servidor local con base en memoria (para jugar con Postman)
```powershell
npm run dev:mem
```
Queda en `http://localhost:3000`. No necesita Postgres: usa una base temporal que se borra al detenerlo (Ctrl+C). Luego:

1. Abre Postman → **Import** → arrastra `postman/bookstore-inventory-api.postman_collection.json` y `postman/local.postman_environment.json`.
2. Arriba a la derecha elige el entorno **Bookstore - Local**.
3. Ejecuta las peticiones **en orden** (o clic derecho en la colección → *Run*). Cada una trae tests automáticos (pestaña *Test Results*).
4. Prueba romper cosas: manda `cost_usd: 0`, un ISBN `123`, el mismo libro dos veces, un id `999`. Mira los códigos 400/409/404.
5. Para ver el **fallback**: corta el internet (o pon `EXCHANGE_API_URL=http://localhost:9` en `.env`) y ejecuta *Calcular precio*: sigue respondiendo 200 pero con `rate_source: "fallback"`.

### Opción C — Con Postgres real (como en producción)
Necesitas Docker Desktop: `docker compose up --build`. No lo tienes instalado; no es necesario para entender ni para entregar (Vercel + Neon hacen ese papel).

## 7. Qué significan los códigos de respuesta

| Código | Significado | Cuándo en esta API |
|---|---|---|
| 200 / 201 / 204 | OK / creado / borrado sin contenido | operaciones exitosas |
| 400 | La petición está mal | validaciones |
| 404 | No existe | id inexistente |
| 409 | Conflicto | ISBN duplicado |
| 500 | Falló el servidor | error inesperado |
| 503 | Servicio no disponible | base de datos caída |

## 8. Decisiones que puedes defender en la entrevista

- **¿Por qué Express y no Django?** La prueba permite elegir; Node/TS me permitió desplegar fácil en Vercel. *(Sé honesto: Django era la preferencia, esto es una alternativa válida.)*
- **¿Por qué `pg` sin ORM?** Una sola tabla; menos peso y arranque más rápido en serverless; SQL parametrizado evita inyección SQL.
- **¿Por qué validar en código y también en la BD?** Doble barrera: el código da mensajes claros; la BD garantiza que ningún camino (script, otro servicio) meta datos inválidos.
- **¿Por qué NUMERIC y no float para dinero?** Los flotantes binarios dan errores de centavos.
- **¿Por qué ISBN normalizado y UNIQUE?** Evita duplicados aunque cambie el formato, y sin condiciones de carrera (lo hace la BD, no un "if" previo).
- **¿Y si la API de cambio se cae?** Fallback + `rate_source` para transparencia; timeout de 4 s para no colgar al cliente.
- **¿Qué mejorarías?** Cachear la tasa de cambio (por hora), autenticación, Swagger, migraciones versionadas, validar el dígito verificador del ISBN, rate limiting.
- **Limitación honesta:** los tests usan Postgres en memoria (`pg-mem`); en un proyecto real añadiría tests contra Postgres real en CI.

## 9. Qué falta para entregar

1. Probar (sección 6).
2. Subir a GitHub.
3. Desplegar en Vercel + Neon (guía en `DOCUMENTACION.md`, sección 7).
4. Poner la URL pública en Postman y README.
5. Responder el correo con: repo, URL desplegada y colección de Postman. **Fecha límite: miércoles 7 de octubre.**
