SELECT tx."from", tx."to", tx.block_number, tx.block_time as "timestamp", tx.index, tx.hash
FROM ethereum.transactions tx
WHERE {{whereFilter}}
LIMIT 500000