const Database = require('./src/index');
const { performance } = require('perf_hooks');

async function runBenchmark() {
    console.log("=== Starting Benchmark ===");
    
    const db = new Database('benchmark_data.msgpack', {
        cacheSize: 50000,
        batchSize: 5000,
        saveInterval: 5000
    });
    
    await db.init();

    // Create benchmark
    const createStart = performance.now();
    const entries = 100000;
    const createPromises = Array.from({ length: entries }, (_, i) => 
        db.create({
            name: `User${i}`,
            age: Math.floor(Math.random() * 100),
            email: `user${i}@example.com`
        })
    );
    
    await Promise.all(createPromises);
    console.log(`Create ${entries} entries: ${(performance.now() - createStart).toFixed(2)}ms`);

    // Read benchmark
    const readStart = performance.now();
    const data = await db.read();
    console.log(`Read ${data.length} entries: ${(performance.now() - readStart).toFixed(2)}ms`);

    // Query benchmark
    const queryStart = performance.now();
    const results = await db.findByQuery({ age: 25 });
    console.log(`Query by age=25 (${results.length} results): ${(performance.now() - queryStart).toFixed(2)}ms`);

    // Batch update benchmark
    const updateStart = performance.now();
    const updatePromises = data.slice(0, 1000).map(item => 
        db.update(item.id, { age: item.age + 1 })
    );
    await Promise.all(updatePromises);
    console.log(`Batch update 1000 entries: ${(performance.now() - updateStart).toFixed(2)}ms`);

    console.log("=== Benchmark Complete ===");
}

runBenchmark().catch(console.error);