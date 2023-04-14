SELECT
  evt."contract_address" as "contract",
  evt."owner" as "owner",
  evt."spender" as "spender",
  evt."value" as "value",
  evt."evt_block_number" as "block_number",
  evt."evt_block_time" as "timestamp",
  evt."index" as "index",
  tx."from" as "tx_from",
  tx."to" as "tx_to",
  tx."index" as "tx_index",
  tx."hash" as "tx_hash"
FROM
  (
    SELECT
      evt."contract_address",
      evt."owner",
      evt."spender",
      evt."value",
      evt."evt_block_number",
      evt."evt_block_time",
      evt."evt_tx_hash"
    FROM
      erc20_{{network}}.evt_Approval evt
    WHERE
      {{whereFilter}}
    ORDER BY
      evt."evt_block_number" ASC
    LIMIT
      500000
  ) AS evt
  JOIN {{network}}.transactions tx ON (evt."evt_tx_hash" = tx."hash")