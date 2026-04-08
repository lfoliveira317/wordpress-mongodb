'use strict';

const mysql = require('mysql2');

const {
  createDescribeColumns,
  createSingleColumn,
  createWordPressSchema,
} = require('./schema');

const { Types } = mysql;

class MysqlBridgeError extends Error {
  constructor(message, { code = 1105, sqlState = 'HY000' } = {}) {
    super(message);
    this.name = 'MysqlBridgeError';
    this.code = code;
    this.sqlState = sqlState;
  }
}

function createQueryRouter({ database, tablePrefix, serverVersion, store }) {
  const schema = createWordPressSchema({ database, tablePrefix });
  const optionsTable = `${tablePrefix}options`;
  const optionsSchema = schema.tables[optionsTable];
  const variables = createVariables({
    database,
    serverVersion,
  });

  return {
    async route(sql, context) {
      const statement = normalizeSql(sql);
      const session = context.session;

      if (/^SELECT\s+1(?:\s+AS\s+`?([\w$]+)`?)?$/i.test(statement)) {
        const match = statement.match(/^SELECT\s+1(?:\s+AS\s+`?([\w$]+)`?)?$/i);
        const columnName = match[1] || '1';
        return {
          kind: 'result',
          rows: [{ [columnName]: 1 }],
          columns: createSingleColumn(
            session.database,
            '',
            columnName,
            Types.LONG,
            1,
            { characterSet: mysql.Charsets.BINARY }
          ),
        };
      }

      const setNamesMatch = statement.match(/^SET\s+NAMES\s+(.+)$/i);
      if (setNamesMatch) {
        session.characterSet = parseLiteral(setNamesMatch[1]) || session.characterSet;
        return okResult();
      }

      const setSqlModeMatch = statement.match(
        /^SET\s+(?:SESSION\s+)?sql_mode\s*=\s*(.+)$/i
      );
      if (setSqlModeMatch) {
        session.sqlMode = parseLiteral(setSqlModeMatch[1]) || '';
        return okResult();
      }

      if (/^SET\s+/i.test(statement)) {
        return okResult();
      }

      if (/^SHOW\s+DATABASES$/i.test(statement)) {
        return {
          kind: 'result',
          rows: [{ Database: session.database }],
          columns: createSingleColumn(
            session.database,
            'SCHEMATA',
            'Database',
            Types.VAR_STRING,
            191
          ),
        };
      }

      if (/^SHOW\s+(?:FULL\s+)?TABLES(?:\s+FROM\s+`?[\w$]+`?)?$/i.test(statement)) {
        const columnName = `Tables_in_${session.database}`;
        return {
          kind: 'result',
          rows: (await store.listTables()).map((tableName) => ({
            [columnName]: tableName,
          })),
          columns: createSingleColumn(
            session.database,
            'TABLES',
            columnName,
            Types.VAR_STRING,
            191
          ),
        };
      }

      const showVariablesMatch = statement.match(
        /^SHOW\s+VARIABLES(?:\s+LIKE\s+(.+))?$/i
      );
      if (showVariablesMatch) {
        return buildShowVariablesResult(
          variables,
          parseOptionalPattern(showVariablesMatch[1]),
          session.database
        );
      }

      const selectVariableMatch = statement.match(
        /^SELECT\s+(@@(?:SESSION\.)?[\w$]+)(?:\s+AS\s+`?([\w$]+)`?)?(?:\s+LIMIT\s+\d+)?$/i
      );
      if (selectVariableMatch) {
        const expression = selectVariableMatch[1];
        const variableName = expression.replace(/^@@(?:SESSION\.)?/i, '').toLowerCase();
        if (!Object.prototype.hasOwnProperty.call(variables, variableName)) {
          throw unsupportedQuery(statement);
        }

        const columnName = selectVariableMatch[2] || expression;
        return {
          kind: 'result',
          rows: [{ [columnName]: variables[variableName] }],
          columns: createSingleColumn(
            session.database,
            '',
            columnName,
            Types.VAR_STRING,
            255
          ),
        };
      }

      const selectDatabaseMatch = statement.match(
        /^SELECT\s+DATABASE\(\)(?:\s+AS\s+`?([\w$]+)`?)?$/i
      );
      if (selectDatabaseMatch) {
        const columnName = selectDatabaseMatch[1] || 'DATABASE()';
        return {
          kind: 'result',
          rows: [{ [columnName]: session.database }],
          columns: createSingleColumn(
            session.database,
            '',
            columnName,
            Types.VAR_STRING,
            191
          ),
        };
      }

      const selectVersionMatch = statement.match(
        /^SELECT\s+VERSION\(\)(?:\s+AS\s+`?([\w$]+)`?)?$/i
      );
      if (selectVersionMatch) {
        const columnName = selectVersionMatch[1] || 'VERSION()';
        return {
          kind: 'result',
          rows: [{ [columnName]: serverVersion }],
          columns: createSingleColumn(
            session.database,
            '',
            columnName,
            Types.VAR_STRING,
            255
          ),
        };
      }

      if (matchesDescribe(statement, optionsTable)) {
        return {
          kind: 'result',
          rows: optionsSchema.describeRows,
          columns: createDescribeColumns(),
        };
      }

      const selectOptionMatch = statement.match(
        new RegExp(
          `^SELECT\\s+(.+?)\\s+FROM\\s+\`?${escapeRegex(optionsTable)}\`?(?:\\s+(?:AS\\s+)?\`?[\\w$]+\`?)?\\s+WHERE\\s+\`?(?:[\\w$]+\\.)?option_name\`?\\s*=\\s*(.+?)(?:\\s+LIMIT\\s+\\d+)?$`,
          'i'
        )
      );
      if (selectOptionMatch) {
        const selectors = parseSelectColumns(selectOptionMatch[1], optionsSchema);
        const optionName = parseLiteral(selectOptionMatch[2]);
        if (typeof optionName !== 'string') {
          throw invalidQuery('Only quoted option_name lookups are supported.');
        }

        const option = await store.getOptionByName(optionName);
        return {
          kind: 'result',
          rows: option ? [projectRow(option, selectors)] : [],
          columns: projectColumns(selectors, optionsSchema),
        };
      }

      const insertOptionMatch = statement.match(
        new RegExp(
          `^INSERT\\s+INTO\\s+\`?${escapeRegex(optionsTable)}\`?\\s*\\((.+)\\)\\s*VALUES\\s*\\((.+)\\)$`,
          'i'
        )
      );
      if (insertOptionMatch) {
        const columns = splitSqlList(insertOptionMatch[1]).map(parseIdentifier);
        const values = splitSqlList(insertOptionMatch[2]).map(parseLiteral);
        if (columns.length !== values.length) {
          throw invalidQuery('INSERT column count does not match value count.');
        }

        const payload = Object.fromEntries(columns.map((column, index) => [column, values[index]]));
        ensureOnlyColumns(payload, ['option_name', 'option_value', 'autoload']);
        if (typeof payload.option_name !== 'string') {
          throw invalidQuery('INSERT must include a quoted option_name value.');
        }

        const result = await store.upsertOption(payload);
        return {
          kind: 'ok',
          affectedRows: 1,
          insertId: result.option.option_id,
        };
      }

      const updateOptionMatch = statement.match(
        new RegExp(
          `^UPDATE\\s+\`?${escapeRegex(optionsTable)}\`?\\s+SET\\s+(.+?)\\s+WHERE\\s+\`?option_name\`?\\s*=\\s*(.+?)(?:\\s+LIMIT\\s+\\d+)?$`,
          'i'
        )
      );
      if (updateOptionMatch) {
        const assignments = parseAssignments(updateOptionMatch[1]);
        ensureOnlyColumns(assignments, ['option_value', 'autoload']);

        const optionName = parseLiteral(updateOptionMatch[2]);
        if (typeof optionName !== 'string') {
          throw invalidQuery('UPDATE must target a quoted option_name value.');
        }

        const result = await store.updateOptionByName(optionName, assignments);
        return {
          kind: 'ok',
          affectedRows: result.matched ? 1 : 0,
          insertId: 0,
        };
      }

      throw unsupportedQuery(statement);
    },
  };
}

