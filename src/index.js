const fs = require("fs").promises;
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const msgpack = require("@msgpack/msgpack");
const { Worker } = require("worker_threads");
const { LRUCache } = require("lru-cache");

class Database {
  constructor(schema, options = {}) {
    this.schema = schema;
    this.data = new Map();
    this.indexes = new Map();
    this.cache = new LRUCache({
      max: options.cacheSize || 50000,
      ttl: options.cacheTTL || 1000 * 60 * 5,
    });
    this.pendingWrites = new Map();
    this.batchSize = options.batchSize || 5000;
    this.saveInterval = options.saveInterval || 5000;
    this.lastSave = Date.now();
    this.isInitialized = false;
    this.workerPool = [];
    this.savePromise = null;
    this.dirty = false;
  }

  async init() {
    if (this.isInitialized) return;
    await this.initWorkers();
    await this.load();
    this.startAutoSave();
    this.isInitialized = true;
  }

  startAutoSave() {
    setInterval(async () => {
      if (this.dirty && !this.savePromise) {
        await this.save();
      }
    }, this.saveInterval);
  }

  async initWorkers() {
    const workerCount = Math.max(
      1,
      Math.floor(require("os").cpus().length / 2)
    );
    const workerScript = `
            const { parentPort } = require('worker_threads');
            
            function buildIndexChunk(data) {
                const indexes = new Map();
                for (const [id, obj] of data) {
                    for (const [key, value] of Object.entries(obj)) {
                        if (!indexes.has(key)) indexes.set(key, new Map());
                        if (!indexes.get(key).has(value)) indexes.get(key).set(value, new Set());
                        indexes.get(key).get(value).add(id);
                    }
                }
                return indexes;
            }

            parentPort.on('message', ({ type, data }) => {
                if (type === 'buildIndex') {
                    const indexes = buildIndexChunk(data);
                    parentPort.postMessage([...indexes]);
                }
            });
        `;

    for (let i = 0; i < workerCount; i++) {
      const worker = new Worker(workerScript, { eval: true });
      this.workerPool.push(worker);
    }
  }

  async load() {
    try {
      const filePath = path.resolve(__dirname, this.schema);
      const content = await fs.readFile(filePath);
      const decodedData = msgpack.decode(content);
      this.data = new Map(decodedData.map((item) => [item.id, item]));
      await this.buildIndexes();
    } catch (err) {
      if (err.code === "ENOENT") {
        this.data = new Map();
      } else {
        throw err;
      }
    }
  }

  async save() {
    if (this.savePromise) return this.savePromise;

    this.savePromise = (async () => {
      const tmpPath = `${this.schema}.tmp`;
      const dataArray = Array.from(this.data.values());

      try {
        const packedData = msgpack.encode(dataArray);
        await fs.writeFile(path.resolve(__dirname, tmpPath), packedData);
        await fs.rename(
          path.resolve(__dirname, tmpPath),
          path.resolve(__dirname, this.schema)
        );
        this.dirty = false;
        this.lastSave = Date.now();
      } catch (err) {
        console.error("Error saving data:", err);
        try {
          await fs.unlink(path.resolve(__dirname, tmpPath));
        } catch (e) {}
        throw err;
      } finally {
        this.savePromise = null;
      }
    })();

    return this.savePromise;
  }

  async buildIndexes() {
    const dataArray = Array.from(this.data.entries());
    const chunkSize = Math.ceil(dataArray.length / this.workerPool.length);
    const chunks = Array.from({ length: this.workerPool.length }, (_, i) =>
      dataArray.slice(i * chunkSize, (i + 1) * chunkSize)
    );

    const results = await Promise.all(
      chunks.map(
        (chunk, i) =>
          new Promise((resolve) => {
            const worker = this.workerPool[i];
            worker.postMessage({ type: "buildIndex", data: chunk });
            worker.once("message", resolve);
          })
      )
    );

    this.indexes = new Map();
    for (const workerIndexes of results) {
      for (const [key, valueMap] of workerIndexes) {
        if (!this.indexes.has(key)) {
          this.indexes.set(key, new Map());
        }
        for (const [value, ids] of valueMap) {
          if (!this.indexes.get(key).has(value)) {
            this.indexes.get(key).set(value, new Set());
          }
          for (const id of ids) {
            this.indexes.get(key).get(value).add(id);
          }
        }
      }
    }
  }

  async create(obj) {
    await this.init();
    const id = obj.id || uuidv4();
    obj.id = id;
    this.data.set(id, obj);
    this.dirty = true;

    // Update indexes immediately for better query performance
    for (const [key, value] of Object.entries(obj)) {
      if (!this.indexes.has(key)) {
        this.indexes.set(key, new Map());
      }
      if (!this.indexes.get(key).has(value)) {
        this.indexes.get(key).set(value, new Set());
      }
      this.indexes.get(key).get(value).add(id);
    }

    if (this.data.size % this.batchSize === 0) {
      await this.save();
    }

    return obj;
  }

  async read() {
    await this.init();
    return Array.from(this.data.values());
  }

  async update(id, updates) {
    await this.init();
    const existingObj = this.data.get(id);
    if (!existingObj) return null;

    // Remove old index entries
    for (const [key, value] of Object.entries(existingObj)) {
      const indexMap = this.indexes.get(key);
      if (indexMap?.has(value)) {
        indexMap.get(value).delete(id);
      }
    }

    // Update object
    const updatedObj = { ...existingObj, ...updates };
    this.data.set(id, updatedObj);
    this.dirty = true;

    // Add new index entries
    for (const [key, value] of Object.entries(updatedObj)) {
      if (!this.indexes.has(key)) {
        this.indexes.set(key, new Map());
      }
      if (!this.indexes.get(key).has(value)) {
        this.indexes.get(key).set(value, new Set());
      }
      this.indexes.get(key).get(value).add(id);
    }

    return updatedObj;
  }

  async findByKey(key, value) {
    await this.init();
    const cacheKey = `${key}:${value}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const ids = this.indexes.get(key)?.get(value);
    if (!ids) return [];

    const results = Array.from(ids)
      .map((id) => this.data.get(id))
      .filter(Boolean);
    this.cache.set(cacheKey, results);
    return results;
  }

  async findByQuery(query) {
    await this.init();
    const cacheKey = `query:${JSON.stringify(query)}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const keys = Object.keys(query);
    if (keys.length === 0) return [];

    // Find smallest matching set
    let smallestSet = null;
    let smallestKey = null;

    for (const key of keys) {
      const valueMap = this.indexes.get(key);
      const matchingIds = valueMap?.get(query[key]);

      if (
        matchingIds &&
        (!smallestSet || matchingIds.size < smallestSet.size)
      ) {
        smallestSet = matchingIds;
        smallestKey = key;
      }
    }

    if (!smallestSet) return [];

    const results = Array.from(smallestSet)
      .map((id) => this.data.get(id))
      .filter((obj) => obj && keys.every((key) => obj[key] === query[key]));

    this.cache.set(cacheKey, results);
    return results;
  }

  async delete(id) {
    await this.init();
    const obj = this.data.get(id);
    if (!obj) return false;

    // Remove from indexes
    for (const [key, value] of Object.entries(obj)) {
      const indexMap = this.indexes.get(key);
      if (indexMap?.has(value)) {
        indexMap.get(value).delete(id);
      }
    }

    this.data.delete(id);
    this.dirty = true;
    return true;
  }
}

module.exports = Database;
