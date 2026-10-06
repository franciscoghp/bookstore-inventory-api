/** Especificación OpenAPI 3.0 de la API (se sirve en /openapi.json y se muestra en /docs). */

const bookProps = {
  title: { type: 'string', maxLength: 255, example: 'El Quijote' },
  author: { type: 'string', maxLength: 255, example: 'Miguel de Cervantes' },
  isbn: {
    type: 'string',
    description: '10 o 13 dígitos (guiones opcionales; ISBN-10 puede terminar en X). Único.',
    example: '978-84-376-0494-7',
  },
  cost_usd: { type: 'number', exclusiveMinimum: 0, example: 15.99 },
  stock_quantity: { type: 'integer', minimum: 0, example: 25 },
  category: { type: 'string', nullable: true, example: 'Literatura Clásica' },
  supplier_country: {
    type: 'string',
    nullable: true,
    minLength: 2,
    maxLength: 2,
    description: 'Código ISO de 2 letras; determina la moneda local.',
    example: 'ES',
  },
};

const error = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
});

const idParam = {
  name: 'id',
  in: 'path',
  required: true,
  schema: { type: 'integer', minimum: 1 },
};

const pageParams = [
  { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
  { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
];

const bookList = {
  description: 'Lista paginada',
  content: { 'application/json': { schema: { $ref: '#/components/schemas/BookList' } } },
};

const bookResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Book' } } },
});

export const openapi = {
  openapi: '3.0.3',
  info: {
    title: 'Bookstore Inventory API',
    version: '1.0.0',
    description:
      'API REST de inventario de librerías con cálculo del precio de venta sugerido a partir de la tasa de cambio USD → moneda local.',
  },
  servers: [{ url: '/', description: 'Servidor actual' }],
  tags: [{ name: 'Books' }, { name: 'Pricing' }, { name: 'System' }],
  paths: {
    '/books': {
      post: {
        tags: ['Books'],
        summary: 'Crear libro',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/BookInput' } } },
        },
        responses: {
          '201': bookResponse('Libro creado'),
          '400': error('Datos inválidos (cost_usd ≤ 0, stock negativo, ISBN inválido…)'),
          '409': error('Ya existe un libro con ese ISBN'),
        },
      },
      get: {
        tags: ['Books'],
        summary: 'Listar libros (paginado)',
        parameters: pageParams,
        responses: { '200': bookList, '400': error('Parámetros inválidos') },
      },
    },
    '/books/search': {
      get: {
        tags: ['Books'],
        summary: 'Buscar por categoría (sin distinguir mayúsculas)',
        parameters: [
          { name: 'category', in: 'query', required: true, schema: { type: 'string' }, example: 'Literatura Clásica' },
          ...pageParams,
        ],
        responses: { '200': bookList, '400': error('Falta category') },
      },
    },
    '/books/low-stock': {
      get: {
        tags: ['Books'],
        summary: 'Libros con stock menor al umbral',
        parameters: [
          { name: 'threshold', in: 'query', schema: { type: 'integer', minimum: 0, default: 10 } },
          ...pageParams,
        ],
        responses: { '200': bookList, '400': error('Parámetros inválidos') },
      },
    },
    '/books/{id}': {
      get: {
        tags: ['Books'],
        summary: 'Obtener libro por ID',
        parameters: [idParam],
        responses: { '200': bookResponse('Libro'), '400': error('Id inválido'), '404': error('No existe') },
      },
      put: {
        tags: ['Books'],
        summary: 'Actualizar libro (reemplazo completo)',
        parameters: [idParam],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/BookInput' } } },
        },
        responses: {
          '200': bookResponse('Libro actualizado'),
          '400': error('Datos inválidos'),
          '404': error('No existe'),
          '409': error('El ISBN pertenece a otro libro'),
        },
      },
      delete: {
        tags: ['Books'],
        summary: 'Eliminar libro',
        parameters: [idParam],
        responses: { '204': { description: 'Eliminado' }, '404': error('No existe') },
      },
    },
    '/books/{id}/calculate-price': {
      post: {
        tags: ['Pricing'],
        summary: 'Calcular y guardar el precio de venta sugerido',
        description:
          'Toma cost_usd, obtiene la tasa USD → moneda local (caché en BD → API externa → tasa por defecto), aplica el margen y guarda selling_price_local. Si la API de cambio falla, responde igualmente con una tasa de respaldo.',
        parameters: [idParam],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  currency: {
                    type: 'string',
                    minLength: 3,
                    maxLength: 3,
                    description: 'Opcional: fuerza la moneda en lugar de usar la del supplier_country.',
                    example: 'MXN',
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Cálculo detallado',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/PriceCalculation' } } },
          },
          '400': error('Id o moneda inválidos'),
          '404': error('No existe'),
        },
      },
    },
    '/health': {
      get: {
        tags: ['System'],
        summary: 'Estado de la API y la base de datos',
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { status: { type: 'string', example: 'ok' }, database: { type: 'string', example: 'up' } },
                },
              },
            },
          },
          '503': error('Base de datos no disponible'),
        },
      },
    },
  },
  components: {
    schemas: {
      BookInput: {
        type: 'object',
        required: ['title', 'author', 'isbn', 'cost_usd'],
        properties: bookProps,
      },
      Book: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 1 },
          ...bookProps,
          selling_price_local: { type: 'number', nullable: true, description: 'Solo lectura; lo calcula calculate-price.', example: 19.96 },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
      BookList: {
        type: 'object',
        properties: {
          data: { type: 'array', items: { $ref: '#/components/schemas/Book' } },
          pagination: {
            type: 'object',
            properties: {
              page: { type: 'integer' },
              limit: { type: 'integer' },
              total: { type: 'integer' },
              total_pages: { type: 'integer' },
            },
          },
        },
      },
      PriceCalculation: {
        type: 'object',
        properties: {
          book_id: { type: 'integer', example: 1 },
          cost_usd: { type: 'number', example: 15.99 },
          exchange_rate: { type: 'number', example: 0.892 },
          cost_local: { type: 'number', example: 14.26 },
          margin_percentage: { type: 'number', example: 40 },
          selling_price_local: { type: 'number', example: 19.96 },
          currency: { type: 'string', example: 'EUR' },
          rate_source: {
            type: 'string',
            enum: ['api', 'cache', 'fallback'],
            description: 'api = consultada ahora · cache = guardada en BD · fallback = tasa por defecto',
          },
          calculation_timestamp: { type: 'string', format: 'date-time' },
        },
      },
      Error: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              code: { type: 'string', example: 'BAD_REQUEST' },
              message: { type: 'string', example: 'Invalid data' },
              details: { type: 'array', items: { type: 'object' } },
            },
          },
        },
      },
    },
  },
};

/** Página de Swagger UI (carga los assets desde el CDN de jsDelivr). */
export const docsHtml = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Bookstore Inventory API – Docs</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({ url: '/openapi.json', dom_id: '#swagger-ui', deepLinking: true });
  </script>
</body>
</html>`;
