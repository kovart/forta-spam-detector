SELECT
  evt."operator",
  evt."from",
  evt."to",
  evt."ids" as "token_ids",
  evt."values" as "token_values",
  evt."contract_address" as "contract",
  evt."evt_block_number" as "block_number",
  evt."evt_block_time" as "timestamp",
  evt."index" as "index",
  tx."index" as "tx_index",
  tx."from" as "tx_from",
  tx."to" as "tx_to",
  tx."hash" as "tx_hash"
FROM
  (
    SELECT
      evt."operator",
      evt."from",
      evt."to",
      evt."ids",
      evt."values",
      evt."contract_address",
      evt."evt_block_number",
      evt."evt_block_time",
      evt."evt_tx_hash",
      evt."index"
    FROM
      erc1155_{{network}}.evt_TransferBatch evt
    WHERE
      {{whereFilter}}
    ORDER BY
      evt."evt_block_number" ASC
    LIMIT
      500000
  ) AS evt
  JOIN {{network}}.transactions tx ON (evt."evt_tx_hash" = tx."hash")