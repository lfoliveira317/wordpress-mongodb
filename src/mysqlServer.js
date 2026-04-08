'use strict';

const mysql = require('mysql2');

const auth41 = require('./mysqlNativePassword');
const { MysqlBridgeError } = require('./queryRouter');

function createMysqlBridgeServer({ config, router, logger = console }) {
  const server = mysql.createServer();
  let nextConnectionId = 1;

  server.on('connection', (connection) => {
    const session = {
      database: config.database,
      characterSet: config.sessionDefaults.characterSet,
      collationConnection: config.sessionDefaults.collationConnection,
      sqlMode: config.sessionDefaults.sqlMode,
    };

    connection.on('error', (error) => {
      logger.error?.('Connection error:', error);
    });

    connection.serverHandshake({
      protocolVersion: 10,
      serverVersion: config.serverVersion,
      connectionId: nextConnectionId++,
      statusFlags: 2,
      characterSet: mysql.Charsets.UTF8MB4_GENERAL_CI,
      capabilityFlags: 0xffffff,
      authCallback: createAuthCallback(connection, config.auth),
    });

    connection.on('init_db', (schemaName) => {
      session.database = schemaName || config.database;
      writeOk(connection, {
        affectedRows: 0,
        insertId: 0,
      });
    });

    connection.on('query', async (sql) => {
      try {
        const response = await router.route(sql, { session });
        writeResponse(connection, response);
      } catch (error) {
        writeError(connection, error);
      }
    });

    connection.on('stmt_prepare', () => {
      writeErrorPacket(connection, {
        code: 1295,
        sqlState: 'HY000',
        message: 'Prepared statements are not supported by this prototype.',
      });
    });

    connection.on('stmt_execute', () => {
      writeErrorPacket(connection, {
        code: 1295,
        sqlState: 'HY000',
        message: 'Prepared statements are not supported by this prototype.',
      });
    });

    connection.on('field_list', () => {
      writeErrorPacket(connection, {
        code: 1105,
        sqlState: 'HY000',
        message: 'FIELD_LIST is not implemented by this prototype.',
      });
    });

    connection.on('quit', () => {
      connection.stream.end();
    });
  });

  return {
    async listen(port, host) {
      await new Promise((resolve, reject) => {
        server._server.once('error', reject);
        server.listen(port, host, () => {
          server._server.removeListener('error', reject);
          resolve();
        });
      });
    },

    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },

    address() {
      return server._server.address();
    },
  };
}

function createAuthCallback(connection, authConfig) {
  return (params, callback) => {
    if (authConfig.allowAnonymousAuth) {
      callback(null, null);
      process.nextTick(() => connection._resetSequenceId());
      return;
    }

    if (params.user !== authConfig.user) {
      callback(null, {
        code: 1045,
        message: 'Access denied for the supplied MySQL user.',
      });
      return;
    }

    const expectedPassword = authConfig.password || '';
    const authToken = params.authToken || Buffer.alloc(0);
    if (!expectedPassword) {
      if (authToken.length === 0) {
        callback(null, null);
        process.nextTick(() => connection._resetSequenceId());
      } else {
        callback(null, {
          code: 1045,
          message: 'This user does not accept a password.',
        });
      }
      return;
    }

    const valid = auth41.verifyToken(
      params.authPluginData1,
      params.authPluginData2,
      authToken,
      auth41.doubleSha1(expectedPassword)
    );

    if (!valid) {
      callback(null, {
        code: 1045,
        message: 'Access denied for the supplied MySQL password.',
      });
      return;
    }

    callback(null, null);
    process.nextTick(() => connection._resetSequenceId());
  };
}

function writeResponse(connection, response) {
  if (response.kind === 'ok') {
    writeOk(connection, {
      affectedRows: response.affectedRows,
      insertId: response.insertId,
    });
    return;
  }

  writeResultSet(connection, response.rows, response.columns);
}

function writeOk(connection, payload) {
  beginResponse(connection);
  connection.writeOk(payload);
  connection._resetSequenceId();
}

function writeResultSet(connection, rows, columns) {
  beginResponse(connection);
  connection.writeColumns(columns);
  for (const row of rows) {
    connection.writeTextRow(columns.map((column) => normalizeValue(row[column.name])));
  }
  connection.writeEof();
  connection._resetSequenceId();
}

function normalizeValue(value) {
  if (value === undefined) {
    return null;
  }

  return value;
}

function writeError(connection, error) {
  if (error instanceof MysqlBridgeError) {
    writeErrorPacket(connection, {
      code: error.code,
      sqlState: error.sqlState,
      message: error.message,
    });
    return;
  }

  writeErrorPacket(connection, {
    code: 1105,
    sqlState: 'HY000',
    message: error.message || 'Unknown bridge error.',
  });
}

function writeErrorPacket(connection, payload) {
  beginResponse(connection);
  connection.writeError(payload);
  connection._resetSequenceId();
}

function beginResponse(connection) {
  connection.sequenceId = 1;
  connection.compressedSequenceId = 0;
}

module.exports = {
  createMysqlBridgeServer,
};
