'use strict';

const mysql = require('mysql2');

const { Charsets, Types } = mysql;

function createField({
  database,
  table,
  name,
  type,
  length,
  flags = 0,
  decimals = 0,
  characterSet = Charsets.UTF8MB4_GENERAL_CI,
}) {
  return {
    catalog: 'def',
    schema: database,
    db: database,
    table,
    orgTable: table,
    name,
    orgName: name,
    characterSet,
    columnLength: length,
    columnType: type,
    flags,
    decimals,
  };
}

function createWordPressSchema({ database, tablePrefix }) {
  const optionsTable = `${tablePrefix}options`;
  const optionsColumns = [
    createField({
      database,
      table: optionsTable,
      name: 'option_id',
      type: Types.LONG,
      length: 11,
      flags: 16899,
      characterSet: Charsets.BINARY,
    }),
    createField({
      database,
      table: optionsTable,
      name: 'option_name',
      type: Types.VAR_STRING,
      length: 191,
      flags: 20483,
    }),
    createField({
      database,
      table: optionsTable,
      name: 'option_value',
      type: Types.LONG_BLOB,
      length: 4294967295,
    }),
    createField({
      database,
      table: optionsTable,
      name: 'autoload',
      type: Types.VAR_STRING,
      length: 20,
      flags: 20480,
    }),
  ];

  return {
    tables: {
      [optionsTable]: {
        name: optionsTable,
        columns: optionsColumns,
        columnMap: new Map(optionsColumns.map((column) => [column.name, column])),
        describeRows: [
          {
            Field: 'option_id',
            Type: 'bigint(20) unsigned',
            Null: 'NO',
            Key: 'PRI',
            Default: null,
            Extra: 'auto_increment',
          },
          {
            Field: 'option_name',
            Type: 'varchar(191)',
            Null: 'NO',
            Key: 'UNI',
            Default: '',
            Extra: '',
          },
          {
            Field: 'option_value',
            Type: 'longtext',
            Null: 'NO',
            Key: '',
            Default: null,
            Extra: '',
          },
          {
            Field: 'autoload',
            Type: 'varchar(20)',
            Null: 'NO',
            Key: '',
            Default: 'yes',
            Extra: '',
          },
        ],
      },
    },
  };
}

function createDescribeColumns() {
  return [
    createField({
      database: 'information_schema',
      table: 'COLUMNS',
      name: 'Field',
      type: Types.VAR_STRING,
      length: 191,
    }),
    createField({
      database: 'information_schema',
      table: 'COLUMNS',
      name: 'Type',
      type: Types.VAR_STRING,
      length: 191,
    }),
    createField({
      database: 'information_schema',
      table: 'COLUMNS',
      name: 'Null',
      type: Types.VAR_STRING,
      length: 3,
    }),
    createField({
      database: 'information_schema',
      table: 'COLUMNS',
      name: 'Key',
      type: Types.VAR_STRING,
      length: 3,
    }),
    createField({
      database: 'information_schema',
      table: 'COLUMNS',
      name: 'Default',
      type: Types.VAR_STRING,
      length: 255,
    }),
    createField({
      database: 'information_schema',
      table: 'COLUMNS',
      name: 'Extra',
      type: Types.VAR_STRING,
      length: 255,
    }),
  ];
}

function createSingleColumn(database, table, name, type, length, options = {}) {
  return [
    createField({
      database,
      table,
      name,
      type,
      length,
      ...options,
    }),
  ];
}

module.exports = {
  createDescribeColumns,
  createField,
  createSingleColumn,
  createWordPressSchema,
};
