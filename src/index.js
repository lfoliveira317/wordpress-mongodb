'use strict';

require('dotenv').config();

const { loadConfig } = require('./config');
const { MongoWordPressStore } = require('./mongoStore');
const { createMysqlBridgeServer } = require('./mysqlServer');
const { createQueryRouter } = require('./queryRouter');

async function main() {
  const config = loadConfig();
  const store = new MongoWordPressStore({
    uri: config.mongodb.uri,
    dbName: config.mongodb.dbName,
    tablePrefix: config.wordpress.tablePrefix,
  });

  await store.connect();

  const router = createQueryRouter({
    database: config.database,
    tablePrefix: config.wordpress.tablePrefix,
    serverVersion: config.serverVersion,
    store,
  });

  const server = createMysqlBridgeServer({
    config,
    router,
  });

  await server.listen(config.port, config.bindHost);
  console.log(
    `wordpress-mongodb listening on ${config.bindHost}:${config.port} for database ${config.database}`
  );

  const shutdown = async () => {
    await server.close();
    await store.close();
  };

  process.on('SIGINT', async () => {
    await shutdown();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await shutdown();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