function buildShowVariablesResult(variables, pattern, database) {
  const rows = Object.entries(variables)
    .filter(([name]) => matchesPattern(name, pattern))
    .map(([name, value]) => ({
      Variable_name: name,
      Value: value,
    }));

  return {
    kind: 'result',
    rows,
    columns: [
      ...createSingleColumn(
        database,
        'VARIABLES',
        'Variable_name',
        Types.VAR_STRING,
        255
      ),
      ...createSingleColumn(database, 'VARIABLES', 'Value', Types.VAR_STRING, 255),
    ],
  };
}

function createVariables({ database, serverVersion }) {
  return {
    version: serverVersion,
    version_comment: 'wordpress-mongodb experimental bridge',
    sql_mode: '',
    auto_increment_increment: '1',
    character_set_client: 'utf8mb4',
    character_set_connection: 'utf8mb4',
    character_set_results: 'utf8mb4',
    collation_connection: 'utf8mb4_general_ci',
    lower_case_table_names: '0',
    max_allowed_packet: '16777216',
    tx_isolation: 'READ-COMMITTED',
    transaction_isolation: 'READ-COMMITTED',
    init_connect: '',
    system_time_zone: 'UTC',
    time_zone: 'SYSTEM',
    hostname: 'wordpress-mongodb',
    database,
  };
}

function normalizeSql(sql) {
  return sql.trim().replace(/;+\s*$/, '');
}

