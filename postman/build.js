// Genera la colección y los entornos de Postman:  node postman/build.js [URL_PUBLICA]
const fs = require('fs');
const path = require('path');

const PROD_URL = process.argv[2] || 'https://REEMPLAZA-CON-TU-URL.vercel.app';
const body = (o) => ({ mode: 'raw', raw: JSON.stringify(o, null, 2), options: { raw: { language: 'json' } } });
const json = [{ key: 'Content-Type', value: 'application/json' }];

const quijote = {
  title: 'El Quijote',
  author: 'Miguel de Cervantes',
  isbn: '978-84-376-0494-7',
  cost_usd: 15.99,
  stock_quantity: 25,
  category: 'Literatura Clásica',
  supplier_country: 'ES',
};

const tests = (...lines) => [{ listen: 'test', script: { type: 'text/javascript', exec: lines } }];
const status = (code) => `pm.test('Status ${code}', () => pm.response.to.have.status(${code}));`;

function req(name, method, url, { b, t = [], desc } = {}) {
  const [p, qs] = url.split('?');
  return {
    name,
    event: t.length ? tests(...t) : undefined,
    request: {
      method,
      header: b ? json : [],
      body: b ? body(b) : undefined,
      description: desc,
      url: {
        raw: `{{baseUrl}}${url}`,
        host: ['{{baseUrl}}'],
        path: p.split('/').filter(Boolean),
        query: qs ? qs.split('&').map((kv) => ({ key: kv.split('=')[0], value: kv.split('=')[1] })) : undefined,
      },
    },
  };
}

const collection = {
  info: {
    name: 'Bookstore Inventory API',
    description:
      'Colección para la prueba técnica de Nextep. Cambia la variable `baseUrl` (entorno) entre producción y local. Ejecuta las peticiones en orden (carpeta "Flujo completo" o el Runner).',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  variable: [
    { key: 'baseUrl', value: PROD_URL },
    { key: 'bookId', value: '' },
  ],
  item: [
    {
      name: 'Salud',
      item: [
        req('Health check', 'GET', '/health', { t: [status(200), "pm.test('db up', () => pm.expect(pm.response.json().database).to.eql('up'));"] }),
      ],
    },
    {
      name: 'CRUD',
      item: [
        req('1. Crear libro', 'POST', '/books', {
          b: quijote,
          desc: 'Devuelve 201. Si el ISBN ya existe responde 409 (reglas de negocio); en ese caso usa "2b. Buscar el libro por categoría" para obtener su id.',
          t: [
            "pm.test('201 creado (o 409 si ya existía)', () => pm.expect([201, 409]).to.include(pm.response.code));",
            "if (pm.response.code === 201) pm.collectionVariables.set('bookId', pm.response.json().id);",
          ],
        }),
        req('2. Listar libros (paginado)', 'GET', '/books?page=1&limit=10', {
          t: [status(200), "pm.test('trae data y pagination', () => { const j = pm.response.json(); pm.expect(j.data).to.be.an('array'); pm.expect(j.pagination).to.have.property('total'); });"],
        }),
        req('2b. Buscar por categoría', 'GET', '/books/search?category=Literatura Clásica', {
          t: [status(200), "const d = pm.response.json().data; if (d.length && !pm.collectionVariables.get('bookId')) pm.collectionVariables.set('bookId', d[0].id);"],
        }),
        req('2c. Stock bajo', 'GET', '/books/low-stock?threshold=30', { t: [status(200)] }),
        req('3. Obtener libro por ID', 'GET', '/books/{{bookId}}', {
          t: [status(200), "pm.test('id coincide', () => pm.expect(String(pm.response.json().id)).to.eql(pm.collectionVariables.get('bookId')));"],
        }),
        req('4. Actualizar libro (PUT)', 'PUT', '/books/{{bookId}}', {
          b: { ...quijote, stock_quantity: 5 },
          t: [status(200), "pm.test('stock actualizado', () => pm.expect(pm.response.json().stock_quantity).to.eql(5));"],
        }),
      ],
    },
    {
      name: 'Precio (integración externa)',
      item: [
        req('5. Calcular precio de venta', 'POST', '/books/{{bookId}}/calculate-price', {
          desc: 'Obtiene la tasa USD→moneda local, aplica 40% de margen y guarda selling_price_local.',
          t: [
            status(200),
            "const j = pm.response.json();",
            "pm.test('campos del cálculo', () => pm.expect(j).to.include.keys('book_id','cost_usd','exchange_rate','cost_local','margin_percentage','selling_price_local','currency','calculation_timestamp'));",
            "pm.test('margen 40%', () => pm.expect(j.selling_price_local).to.be.closeTo(j.cost_local * 1.4, 0.011));",
          ],
        }),
        req('5b. Calcular precio forzando moneda (MXN)', 'POST', '/books/{{bookId}}/calculate-price', {
          b: { currency: 'MXN' },
          t: [status(200), "pm.test('moneda MXN', () => pm.expect(pm.response.json().currency).to.eql('MXN'));"],
        }),
      ],
    },
    {
      name: 'Errores esperados',
      item: [
        req('400 - cost_usd <= 0', 'POST', '/books', { b: { ...quijote, isbn: '0306406152', cost_usd: 0 }, t: [status(400)] }),
        req('400 - stock negativo', 'POST', '/books', { b: { ...quijote, isbn: '0306406152', stock_quantity: -1 }, t: [status(400)] }),
        req('400 - ISBN inválido', 'POST', '/books', { b: { ...quijote, isbn: '12345' }, t: [status(400)] }),
        req('409 - ISBN duplicado', 'POST', '/books', { b: quijote, t: [status(409)] }),
        req('404 - libro inexistente', 'GET', '/books/999999', { t: [status(404)] }),
        req('404 - calcular precio de libro inexistente', 'POST', '/books/999999/calculate-price', { t: [status(404)] }),
      ],
    },
    {
      name: 'Limpieza',
      item: [
        req('6. Eliminar libro', 'DELETE', '/books/{{bookId}}', {
          t: [status(204), "pm.collectionVariables.set('bookId', '');"],
        }),
      ],
    },
  ],
};

const env = (name, baseUrl) => ({
  id: name.toLowerCase().replace(/\W+/g, '-'),
  name,
  values: [{ key: 'baseUrl', value: baseUrl, type: 'default', enabled: true }],
  _postman_variable_scope: 'environment',
});

const out = (f, o) => fs.writeFileSync(path.join(__dirname, f), JSON.stringify(o, null, 2) + '\n');
out('bookstore-inventory-api.postman_collection.json', collection);
out('production.postman_environment.json', env('Bookstore - Producción', PROD_URL));
out('local.postman_environment.json', env('Bookstore - Local', 'http://localhost:3000'));
console.log('Postman generado con baseUrl de producción =', PROD_URL);
