// Run pool-based production helpers inside an already-open fixture transaction.
// Indexing owns a transaction; map that inner transaction to a real savepoint
// so its COMMIT cannot commit fixtures, and its ROLLBACK cannot lose the fixture.
export function transactionPool(client) {
  let sequence = 0;
  return {
    query: (...args) => client.query(...args),
    async connect() {
      const savepoint = `fixture_index_${++sequence}`;
      return {
        async query(sql, ...args) {
          if (sql === 'BEGIN') return client.query(`SAVEPOINT ${savepoint}`);
          if (sql === 'COMMIT') return client.query(`RELEASE SAVEPOINT ${savepoint}`);
          if (sql === 'ROLLBACK') {
            await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
            return client.query(`RELEASE SAVEPOINT ${savepoint}`);
          }
          return client.query(sql, ...args);
        },
        release() {}, // Only the fixture owner releases the actual connection.
      };
    },
  };
}
