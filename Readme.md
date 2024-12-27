# PookieDB

A lightweight, high-performance in-memory database with persistent storage and automatic indexing.

## Features

- In-memory data storage with MessagePack serialization
- Automatic multi-threaded indexing
- LRU caching for queries
- CRUD operations with UUID generation
- Efficient query system with index-based lookups
- Automatic periodic saves
- Batch write operations
- Worker thread pool for parallel processing

## Installation

```bash
git clone https://github.com/pookieDB
```

## Usage

### Basic Setup

```javascript
const Database = require('pookiedb');

const db = new Database('data.msgpack', {
    cacheSize: 50000,    // LRU cache size
    batchSize: 5000,     // Batch size for auto-save
    saveInterval: 5000,  // Auto-save interval in ms
    cacheTTL: 300000     // Cache TTL in ms (default: 5 minutes)
});

await db.init();  // Initialize the database
```

### CRUD Operations

```javascript
// Create
const user = await db.create({
    name: 'John Doe',
    age: 30,
    email: 'john@example.com'
});

// Read all records
const allUsers = await db.read();

// Update
await db.update(user.id, { age: 31 });

// Delete
await db.delete(user.id);
```

### Queries

```javascript
// Find by single key-value pair
const users = await db.findByKey('age', 30);

// Find by multiple conditions
const results = await db.findByQuery({
    age: 30,
    name: 'John Doe'
});
```

## Performance

The database uses several optimization techniques:

1. **Worker Thread Pool**: Distributes indexing work across multiple CPU cores
2. **LRU Cache**: Caches frequent queries for faster access
3. **MessagePack**: Efficient binary serialization
4. **Batch Processing**: Optimizes write operations
5. **Automatic Indexing**: Maintains indexes for fast queries

## Configuration Options

| Option | Description | Default |
|--------|-------------|---------|
| cacheSize | Maximum number of cached query results | 50000 |
| cacheTTL | Time-to-live for cached items (ms) | 300000 |
| batchSize | Number of writes before auto-save | 5000 |
| saveInterval | Auto-save interval (ms) | 5000 |

## Benchmarks

You can run the included benchmark script to test performance:

```bash
node benchmark.js
```

Actual performance metrics from test runs:
- Creating 100k records: ~720ms
- Reading 200k records: ~1.2ms
- Querying indexed fields (2000+ results): ~3ms
- Batch updating 1k records: ~9ms

These benchmarks were run on a standard development machine and demonstrate the high-performance capabilities of PookieDB, particularly in read operations and indexed queries.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

![I'm Betmen](https://i.pinimg.com/736x/c2/ec/1f/c2ec1ffb5c4f2fd089796ec3baf71598.jpg)
