SELECT
  evt."contract_address" as "contract",
  evt."from" as "from",
  evt."to" as "to",
  evt."token_id",
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
      evt."contract_address",
      evt."from",
      evt."to",
      evt."tokenId" as "token_id",
      evt."evt_block_number",
      evt."evt_block_time",
      evt."evt_tx_hash",
      evt."index"
    FROM
      erc721_{{network}}.evt_Transfer evt
    WHERE
      {{whereFilter}}
    ORDER BY
      evt."evt_block_time" ASC
    LIMIT
      500000
  ) AS evt
  JOIN {{network}}.transactions tx ON (evt."evt_tx_hash" = tx."hash")