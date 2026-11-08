import { openSqlite } from './sqlite.mjs';
import { isDeepStrictEqual } from 'node:util';

export const collections = ['products', 'customers', 'suppliers', 'sales', 'purchases', 'expenses', 'staff', 'movements'];

export async function openDatabase(filename) {
  const sql = openSqlite(filename);
  await sql.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS metadata (id INTEGER PRIMARY KEY CHECK(id = 1), revision INTEGER NOT NULL, settings TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, position INTEGER NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), PRIMARY KEY(kind, id));
    CREATE UNIQUE INDEX IF NOT EXISTS product_sku ON records(lower(json_extract(data, '$.sku'))) WHERE kind = 'products';
    CREATE UNIQUE INDEX IF NOT EXISTS product_barcode ON records(json_extract(data, '$.barcode')) WHERE kind = 'products';
    CREATE UNIQUE INDEX IF NOT EXISTS sale_invoice ON records(json_extract(data, '$.invoice')) WHERE kind = 'sales';
    CREATE UNIQUE INDEX IF NOT EXISTS staff_email ON records(lower(json_extract(data, '$.email'))) WHERE kind = 'staff';
    CREATE INDEX IF NOT EXISTS products_category ON records(json_extract(data, '$.category')) WHERE kind = 'products';
    CREATE TABLE IF NOT EXISTS credentials (staff_id TEXT PRIMARY KEY, password_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, staff_id TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS requests (actor TEXT NOT NULL, key TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(actor, key));
    CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, revision INTEGER NOT NULL, created_at TEXT NOT NULL);
  `);
  return createStore(sql);
}

export function createStore(sql) {
  const recordQuery = sql.prepare('SELECT kind, data FROM records ORDER BY kind, position');
  async function read() {
    return sql.atomic(async () => {
    const meta = await sql.prepare('SELECT * FROM metadata WHERE id=1').get();
    if (!meta) return null;
    const db = { version: 1, revision: meta.revision, settings: JSON.parse(meta.settings) };
    for (const kind of collections) db[kind] = [];
    for (const row of await recordQuery.all()) db[row.kind].push(JSON.parse(row.data));
    return db;
    });
  }
  async function write(db) {
    const existing = new Map((await sql.prepare('SELECT kind,id,position,data FROM records').all()).map(row => [`${row.kind}:${row.id}`, row]));
    const changed = [];
    for (const kind of collections) {
      for (const [position, record] of db[kind].entries()) {
        const key = `${kind}:${record.id}`, data = JSON.stringify(record), old = existing.get(key);
        const same = old && (old.data === data || (sql.dialect === 'postgres' && isDeepStrictEqual(JSON.parse(old.data), record)));
        if (!same || old.position !== position) changed.push([kind, record.id, position, data]);
        existing.delete(key);
      }
    }
    // Batch writes keep initial registration/import from making one remote
    // round trip per SKU. JSONB key ordering does not cause unchanged rewrites.
    for (let start = 0; start < changed.length; start += 100) {
      const batch = changed.slice(start, start + 100);
      await sql.prepare('INSERT INTO records(kind,id,position,data) VALUES' + batch.map(() => '(?,?,?,?)').join(',') + ' ON CONFLICT(kind,id) DO UPDATE SET position=excluded.position, data=excluded.data').run(...batch.flat());
    }
    const removed = [...existing.values()];
    for (let start = 0; start < removed.length; start += 100) {
      const batch = removed.slice(start, start + 100);
      await sql.prepare('DELETE FROM records WHERE ' + batch.map(() => '(kind=? AND id=?)').join(' OR ')).run(...batch.flatMap(row => [row.kind, row.id]));
    }
    await sql.prepare('INSERT INTO metadata(id,revision,settings) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision, settings=excluded.settings').run(db.revision, JSON.stringify(db.settings));
  }
  const atomic = operation => sql.atomic(operation);
  async function listProducts(query) {
    return sql.atomic(async () => {
    const pg = sql.dialect === 'postgres';
    const field = name => pg ? `(data->>'${name}')` : `json_extract(data,'$.${name}')`;
    const number = name => pg ? `(${field(name)})::numeric` : field(name);
    const where = ["kind = 'products'"], args = [];
    if (query.search) {
      const text = ['name', 'sku', 'barcode', 'size', 'colour'].map(field).join(" || ' ' || ");
      where.push(pg ? `strpos(lower(${text}), ?) > 0` : `instr(lower(${text}), ?) > 0`);
      args.push(query.search.toLowerCase().trim());
    }
    for (const name of ['category', 'brand']) if (query[name]) { where.push(`${field(name)} = ?`); args.push(query[name]); }
    if (query.stock === 'Low stock') where.push(`${number('quantity')} <= ${number('minStock')}`);
    else if (query.stock === 'Out of stock') where.push(`${number('quantity')} = 0`);
    else if (query.stock === 'In stock') where.push(`${number('quantity')} > ${number('minStock')}`);
    const sorts = { name: `lower(${field('name')}), ${field('sku')}`, 'price-asc': `${number('sellingPrice')} ASC`, 'price-desc': `${number('sellingPrice')} DESC`, stock: `${number('quantity')} ASC` };
    const filter = where.join(' AND ');
    const total = (await sql.prepare(`SELECT count(*) AS total FROM records WHERE ${filter}`).get(...args)).total;
    const pageSize = Math.min(100, Math.max(1, Math.floor(Number(query.pageSize) || 12)));
    const page = Math.min(Math.max(1, Math.ceil(total / pageSize)), Math.max(1, Math.floor(Number(query.page) || 1)));
    const items = (await sql.prepare(`SELECT data FROM records WHERE ${filter} ORDER BY ${sorts[query.sort] || sorts.name} LIMIT ? OFFSET ?`).all(...args, pageSize, (page - 1) * pageSize)).map(row => JSON.parse(row.data));
    return { items, total, page, pageSize };
    });
  }
  return { sql, read, write, atomic, listProducts, close: () => sql.close() };
}
