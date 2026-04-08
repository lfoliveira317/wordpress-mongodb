# wordpress-mongodb

Experimental Node.js bridge that pretends to be a small MySQL server for WordPress-flavored clients while resolving a narrow subset of queries against MongoDB.

## What this is

This project is a proof of concept for the question: can Node.js accept a MySQL-compatible connection and translate some WordPress-style SQL into MongoDB operations?

Today the prototype supports:

- MySQL handshake and password validation through `mysql2`'s server API
- Bootstrap-friendly statements such as `SET NAMES`, `SHOW VARIABLES`, `SHOW DATABASES`, `SHOW TABLES`, `DESCRIBE`, `SELECT DATABASE()`, `SELECT VERSION()`, and `SELECT @@SESSION.sql_mode`
- Basic `wp_options` reads and writes against MongoDB

This is intentionally narrow. It is not a full MySQL implementation and it is not a drop-in database replacement for WordPress.

## Supported SQL surface

The prototype currently handles:

- `SELECT 1`
- `SET NAMES 'utf8mb4'`
- `SHOW VARIABLES [LIKE 'name']`
- `SHOW DATABASES`
- `SHOW TABLES`
- `DESCRIBE wp_options`
- `SHOW COLUMNS FROM wp_options`
- `SELECT DATABASE()`
- `SELECT VERSION()`
- `SELECT @@SESSION.sql_mode`
- `SELECT ... FROM wp_options WHERE option_name = '...' LIMIT 1`
- `INSERT INTO wp_options (...) VALUES (...)`
- `UPDATE wp_options SET ... WHERE option_name = '...'`

Anything else returns an explicit MySQL error packet so unsupported behavior is visible.

## Architecture

`WordPress client -> mysql2 server API -> query router -> MongoDB driver -> wp_options collection`

The bridge uses one MongoDB collection per WordPress-like table. The first milestone only implements `wp_options`.

## Getting started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the environment template:

   ```bash
   cp .env.example .env
   ```

3. Start MongoDB and update `.env` if needed.

4. Start the bridge:

   ```bash
   npm start
   ```

5. Point a MySQL client at the configured port. Default credentials are:

   - host: `127.0.0.1`
   - port: `3307`
   - user: `wordpress`
   - password: `wordpress`
   - database: `wordpress`

## MongoDB layout

The bridge currently uses:

- `wp_options`
- `bridge_counters`

`bridge_counters` is used to allocate numeric `option_id` values so the results look more like MySQL rows.

## Development

Run the tests with:

```bash
npm test
```

The tests start the MySQL-facing server with an in-memory fake store, then exercise the wire protocol using a real `mysql2` client.

## Known limitations

- Only a tiny subset of SQL is implemented
- No joins, transactions, indexes, or query planner behavior
- No real prepared statement support
- Only `wp_options` is backed by MongoDB today
- WordPress core and plugins will issue many more queries than this prototype understands

This repo is meant to explore feasibility, not to claim compatibility.
