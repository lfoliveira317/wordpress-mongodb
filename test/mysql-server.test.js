'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const mysql = require('mysql2/promise');

const { createMysqlBridgeServer } = require('../src/mysqlServer');
const { createQueryRouter } = require('../src/queryRouter');

class FakeStore {
  constructor(tablePrefix) {
    this.tablePrefix = tablePrefix;
    this.options = new Map();
    this.nextId = 1;
  }

  async listTables() {
    return [`${this.tablePrefix}options`];
  }

  async getOptionByName(optionName) {
    return this.options.get(optionName) || null;
  }

  async upsertOption(input) {
    const existing = this.options.get(input.option_name);
    if (existing) {
      const merged = {
        ...existing,
        ...input,
        autoload: input.autoload ?? existing.autoload,
      };
      this.options.set(input.option_name, merged);
      return {
        inserted: false,
        option: merged,
      };
    }

    const option = {
      option_id: this.nextId++,
      option_name: input.option_name,
      option_value: input.option_value ?? '',
      autoload: input.autoload ?? 'yes',
    };
    this.options.set(option.option_name, option);
    return {
      inserted: true,
      option,
    };
  }

  async updateOptionByName(optionName, changes) {
    const existing = this.options.get(optionName);
    if (!existing) {
      return {
        matched: false,
        option: null,
      };
    }

    const option = {
      ...existing,
      ...changes,
    };
    this.options.set(optionName, option);
    return {
      matched: true,
      option,
    };
  }
}

test('serves a small WordPress-flavored MySQL surface', async () => {
  const config = {
    database: 'wordpress',
    serverVersion: '8.0.36-wordpress-mongodb',
    auth: {
      user: 'wordpress',
      password: 'wordpress',
      allowAnonymousAuth: false,
    },
    sessionDefaults: {
      characterSet: 'utf8mb4',
      collationConnection: 'utf8mb4_general_ci',
      sqlMode: '',
    },
  };
  const store = new FakeStore('wp_');
  await store.upsertOption({
    option_name: 'siteurl',
    option_value: 'http://example.test',
    autoload: 'yes',
  });

  const router = createQueryRouter({
    database: config.database,
    tablePrefix: 'wp_',
    serverVersion: config.serverVersion,
    store,
  });

  const server = createMysqlBridgeServer({
    config,
    router,
    logger: {
      error() {},
    },
  });

  await server.listen(0, '127.0.0.1');
  const { port } = server.address();

  const connection = await mysql.createConnection({
    host: '127.0.0.1',
    port,
    user: 'wordpress',
    password: 'wordpress',
    database: 'wordpress',
  });

  try {
    const [selectOne] = await connection.query('SELECT 1 AS ok');
    assert.equal(selectOne[0].ok, 1);

    const [databaseRows] = await connection.query('SELECT DATABASE() AS current_db');
    assert.equal(databaseRows[0].current_db, 'wordpress');

    const [tables] = await connection.query('SHOW TABLES');
    assert.equal(tables[0].Tables_in_wordpress, 'wp_options');

    const [optionRows] = await connection.query(
      "SELECT option_value FROM wp_options WHERE option_name = 'siteurl' LIMIT 1"
    );
    assert.equal(optionRows[0].option_value, 'http://example.test');

    const [insertResult] = await connection.query(
      "INSERT INTO wp_options (option_name, option_value, autoload) VALUES ('home', 'http://example.test/home', 'yes')"
    );
    assert.equal(insertResult.affectedRows, 1);

    await connection.query(
      "UPDATE wp_options SET option_value = 'https://example.test/home' WHERE option_name = 'home'"
    );
    const [updatedRows] = await connection.query(
      "SELECT option_value FROM wp_options WHERE option_name = 'home' LIMIT 1"
    );
    assert.equal(updatedRows[0].option_value, 'https://example.test/home');

    const [variables] = await connection.query("SHOW VARIABLES LIKE 'sql_mode'");
    assert.equal(variables[0].Variable_name, 'sql_mode');
  } finally {
    await connection.end();
    await server.close();
  }
});
