'use strict';

function readBoolean(name, defaultValue) {
  const value = process.env[name];
  if (value === undefined) {
    return defaultValue;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function readNumber(name, defaultValue) {
  const value = process.env[name];
  if (value === undefined) {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`${name} must be a number.`);
  }

  return parsed;
}

function loadConfig(env = process.env) {
  return {
    bindHost: env.BIND_HOST || '0.0.0.0',
    port: readNumber('MYSQL_PORT', 3307),
    database: env.MYSQL_DATABASE || 'wordpress',
    auth: {
      user: env.MYSQL_USER || 'wordpress',
      password: env.MYSQL_PASSWORD || 'wordpress',
      allowAnonymousAuth: readBoolean('ALLOW_ANONYMOUS_AUTH', false),
    },
    serverVersion:
      env.MYSQL_SERVER_VERSION || '8.0.36-wordpress-mongodb',
    mongodb: {
      uri: env.MONGODB_URI || 'mongodb://127.0.0.1:27017',
      dbName: env.MONGODB_DB || 'wordpress_bridge',
    },
    wordpress: {
      tablePrefix: env.WORDPRESS_TABLE_PREFIX || 'wp_',
    },
    sessionDefaults: {
      characterSet: 'utf8mb4',
      collationConnection: 'utf8mb4_general_ci',
      sqlMode: '',
    },
  };
}

module.exports = {
  loadConfig,
};
