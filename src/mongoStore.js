'use strict';

const { MongoClient } = require('mongodb');

class MongoWordPressStore {
  constructor({ uri, dbName, tablePrefix }) {
    this.client = new MongoClient(uri);
    this.dbName = dbName;
    this.tablePrefix = tablePrefix;
    this.db = null;
  }

  async connect() {
    await this.client.connect();
    this.db = this.client.db(this.dbName);
    await this.db
      .collection(`${this.tablePrefix}options`)
      .createIndex({ option_name: 1 }, { unique: true });
  }

  async close() {
    await this.client.close();
  }

  async listTables() {
    return [`${this.tablePrefix}options`];
  }

  async getOptionByName(optionName) {
    const option = await this.db.collection(`${this.tablePrefix}options`).findOne(
      { option_name: optionName },
      { projection: { _id: 0 } }
    );

    if (!option) {
      return null;
    }

    return normalizeOption(option);
  }

  async upsertOption(input) {
    const collection = this.db.collection(`${this.tablePrefix}options`);
    const existing = await collection.findOne(
      { option_name: input.option_name },
      { projection: { _id: 0 } }
    );

    if (existing) {
      const merged = normalizeOption({
        ...existing,
        ...input,
      });
      await collection.updateOne(
        { option_name: input.option_name },
        {
          $set: {
            option_value: merged.option_value,
            autoload: merged.autoload,
          },
        }
      );
      return {
        inserted: false,
        option: merged,
      };
    }

    const option = normalizeOption({
      option_id: await this.nextSequence(`${this.tablePrefix}options`),
      ...input,
    });

    await collection.insertOne(option);
    return {
      inserted: true,
      option,
    };
  }

  async updateOptionByName(optionName, changes) {
    const collection = this.db.collection(`${this.tablePrefix}options`);
    const existing = await collection.findOne(
      { option_name: optionName },
      { projection: { _id: 0 } }
    );

    if (!existing) {
      return {
        matched: false,
        option: null,
      };
    }

    const option = normalizeOption({
      ...existing,
      ...changes,
      option_name: optionName,
    });

    await collection.updateOne(
      { option_name: optionName },
      {
        $set: {
          option_value: option.option_value,
          autoload: option.autoload,
        },
      }
    );

    return {
      matched: true,
      option,
    };
  }

  async nextSequence(sequenceName) {
    const result = await this.db.collection('bridge_counters').findOneAndUpdate(
      { _id: sequenceName },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: 'after' }
    );

    const document =
      result && Object.prototype.hasOwnProperty.call(result, 'value')
        ? result.value
        : result;

    if (!document || typeof document.seq !== 'number') {
      throw new Error(`Unable to allocate a sequence for ${sequenceName}.`);
    }

    return document.seq;
  }
}

function normalizeOption(option) {
  return {
    option_id: Number(option.option_id),
    option_name: String(option.option_name),
    option_value:
      option.option_value === null || option.option_value === undefined
        ? ''
        : String(option.option_value),
    autoload:
      option.autoload === null || option.autoload === undefined
        ? 'yes'
        : String(option.autoload),
  };
}

module.exports = {
  MongoWordPressStore,
};
