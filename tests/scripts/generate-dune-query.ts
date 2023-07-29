import { TOKEN_ADDRESSES } from '../constants';
import { TOKEN_OBSERVATION_TIME } from '../../src/analyzer/modules/observation-time';

function main() {
  console.log(`WITH contracts_table AS (
    SELECT trace.address AS contract,
        trace.block_number AS blockNumber,
        trace.block_time AS timestamp,
        trace."from" AS deployer
    FROM ethereum.traces trace
    WHERE trace.type = 'create'
        AND trace.address IN (
           ${TOKEN_ADDRESSES.join(',')}
        )
),
contract_types_table AS (
    SELECT t.contract, t.blockNumber, t.timestamp, t.deployer,
        CASE
            WHEN EXISTS (
                SELECT 1
                FROM erc1155_ethereum.evt_TransferSingle evt
                WHERE evt.contract_address = t.contract
            ) THEN '1155'
            WHEN EXISTS (
                SELECT 1
                FROM erc1155_ethereum.evt_TransferBatch evt
                WHERE evt.contract_address = t.contract
            ) THEN '1155'
            WHEN EXISTS (
                SELECT 1
                FROM erc721_ethereum.evt_Transfer evt
                WHERE evt.contract_address = t.contract
            ) THEN '721'
            WHEN EXISTS (
                SELECT 1
                FROM erc20_ethereum.evt_Transfer evt
                WHERE evt.contract_address = t.contract
            ) THEN '20'
            ELSE 'Unknown'
        END AS type
    FROM contracts_table t
),
tokens_with_hashes AS (
    SELECT t.contract, array_agg(tx.hash) AS hashes
    FROM contract_types_table t
    JOIN ethereum.transactions tx ON tx.to = t.contract
    GROUP BY t.contract
),
tokens_with_block_numbers AS (
    SELECT t.contract, array_agg(DISTINCT trace.block_number) AS blockNumbers
    FROM contract_types_table t
    JOIN ethereum.traces trace ON trace.to = t.contract
        AND trace.block_time <= (t.timestamp + INTERVAL '${TOKEN_OBSERVATION_TIME}' SECOND) -- 4 months
    GROUP BY t.contract
)
SELECT t.contract, t.type, t.blockNumber, t.deployer, t.timestamp, n.blockNumbers, h.hashes
FROM contract_types_table t
LEFT JOIN tokens_with_hashes h ON t.contract = h.contract
LEFT JOIN tokens_with_block_numbers n ON t.contract = n.contract`);
}

main();