function okResult() {
  return {
    kind: 'ok',
    affectedRows: 0,
    insertId: 0,
  };
}

function parseOptionalPattern(value) {
  if (!value) {
    return null;
  }

  const parsed = parseLiteral(value);
  return typeof parsed === 'string' ? parsed : null;
}

function matchesPattern(value, pattern) {
  if (!pattern) {
    return true;
  }

  const expression = new RegExp(
    `^${escapeRegex(pattern).replace(/%/g, '.*').replace(/_/g, '.')}$`,
    'i'
  );
  return expression.test(value);
}

function matchesDescribe(statement, tableName) {
  return (
    new RegExp(`^DESCRIBE\\s+\`?${escapeRegex(tableName)}\`?$`, 'i').test(statement) ||
    new RegExp(
      `^SHOW\\s+COLUMNS\\s+FROM\\s+\`?${escapeRegex(tableName)}\`?$`,
      'i'
    ).test(statement)
  );
}

function parseSelectColumns(clause, tableSchema) {
  if (clause.trim() === '*') {
    return tableSchema.columns.map((column) => ({
      source: column.name,
      alias: column.name,
      field: column,
    }));
  }

  return splitSqlList(clause).map((token) => {
    const match = token.match(
      /^(?:(?:`?[\w$]+`?)\.)?`?([\w$]+)`?(?:\s+AS\s+`?([\w$]+)`?)?$/i
    );

    if (!match) {
      throw invalidQuery(`Unsupported SELECT column: ${token}`);
    }

    const source = match[1];
    const field = tableSchema.columnMap.get(source);
    if (!field) {
      throw invalidQuery(`Unknown column ${source}.`);
    }

    return {
      source,
      alias: match[2] || source,
      field,
    };
  });
}

function projectColumns(selectors, tableSchema) {
  return selectors.map((selector) => ({
    ...tableSchema.columnMap.get(selector.source),
    name: selector.alias,
  }));
}

function projectRow(row, selectors) {
  const projected = {};
  for (const selector of selectors) {
    projected[selector.alias] = row[selector.source];
  }
  return projected;
}

function parseAssignments(clause) {
  return Object.fromEntries(
    splitSqlList(clause).map((assignment) => {
      const match = assignment.match(
        /^(?:(?:`?[\w$]+`?)\.)?`?([\w$]+)`?\s*=\s*(.+)$/i
      );
      if (!match) {
        throw invalidQuery(`Unsupported assignment: ${assignment}`);
      }

      return [match[1], parseLiteral(match[2])];
    })
  );
}

function ensureOnlyColumns(object, allowedColumns) {
  for (const key of Object.keys(object)) {
    if (!allowedColumns.includes(key)) {
      throw invalidQuery(`Column ${key} is not writable in this prototype.`);
    }
  }
}

function parseIdentifier(token) {
  return token.trim().replace(/`/g, '').replace(/^[\w$]+\./, '');
}

function parseLiteral(token) {
  const value = token.trim();
  if (/^null$/i.test(value)) {
    return null;
  }

  if (/^-?\d+(?:\.\d+)?$/.test(value)) {
    return Number(value);
  }

  if (
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('"') && value.endsWith('"'))
  ) {
    const quote = value[0];
    const body = value.slice(1, -1);
    return body
      .replace(/\\\\/g, '\\')
      .replace(new RegExp(`\\\\${quote}`, 'g'), quote)
      .replace(/''/g, "'");
  }

  return value;
}

function splitSqlList(input) {
  const tokens = [];
  let buffer = '';
  let quote = null;
  let depth = 0;
  let escapeNext = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];

    if (quote) {
      buffer += character;
      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (character === '\\') {
        escapeNext = true;
        continue;
      }

      if (character === quote) {
        if (quote === "'" && input[index + 1] === "'") {
          buffer += input[index + 1];
          index += 1;
          continue;
        }
        quote = null;
      }

      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      buffer += character;
      continue;
    }

    if (character === '(') {
      depth += 1;
      buffer += character;
      continue;
    }

    if (character === ')') {
      depth = Math.max(0, depth - 1);
      buffer += character;
      continue;
    }

    if (character === ',' && depth === 0) {
      tokens.push(buffer.trim());
      buffer = '';
      continue;
    }

    buffer += character;
  }

  if (buffer.trim()) {
    tokens.push(buffer.trim());
  }

  return tokens;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function invalidQuery(message) {
  return new MysqlBridgeError(message, {
    code: 1064,
    sqlState: '42000',
  });
}

function unsupportedQuery(statement) {
  return new MysqlBridgeError(`Unsupported query for prototype: ${statement}`, {
    code: 1105,
    sqlState: 'HY000',
  });
}

module.exports = {
  MysqlBridgeError,
  createQueryRouter,
};
