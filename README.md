# Spam Detector

## About Artem Kovalchuk

I am a contractor for the Forta Foundation, and have been a bot developer since the Forta Network launched in Fall 2021.
You can [read more](#about-the-author) about my experience below.

## 💬 Bot Summary

This bot detects spam tokens using advanced algorithms that analyze multiple indicators. These indicators include token
metadata analysis, compliance with declared token standards, distribution rationality and analysis of creator and
recipient behavior. Additionally, the bot has the ability to adjust its assessment during the lifespan of the token,
providing up-to-date characterization of spam tokens.

## 🛠️ How it Works

The bot utilizes a modular system of indicators to analyze *all* new tokens.
The modules are designed to detect both negative indications of spam and positive indications of a legitimate token.

The result of each module’s analysis is captured in the overall analysis of the token, and can be used by subsequent
modules. Additionally, some modules can interrupt the execution of other modules and determine the final evaluation of
the token, i.e. `ObservationTimeIsOver` module.

The [TokenAnalyzer](./src/analyzer/analyzer.ts), which operates like an analysis engine, ingests the results from
different modules and determines whether the token is spam or not. To summarize the logic applied by the TokenAnalyzer -
the presence of negative indicators and an absence of positive indicators suggests the token is spam. When a spam
determination is made, the bot emits an alert that includes information about the token and the context of the modules
used to evaluate it. The token contract, its deployer, and the urls involved in the attack receive persistent labels in
the Forta Graphql database. If there are changes during token monitoring, such as when a module finds additional signs
that change the confidence score, the bot will emit an updated alert to indicate the change. If there is a change that
alters the evaluation, such that the token is no longer considered spam, the bot will emit an alert instructing Forta to
remove the spam label.

## 🕵️‍♀️ Modules

Here is a table containing all the indicator modules utilized in the project.

| Name                        | Description                                                                                                                                                                                                                                                                                     |
|:----------------------------|:------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Airdrop**                 | A passive airdrop with no claim by the recipient of the mint (or transfer). The airdrop indicator considers the number of unique recipients, both within a single transaction and across multiple transactions during a specified time period.                                                  |
| **LowActivityAfterAirdrop** | A very few of the accounts that received a token had any interaction with the token after a massive distribution of the token. This behavior often indicates that the value of the token is low.                                                                                                |
| **TooMuchAirdropActivity**  | There is a redundancy in the massiveness and duration of an airdrop. For instance, an airdrop that lasts for several months and affects many accounts, given the low token activity, is likely indicative of spam.                                                                              |
| **HighActivity**            | The activity level of a token meets the criteria to be classified as a good token.                                                                                                                                                                                                              |
| **HoneyPotShareDominance**  | A significant portion of the tokens in the airdrop were distributed to accounts that are Honeypot, indicating an unwarranted airdrop.                                                                                                                                                           |
| **TooManyHoneyPotOwners**   | The significant presence of Honeypots, such as Binance, Pranksy, vitalik.eth, among the token holders, which is a strong indication of unwarranted airdrops.                                                                                                                                    |
| **TooManyCreations**        | A token creator generated a vast quantity of unique tokens within a brief timeframe, a conduct commonly associated with spammy behavior.                                                                                                                                                        |
| **Erc721MultipleOwners**    | A single token in the ERC-721 collection has been transferred to multiple owners indicating fraudulent transfers. This action constitutes a direct violation of the ERC-721 standard.                                                                                                           |
| **Erc721NonUniqueTokens**   | An ERC-721 NFT collection contains numerous duplicate tokens indicating fraudulent behaviour.                                                                                                                                                                                                   |
| **Erc721FalseTotalSupply**  | A token contract lies about its token supply, as there is a substantial difference between the value obtained by running totalSupply() on the contract and the actual number of tokens in circulation.                                                                                          |
| **SilentMint**              | An account has somehow managed to spend more tokens than they possess. This may indicate an inadequately operating token contract that fails to emit Transfer events upon the mint of new tokens.                                                                                               |
| **SleepMint**               | As part of the airdrop, a fraudulent technique is used to create events supposedly about the transfers of tokens from some well-known account, such as Binance, OpenSea or accounts like vitalik.eth.                                                                                           |
| **PhishingMetadata**        | The metadata of an airdropped token contains a link to a website, and the token uses deceptive techniques to lure users to follow the link. These techniques include the use of keywords like "claim," "reward," and "activate," as well as incorporating an alleged token price into its name. |
| **TokenImpersonation**      | The metadata of the airdropped token replicates the name and symbol of an existing token identically.                                                                                                                                                                                           |
| **ObservationTimeIsOver**   | The token's observation period is over, indicating the completion of the token evaluation.                                                                                                                                                                                                      |

## Supported Standards

- ERC-20
- ERC-712
- ERC-1155

## Supported Chains

- Ethereum (1)
- BSC (56)
- Polygon (137)
- Arbitrum (42161)
- Optimism (10)
- Fantom (250)
- Avalanche (43114)

## 🚨 Alerts

- SPAM-TOKEN-NEW
    - Fired when a sufficient number of indicators are triggered, indicating the detection of a spam token
    - Severity: "low"
    - Type: "suspicious"
    - Metadata:
        - `tokenAddress`: the address of the detected token
        - `tokenStandard`: the standard implemented by the token, such as ERC-20, ERC-721, or ERC-1155
        - `tokenDeployer`: the account that deployed the token
        - `analysis`: a stringified object containing a simplified overview of each indicator's execution context
        - `confidence`: a value from 0 to 1


- SPAM-TOKEN-UPDATE
    - Fired when the confidence score is changed or when the previously identified signs of spam become irrelevant
    - Severity: "low"
    - Type: "suspicious"
    - Metadata:
        - `tokenAddress`: the address of the detected token
        - `tokenStandard`: the standard implemented by the token, such as ERC-20, ERC-721, or ERC-1155
        - `tokenDeployer`: the account that deployed the token
        - `analysis`: a stringified object containing a simplified overview of each indicator's execution context
        - `confidence`: a value from 0 to 1


- SPAM-TOKEN-REMOVE
    - Fired when the positive reputation indicators for a token outweigh the negative reputation indicators
    - Severity: "info"
    - Type: "info"
    - Metadata:
        - `tokenAddress`: the address of the detected token
        - `tokenStandard`: the standard implemented by the token, such as ERC-20, ERC-721, or ERC-1155
        - `tokenDeployer`: the account that deployed the token
        - `analysis`: a stringified object containing a simplified overview of each indicator's execution context

- PHISHING-TOKEN-NEW
    - Fired when the phishing indicator is triggered, indicating the detection of a phishing token
    - Severity: "low"
    - Type: "suspicious"
    - Metadata:
        - `tokenAddress`: the address of the detected token
        - `tokenStandard`: the standard implemented by the token, such as ERC-20, ERC-721, or ERC-1155
        - `tokenDeployer`: the account that deployed the token
        - `analysis`: a stringified object containing a simplified overview of the phishing indicator execution context
        - `urls`: a stringified array of urls detected in token metadata
        - `confidence`: a value from 0 to 1
      
- PHISHING-TOKEN-UPDATE
    - Fired when the confidence score is changed or when the previously identified signs of spam become irrelevant
    - Severity: "low"
    - Type: "suspicious"
    - Metadata:
        - `tokenAddress`: the address of the detected token
        - `tokenStandard`: the standard implemented by the token, such as ERC-20, ERC-721, or ERC-1155
        - `tokenDeployer`: the account that deployed the token
        - `analysis`: a stringified object containing a simplified overview of the phishing indicator execution context
        - `urls`: a stringified array of urls detected in token metadata
        - `confidence`: a value from 0 to 1
      
- PHISHING-TOKEN-REMOVE
    - Fired when the positive reputation indicators for a token outweigh the negative reputation indicators
    - Severity: "info"
    - Type: "info"
    - Metadata:
        - `tokenAddress`: the address of the detected token
        - `tokenStandard`: the standard implemented by the token, such as ERC-20, ERC-721, or ERC-1155
        - `tokenDeployer`: the account that deployed the token
        - `urls`: a stringified array of urls detected in token metadata

## 🏷️ Labels

- Spam Token
    - `entityType`: EntityType.Address
    - `label`: "Spam Token"
    - `entity`: token address
    - `confidence`: is a value of 0-1, calculated by the number of triggered indicators as well as secondary data such
      as number of recipients, number of active recipients, number of urls detected, etc.
    - `metadata`:
        - `indicators`: a stringified array of triggered indicators

- Spammer
    - `entityType`: EntityType.Address
    - `label`: "Spammer"
    - `entity`: address of token deployer
    - `confidence`: is a value of 0-1, calculated by the number of triggered indicators as well as secondary data such
      as number of recipients, number of active recipients, number of urls detected, etc.
    - `metadata`:
        - `indicators`: a stringified array of triggered indicators

- Phishing Token
    - `entityType`: EntityType.Address
    - `label`: "Phishing Token"
    - `entity`: token address
    - `confidence`: is a value of 0-1, calculated by the number of triggered indicators as well as secondary data such
      as number of recipients, number of active recipients, number of urls detected, etc.
    - `metadata`:
        - `urls`: a stringified array of urls detected in the token
        - `deployer`: the account that deployed the token

- Scammer
    - `entityType`: EntityType.Address
    - `label`: "Scammer"
    - `entity`: address of a phishing token deployer
    - `confidence`: is a value of 0-1, calculated by the number of triggered indicators as well as secondary data such
      as number of recipients, number of active recipients, number of urls detected, etc.
    - `metadata`:
        - `urls`: a stringified array of urls detected in the token
        - `token`: the address of the token deployed by the scammer

- Phishing URL
    - `entityType`: EntityType.Url
    - `label`: "Phishing URL"
    - `entity`: detected url
    - `confidence`: is a value of 0-1, calculated by the number of triggered indicators as well as secondary data such
      as number of recipients, number of active recipients, number of urls detected, etc.
    - `metadata`:
        - `token`: the token address containing the url
        - `deployer`: the account that deployed the token


## 🛠️ API

The Spam Detector produces labels which are available via Forta's GraphQL API.
The GraphQL API provides for incredible flexibility and customization for your specific use cases.

For accessing threat intel from the Spam Detector, it is recommended to query **labels** generated by this bot.

For an in-depth exploration of general API usage, please refer to [this resource](https://docs.forta.network/en/latest/api-reference/) 📚.

---

The bot constantly monitors tokens to evaluate their suspiciousness, which may cause some labels to disappear or appear
over time. The value of the `confidence` score may change.
It's strongly recommended to maintain a low caching time to ensure an up-to-date evaluation.

### Retrieve API key

This bot requires API key which can be obtained through the Forta UI.

A detailed, step-by-step guide generating your API key can be found [**here**](https://docs.forta.network/en/latest/api-keys/).

### How to Make Requests

For those seeking an interactive interface for constructing and testing queries, consider exploring the [API Sandbox](https://studio.apollographql.com/sandbox/explorer).

For a visual guide on the how to use the sandbox, please visit [Forta Docs](https://docs.forta.network/en/latest/api-reference/#api-sandbox).

---

### 🔒 Authorization

When querying the Forta GraphQL API directly, you must set the API key as a _Bearer_ token in the Authorization header
of your HTTP request. For example, if your API key is **_"abc123"_** your header would look like this:

```text
"Authorization": "Bearer abc123"
```

###  Query example

In the following example, we will execute queries to retrieve labels emitted by the Spam Detector Bot.

```graphql
query SpamQuery($input: LabelsInput) {
  labels(input: $input) {
    labels {
      label {
        metadata
        label
        entity
        confidence
        entityType
      }
    }
  }
}
```

To execute a query to retrieve bot data, it is necessary to specify the bot ID in the query variables.
This can be done by specifying the bot identifier in the `sourceIds` field.

Bot ID:
```text
0xd45f7183783f5893f4b8e187746eaf7294f73a3bb966500d237bd0d5978673fa
```

GraphQL variables:
```json
{
  "input": {
    "state": true,
    "sourceIds": "0xd45f7183783f5893f4b8e187746eaf7294f73a3bb966500d237bd0d5978673fa"
  }
}
```

To obtain info about a specific EOA or token address, you should specify the `entities` field:

```json
{
  "input": {
    "state": true,
    "sourceIds": "0xd45f7183783f5893f4b8e187746eaf7294f73a3bb966500d237bd0d5978673fa",
    "entities": ["YOUR_ADDRESS_TO_CHECK"]
  }
}
```

### Response format

The query will return an array of labels in the following format:

```json
[
  {
    "label": {
      "metadata": [
        "analysis={\n  \"TokenImpersonation\": {\n    \"detected\": true,\n    \"metadata\": {\n      \"symbol\": \"EТH\",\n      \"name\": \"EТH...\",\n      \"type\": 20,\n      \"impersonatedToken\": {\n        \"name\": \"ETH\",\n        \"symbol\": \"ETH\",\n        \"type\": \"coin\",\n        \"deployments\": {}\n      }\n    }\n  },\n  \"Airdrop\": {\n    \"detected\": true,\n    \"metadata\": {\n      \"senderCount\": 1,\n      \"senderShortList\": [\n        \"0x49a02899247e62b88a4cc8cee35478d3d584b67b\"\n      ],\n      \"receiverCount\": 481,\n      \"receiverShortList\": [\n        \"0x127908351272d72acd41dc429a947cdf3919b63f\",\n        \"0x132121b653e1e27703c4d12cc6d3c17a8c380d60\",\n        \"0xcb5833e9e914d59f923469495f546287221b2ae3\",\n        \"0x40952021786015d881591751ddfd40470b76f05e\",\n        \"0x79292309c47f7484355c0be8497c4af7f7f17597\",\n        \"0x475b3d080d7dec95b88b157c8d8dbc3d33187a9c\",\n        \"0x9a6c76f304ec9b6a6a3894895d79640a90a927fe\",\n        \"0x7726bdc25c1943e0804f5b557ea5c3a903e7f353\",\n        \"0xa4076fa027c9f3f6c739993fa6c867c3ad88b3fa\",\n        \"0x20718e57e71f673795bc981be521ea05ce7b7c20\",\n        \"0xf53eba28d85f950a086254fd51fd74595b321421\",\n        \"0x03989cc060653c3b4eaabf5de436aae8a4644e9a\",\n        \"0xbf4924820c8d0d7da4e959045a12c7e7c727c50c\",\n        \"0xe3651c3736f098e189a6164022f63cfcd9afccb4\",\n        \"0x558781cdafa0b701df93719582b8021b0f1acaa3\"\n      ],\n      \"transactionCount\": 354,\n      \"transactionShortList\": [\n        \"0x3eef7962b46d5f385ce86e304f7d54b5c7007d47fca677f120dccf01aa995e96\",\n        \"0xdf254e870c5b25b710bbb974aec6b16f09e76bb504a11733daa7706b6484270e\",\n        \"0xb2fe64ff1db32194b8e15461e6443d1621b945990599ed12d5a54413cfc8b1cc\",\n        \"0xc22573ed100a217168f033a79c7d91fc6d72d8e871e98ea38204f8a47e37ee9c\",\n        \"0xb301e1372d2ecaf4577f87876e60ee0e5e542379a7fdf0b558a692f181e5b6b0\",\n        \"0x9c8f3bd8c0a4acab68dab59c00a47e79d62639d853352cfe0d885b6204a21f59\",\n        \"0xabb918417fe5ecd31f591d63bf835d48b73a7d531120d458a291f2366b0abc8d\",\n        \"0x0014f00b5bd34783604a8a521113c1493be48fed11da056315417cf44944e6c9\",\n        \"0x49ec9da4c3157328d9a499e7800cc97b4afc1e53ba1823e8638d850cad3181db\",\n        \"0x07fa290defa4dbc30ef9becc4942adae1e114a4bc8ee3c3164e3afd643a892d6\",\n        \"0x1d1b5d427d476a48b8dfd393fb32f2ac79d4961a0084876249f8889f9bc1f8a8\",\n        \"0x9ba411a9b40e80f856482576f2c354852ae1079ed7824f49e34ddccdb479de11\",\n        \"0xb898f50493ac2494cc108c7e10ee710c042ed4dee80487168c5b99aef700a013\",\n        \"0x23ebc0e5077b9a9a52cd23efead28db4c632934888dbf3f45e7e7f0d7c56da76\",\n        \"0x3c87de4c431142778de7d68d01fc1b4651feb4462144e2a7a6df464fbf680584\"\n      ],\n      \"startTime\": 1696677047,\n      \"endTime\": 1696691351\n    }\n  },\n  \"TooMuchAirdropActivity\": {\n    \"detected\": false\n  },\n  \"LowActivityAfterAirdrop\": {\n    \"detected\": false\n  },\n  \"Erc721MultipleOwners\": {\n    \"detected\": false\n  },\n  \"Erc721NonUniqueTokens\": {\n    \"detected\": false\n  },\n  \"Erc721FalseTotalSupply\": {\n    \"detected\": false\n  },\n  \"SilentMint\": {\n    \"detected\": true,\n    \"metadata\": {\n      \"accountCount\": 264,\n      \"accountShortList\": [\n        {\n          \"address\": \"0x7a6ad5bdb1f15de7f5cbcd654d57d6a2be4b5967\",\n          \"balance\": \"-13560938660000000000\"\n        },\n        {\n          \"address\": \"0x5a3153d8cb1a0d5b44eae05b36aed89f33bd8fb9\",\n          \"balance\": \"-130624790569508256\"\n        },\n        {\n          \"address\": \"0x7927d9ce06d0f513760fde00e6b02840a19b23e5\",\n          \"balance\": \"-1216000000000000000\"\n        },\n        {\n          \"address\": \"0x6218ba4d9615e86f2c32e267dbab2ccdccb435de\",\n          \"balance\": \"-100000000000000000\"\n        },\n        {\n          \"address\": \"0x2cf30f2b8d20360c90ec11cb21c3d0370c2d318d\",\n          \"balance\": \"-334117891215074200\"\n        },\n        {\n          \"address\": \"0xba0f7d4067c1b0bb15fb6da2bf9ed3994e87f3c9\",\n          \"balance\": \"-5000000000000000000\"\n        },\n        {\n          \"address\": \"0x04db57a1756339389faa5689cb41f8586f26e6f1\",\n          \"balance\": \"-914177057812557136\"\n        },\n        {\n          \"address\": \"0xd4f418420c33043fb1632bbd49012274db180880\",\n          \"balance\": \"-2000000000000000000\"\n        },\n        {\n          \"address\": \"0x05dba926508b93f09258245aa6b2569f6f39da49\",\n          \"balance\": \"-60854272274185009\"\n        },\n        {\n          \"address\": \"0x163c8417fcd070d3ae91c266b1608ab37eb090d1\",\n          \"balance\": \"-1000000000000000000\"\n        },\n        {\n          \"address\": \"0x1a3b98735ca682f941f93d79735beacb41f60611\",\n          \"balance\": \"-500000000000000000\"\n        },\n        {\n          \"address\": \"0xd9d26ba4b3876ec1b5121cb0886c89b96c1eb30b\",\n          \"balance\": \"-150000000000000000\"\n        },\n        {\n          \"address\": \"0xc8419e4228b8508158d8fd31575c3ed0373b3583\",\n          \"balance\": \"-115759142757947928\"\n        },\n        {\n          \"address\": \"0x52fb13ec8de75ec423fcaaaabf2f2727403b96dc\",\n          \"balance\": \"-5500000000000000000\"\n        },\n        {\n          \"address\": \"0x446b3adcbebfec21fc2c295a60df9bd8ea270821\",\n          \"balance\": \"-558100170000000000\"\n        }\n      ]\n    }\n  },\n  \"SleepMint\": {\n    \"detected\": true,\n    \"metadata\": {\n      \"sleepMintCount\": 9,\n      \"sleepMintShortList\": [\n        {\n          \"from\": \"0x8753b79d7c566f6c7d3ad025790468120148c9c9\",\n          \"to\": \"0xd142d4ea9498fda3d2b36401bd55a0beb4adcdb6\",\n          \"sender\": \"0x49a02899247e62b88a4cc8cee35478d3d584b67b\",\n          \"txHash\": \"0xef91b20f06275e42b9da93c8a59d9d37b9c1997ced5da2e296908ae27e887dfa\"\n        },\n        {\n          \"from\": \"0x8753b79d7c566f6c7d3ad025790468120148c9c9\",\n          \"to\": \"0xcce9b69749164dd1d6bb73e534c0530c7006e065\",\n          \"sender\": \"0x49a02899247e62b88a4cc8cee35478d3d584b67b\",\n          \"txHash\": \"0xef91b20f06275e42b9da93c8a59d9d37b9c1997ced5da2e296908ae27e887dfa\"\n        },\n        {\n          \"from\": \"0x8753b79d7c566f6c7d3ad025790468120148c9c9\",\n          \"to\": \"0xd94aea60da4daf67bae7ec3f54cc32cac8f2b75c\",\n          \"sender\": \"0x49a02899247e62b88a4cc8cee35478d3d584b67b\",\n          \"txHash\": \"0xef91b20f06275e42b9da93c8a59d9d37b9c1997ced5da2e296908ae27e887dfa\"\n        },\n        {\n          \"from\": \"0x75cac24dad27da1e0d63b4baa85c5dd6ca984951\",\n          \"to\": \"0xd975a4a57d0160ef0e2f3926ab553d53da9aa862\",\n          \"sender\": \"0x49a02899247e62b88a4cc8cee35478d3d584b67b\",\n          \"txHash\": \"0x8f6e878c9f57a056818a5cee5b6c530ae02638d58266986e263d269f38d72ebb\"\n        },\n        {\n          \"from\": \"0x75cac24dad27da1e0d63b4baa85c5dd6ca984951\",\n          \"to\": \"0x2a46f1be6753c9648a95ce78849f94e0a4bd6a01\",\n          \"sender\": \"0x49a02899247e62b88a4cc8cee35478d3d584b67b\",\n          \"txHash\": \"0x8f6e878c9f57a056818a5cee5b6c530ae02638d58266986e263d269f38d72ebb\"\n        },\n        {\n          \"from\": \"0x75cac24dad27da1e0d63b4baa85c5dd6ca984951\",\n          \"to\": \"0xc9b4162eca8d41193a60fae226903e52eab422ff\",\n          \"sender\": \"0x49a02899247e62b88a4cc8cee35478d3d584b67b\",\n          \"txHash\": \"0x8f6e878c9f57a056818a5cee5b6c530ae02638d58266986e263d269f38d72ebb\"\n        },\n        {\n          \"from\": \"0x75cac24dad27da1e0d63b4baa85c5dd6ca984951\",\n          \"to\": \"0x0f88ecc759df137df63e8f840f71b957535e83cd\",\n          \"sender\": \"0x49a02899247e62b88a4cc8cee35478d3d584b67b\",\n          \"txHash\": \"0x8f6e878c9f57a056818a5cee5b6c530ae02638d58266986e263d269f38d72ebb\"\n        },\n        {\n          \"from\": \"0x75cac24dad27da1e0d63b4baa85c5dd6ca984951\",\n          \"to\": \"0x6617b1e5f7e35e9c3c1fbc3373739015b7088076\",\n          \"sender\": \"0x49a02899247e62b88a4cc8cee35478d3d584b67b\",\n          \"txHash\": \"0x8f6e878c9f57a056818a5cee5b6c530ae02638d58266986e263d269f38d72ebb\"\n        },\n        {\n          \"from\": \"0x8753b79d7c566f6c7d3ad025790468120148c9c9\",\n          \"to\": \"0xcfa8f095114de3beb97c42cfb39b37522e882781\",\n          \"sender\": \"0x49a02899247e62b88a4cc8cee35478d3d584b67b\",\n          \"txHash\": \"0xef91b20f06275e42b9da93c8a59d9d37b9c1997ced5da2e296908ae27e887dfa\"\n        }\n      ],\n      \"sleepMintTxCount\": 2,\n      \"sleepMintTxShortList\": [\n        \"0x8f6e878c9f57a056818a5cee5b6c530ae02638d58266986e263d269f38d72ebb\",\n        \"0xef91b20f06275e42b9da93c8a59d9d37b9c1997ced5da2e296908ae27e887dfa\"\n      ],\n      \"sleepMintReceiverCount\": 9,\n      \"sleepMintReceiverShortList\": [\n        \"0x6617b1e5f7e35e9c3c1fbc3373739015b7088076\",\n        \"0x2a46f1be6753c9648a95ce78849f94e0a4bd6a01\",\n        \"0xd975a4a57d0160ef0e2f3926ab553d53da9aa862\",\n        \"0xc9b4162eca8d41193a60fae226903e52eab422ff\",\n        \"0x0f88ecc759df137df63e8f840f71b957535e83cd\",\n        \"0xcce9b69749164dd1d6bb73e534c0530c7006e065\",\n        \"0xcfa8f095114de3beb97c42cfb39b37522e882781\",\n        \"0xd94aea60da4daf67bae7ec3f54cc32cac8f2b75c\",\n        \"0xd142d4ea9498fda3d2b36401bd55a0beb4adcdb6\"\n      ]\n    }\n  },\n  \"TooManyTokenCreations\": {\n    \"detected\": false\n  },\n  \"TooManyHoneyPotOwners\": {\n    \"detected\": false,\n    \"metadata\": {\n      \"holderCount\": 481,\n      \"cexCount\": 0,\n      \"honeypotCount\": 0,\n      \"honeypotShortList\": [],\n      \"cexShortList\": [],\n      \"honeypotRatio\": 0\n    }\n  },\n  \"HoneypotShareDominance\": {\n    \"detected\": false\n  },\n  \"PhishingMetadata\": {\n    \"detected\": false,\n    \"metadata\": {\n      \"name\": \"EТH...\",\n      \"symbol\": \"EТH\",\n      \"urls\": []\n    }\n  },\n  \"HighActivity\": {\n    \"detected\": false,\n    \"metadata\": {\n      \"senderCount\": 5,\n      \"senderShortList\": [\n        \"0x49a02899247e62b88a4cc8cee35478d3d584b67b\",\n        \"0xca3a9cf58aac23bc4d2ec1f94fa4d1ad37c16b75\",\n        \"0x1cc70219117fea65397cc1dabf144341f0488d58\",\n        \"0x17172c854ccec72c2767218aa493de77fa9b8f28\",\n        \"0x9b3ddffd864aa247752bebd70585187c7abf9ca6\"\n      ],\n      \"activeReceiverCount\": 0,\n      \"activeReceiverShortList\": [],\n      \"activeReceiverRatio\": 0,\n      \"startTime\": 1696676795,\n      \"endTime\": 1696691351,\n      \"windowPeriod\": 604800,\n      \"maxSenderCountInWindow\": 5\n    }\n  },\n  \"ObservationTimeIsOver\": {\n    \"detected\": false\n  }\n}",
        "deployer=0x49a02899247e62b88a4cc8cee35478d3d584b67b",
        "indicators=[\"TokenImpersonation\",\"Airdrop\",\"SilentMint\",\"SleepMint\"]"
      ],
      "label": "Spam Token",
      "entity": "0x7d670897d35891aa23611854404689a1f09eaae7",
      "confidence": 0.99,
      "entityType": "ADDRESS"
    }
  }
]
```


> Note: \
> As a result of the bot operating on multiple independent node scanners, you may encounter duplicated labels.


## 🐛 Testing

The bot includes a debug mode that enables you to scan for a specific token.
To activate this mode, you'll need to define the following variables prior to running the command:

```bash
$ DEBUG=1 TARGET_TOKEN="0x1234" npm run command...
```

By doing so, the bot will narrow its focus to the designated token, helping you troubleshoot any issues more
efficiently.

> It's important to note that when the bot is operating in debugging mode, it has been configured to restart scanning
> past transactions after every 10 blocks to ensure optimal performance. Consequently, if you need to scan a specific
> block that does not end with 0, you should round up the range accordingly.

--- 

Script to grab block numbers from Etherscan.com:

```js
const blockNumbers = [];
const onlyUnique = (value, index, array) => array.indexOf(value) === index;
document.querySelectorAll('#transactions > div > div.table-responsive > table > tbody > tr > td.d-none.d-sm-table-cell > a').forEach(el => blockNumbers.push(el.innerText));
console.log(blockNumbers.filter(onlyUnique).reverse().join(','))
```

---

#### ERC-20 Phishing token

https://etherscan.io/address/0xd202ec9D73d8D66242312495e3F72248e8d08d60

The bot will detect the spam token using the following command and publish the alert about it:

```bash
$ DEBUG=1 TARGET_TOKEN="0xd202ec9D73d8D66242312495e3F72248e8d08d60" npm run range 15673507..15673580
```

```
{
  name: 'Spam Token',
  description: 'The ERC-20 token (0xd202..8d60) shows signs of spam token behavior. Indicators: Airdrop, PhishingMetadata.',
  alertId: 'SPAM-TOKEN-NEW',
  protocol: 'ethereum',
  severity: 2,
  type: 2,
  metadata: {
    tokenAddress: '0xd202ec9d73d8d66242312495e3f72248e8d08d60',
    tokenStandard: 'ERC-20',
    tokenDeployer: '0x5e64b34a6cf0e335076f948deedd88541629901f',
    analysis: '{"PhishingMetadata":{"detected":true,"metadata":{"name":"$ 1000","symbol":"okchat.io"}},"HighActivity":{"detected":false,"metadata":{"senderCount":1,"senderShortList":["0x5e64b34a6cf0e335076f948deedd88541629901f"],"startTime":1664871179,"endTime":1664872067,"windowPeriod":604800,"maxSenderCountInWindow":1}},"Airdrop":{"detected":true,"metadata":{"senderCount":1,"senderShortList":["0x5e64b34a6cf0e335076f948deedd88541629901f"],"receiverCount":3000,"receiverShortList":["0xc692f82a1289291f950fce01932d625029e60d40","0xed160b68cd2fbe5cc5b8652adb73263ebe2851d2","0x4ac2513d0347dbfde6fec62e770a397b72690c3d","0xaa08d67ab615100dd58e32ff700206dc540687de","0xd9f7787f0847b2e18d98511cee72ca3bb1cdb261","0xb65467f8a50f4338aac315bf811e39daf1a76782","0xf278489e3d64a862ad34a078dc613aa0aa0bea75","0x40917f79192245fa82c119195f4b12cb47caddd8","0x9ee50411e1aaf3e3dcd8df153fde8a7c5f0e8190","0xc581481e5c1958855b5c5facc103cff8d110585a","0x79fc9e0add46996e84d0f20b7d4d8a78416b48a6","0xb2d864bbe6a09c16691d5e832c42b42fab420beb","0xf8efd62b7f6e397a387a7fb232a54fe8f59c6b2a","0x4a0db64b612d5f64b2e7dcbaa9ceda7f12a4e18a","0x9f1d10549dfbe5f43e2ed01e99222fc64fd4c402"],"transactionCount":1,"transactionShortList":["0xca2e248d1f752520228a653a80ac613b5029265953ee668a41af00e05af1daff"],"startTime":1664872067,"endTime":1664872067}},"TooMuchAirdropActivity":{"detected":false},"LowActivityAfterAirdrop":{"detected":false},"Erc721MultipleOwners":{"detected":false},"Erc721NonUniqueTokens":{"detected":false},"Erc721FalseTotalSupply":{"detected":false},"SilentMint":{"detected":false},"TooManyTokenCreations":{"detected":false},"TooManyHoneyPotOwners":{"detected":false},"HoneypotShareDominance":{"detected":false},"TokenImpersonation":{"detected":false,"metadata":{"symbol":"okchat.io","name":"$ 1000","type":20}},"ObservationTimeIsOver":{"detected":false}}'
  },
  addresses: [
    '0xd202ec9d73d8d66242312495e3f72248e8d08d60',
    '0x5e64b34a6cf0e335076f948deedd88541629901f'
  ]
}
```

#### ERC-721 Spam Token

https://etherscan.io/address/0x1b23215cf485b1638d117d321fd1d1d8da67d665

```bash
$ DEBUG=1 TARGET_TOKEN="0x1b23215cf485b1638d117d321fd1d1d8da67d665" npm run range 14576844..14576900
```

Running the command will cause the bot to publish two alerts. The first alert will report the initial detection of the
spam token, while the second alert will update the analysis as one more indicator has been triggered.

```
{
  name: 'Spam Token (Update)',
  description: 'The ERC-721 token (0x1b23..d665) shows signs of spam token behavior. Indicators: Airdrop, Erc721MultipleOwners, Erc721FalseTotalSupply, TooManyHoneyPotOwners. New: Erc721MultipleOwners.',
  alertId: 'SPAM-TOKEN-UPDATE',
  protocol: 'ethereum',
  severity: 2,
  type: 2,
  metadata: {
    tokenAddress: '0x1b23215cf485b1638d117d321fd1d1d8da67d665',
    tokenStandard: 'ERC-721',
    tokenDeployer: '0xa0469330844d8476169d82b239911c8495c038f1',
    analysis: '{"HighActivity":{"detected":false,"metadata":{"senderCount":2,"senderShortList":["0xa0469330844d8476169d82b239911c8495c038f1","0xcaea1c1fc4e0d3ca3cd7864d53bc99c37ae4b8ef"],"startTime":1649849140,"endTime":1649849765,"windowPeriod":604800,"maxSenderCountInWindow":2}},"Airdrop":{"detected":true,"metadata":{"senderCount":1,"senderShortList":["0xa0469330844d8476169d82b239911c8495c038f1"],"receiverCount":205,"receiverShortList":["0x11ce93e2e306f25221562014923d55aee867f53c","0x52a9768fa97864184f5afe1ad3d72c4e4e7dc126","0xa357f162fe9c383edeee81fbc905c4bc7fca166f","0x0acbde9ae4ef76f8735d6260f5a2e710ba0162a0","0xbf06231acdf0aa4a91768154e3e8b4aa752a5bde","0x8b2d16de6c99ea66e8d93a256cb3105d6e2a3ad9","0xb4aa65a290e189129f6f6418f7f68a81d3087696","0xb66e39960aa3e1f0e3ca4a7fb1214641358e7694","0x4db20f4db88149604908ce397e27714d51515255","0x7b6be4ebbc8450f5268586ab8ec9b1477324f183","0x0047878b7d01481ea0b48ceed14980fe83db7199","0xcb33844b365c53d3462271cee9b719b6fc8ba06a","0x31b0c4112a9aa5b79ca5883465bfc4cd013c6282","0x83b9711b4a5ea2a89606b4f0e4b0a0295b180ab1","0x6aadc6cdc8da615c2bf0396b8548d48093abef44"],"transactionCount":2,"transactionShortList":["0x95c4dfed72ce8e6503262aeb54b9b3cc3d21969785a13597513af3f774c11b8b","0x791b7b63ab21a3b5d591368db23380eba13774273e096387d1864daaeb35fa60"],"startTime":1649849681,"endTime":1649849765}},"TooMuchAirdropActivity":{"detected":false},"LowActivityAfterAirdrop":{"detected":false},"Erc721MultipleOwners":{"detected":true,"metadata":{"duplicatedTokenCount":24,"duplicatedTokenShortMap":{"1":["0xcaea1c1fc4e0d3ca3cd7864d53bc99c37ae4b8ef","0xe21dc18513e3e68a52f9fcdacfd56948d43a11c6"],"2":["0xcaea1c1fc4e0d3ca3cd7864d53bc99c37ae4b8ef","0x92f4937c03a5dd90f5382ea593c9f7f3ae1d23a5"],"3":["0xcaea1c1fc4e0d3ca3cd7864d53bc99c37ae4b8ef","0xabf107de3e01c7c257e64e0a18d60a733aad395d"],"4":["0xcaea1c1fc4e0d3ca3cd7864d53bc99c37ae4b8ef","0x0b8f4c4e7626a91460dac057eb43e0de59d5b44f"],"5":["0xcaea1c1fc4e0d3ca3cd7864d53bc99c37ae4b8ef","0xf476cd75be8fdd197ae0b466a2ec2ae44da41897"],"6":["0xcaea1c1fc4e0d3ca3cd7864d53bc99c37ae4b8ef","0xab6ca2017548a170699890214bfd66583a0c1754"],"7":["0xcaea1c1fc4e0d3ca3cd7864d53bc99c37ae4b8ef","0xae4d837caa0c53579f8a156633355df5058b02f3"],"8":["0xcaea1c1fc4e0d3ca3cd7864d53bc99c37ae4b8ef","0x5ea9681c3ab9b5739810f8b91ae65ec47de62119"],"9":["0xcaea1c1fc4e0d3ca3cd7864d53bc99c37ae4b8ef","0xc5f59709974262c4afacc5386287820bdbc7eb3a"],"10":["0xcaea1c1fc4e0d3ca3cd7864d53bc99c37ae4b8ef","0xb32b4350c25141e779d392c1dbe857b62b60b4c9"],"11":["0xcaea1c1fc4e0d3ca3cd7864d53bc99c37ae4b8ef","0xce90a7949bb78892f159f428d0dc23a8e3584d75"],"12":["0xcaea1c1fc4e0d3ca3cd7864d53bc99c37ae4b8ef","0x8c0d2b62f133db265ec8554282ee60eca0fd5a9e"],"13":["0xcaea1c1fc4e0d3ca3cd7864d53bc99c37ae4b8ef","0xc02f318365582557a482eb5d1834dfd7af4a3f59"],"14":["0xcaea1c1fc4e0d3ca3cd7864d53bc99c37ae4b8ef","0x63a9dbce75413036b2b778e670aabd4493aaf9f3"],"15":["0xcaea1c1fc4e0d3ca3cd7864d53bc99c37ae4b8ef","0x2ce780d7c743a57791b835a9d6f998b15bbba5a4"]}}},"Erc721NonUniqueTokens":{"detected":false},"Erc721FalseTotalSupply":{"detected":true,"metadata":{"declaredTotalSupply":24,"actualTotalSupply":222}},"SilentMint":{"detected":false},"TooManyTokenCreations":{"detected":false},"PhishingMetadata":{"detected":false},"TooManyHoneyPotOwners":{"detected":true,"metadata":{"holderCount":205,"honeypotCount":166,"honeypotShortList":[{"address":"0x11ce93e2e306f25221562014923d55aee867f53c","metadata":{"HardCodedAccount":{"detected":false},"HighBalance":{"detected":true,"balance":"757529590115119099415"},"VeryHighBalance":{"detected":true,"balance":"757529590115119099415"},"EnsRegistered":{"detected":true,"name":"7ge.eth"},"ManyTwitterFollowers":{"detected":false}}},{"address":"0x52a9768fa97864184f5afe1ad3d72c4e4e7dc126","metadata":{"HardCodedAccount":{"detected":false},"HighBalance":{"detected":true,"balance":"102207089017586423817"},"VeryHighBalance":{"detected":true,"balance":"102207089017586423817"},"EnsRegistered":{"detected":false},"ManyTwitterFollowers":{"detected":false}}},{"address":"0x0acbde9ae4ef76f8735d6260f5a2e710ba0162a0","metadata":{"HardCodedAccount":{"detected":false},"HighBalance":{"detected":true,"balance":"32379937671537896818"},"VeryHighBalance":{"detected":true,"balance":"32379937671537896818"},"EnsRegistered":{"detected":false},"ManyTwitterFollowers":{"detected":false}}},{"address":"0xb4aa65a290e189129f6f6418f7f68a81d3087696","metadata":{"HardCodedAccount":{"detected":false},"HighBalance":{"detected":true,"balance":"12007632900353475081"},"VeryHighBalance":{"detected":false,"balance":"12007632900353475081"},"EnsRegistered":{"detected":true,"name":"alexchen.eth"},"ManyTwitterFollowers":{"detected":false}}},{"address":"0xb66e39960aa3e1f0e3ca4a7fb1214641358e7694","metadata":{"HardCodedAccount":{"detected":false},"HighBalance":{"detected":true,"balance":"7676322250504914911"},"VeryHighBalance":{"detected":false,"balance":"7676322250504914911"},"EnsRegistered":{"detected":true,"name":"mandywang.eth"},"ManyTwitterFollowers":{"detected":false}}},{"address":"0x4db20f4db88149604908ce397e27714d51515255","metadata":{"HardCodedAccount":{"detected":false},"HighBalance":{"detected":true,"balance":"6622335044853677947"},"VeryHighBalance":{"detected":false,"balance":"6622335044853677947"},"EnsRegistered":{"detected":true,"name":"789.eth"},"ManyTwitterFollowers":{"detected":false}}},{"address":"0x7b6be4ebbc8450f5268586ab8ec9b1477324f183","metadata":{"HardCodedAccount":{"detected":false},"HighBalance":{"detected":true,"balance":"34507865700720247906"},"VeryHighBalance":{"detected":true,"balance":"34507865700720247906"},"EnsRegistered":{"detected":false},"ManyTwitterFollowers":{"detected":false}}},{"address":"0x0047878b7d01481ea0b48ceed14980fe83db7199","metadata":{"HardCodedAccount":{"detected":false},"HighBalance":{"detected":true,"balance":"1238035025131622351520"},"VeryHighBalance":{"detected":true,"balance":"1238035025131622351520"},"EnsRegistered":{"detected":false},"ManyTwitterFollowers":{"detected":false}}},{"address":"0xcb33844b365c53d3462271cee9b719b6fc8ba06a","metadata":{"HardCodedAccount":{"detected":false},"HighBalance":{"detected":true,"balance":"2366147331950737245086"},"VeryHighBalance":{"detected":true,"balance":"2366147331950737245086"},"EnsRegistered":{"detected":false},"ManyTwitterFollowers":{"detected":false}}},{"address":"0x31b0c4112a9aa5b79ca5883465bfc4cd013c6282","metadata":{"HardCodedAccount":{"detected":false},"HighBalance":{"detected":true,"balance":"203993280909392954878"},"VeryHighBalance":{"detected":true,"balance":"203993280909392954878"},"EnsRegistered":{"detected":false},"ManyTwitterFollowers":{"detected":false}}},{"address":"0x83b9711b4a5ea2a89606b4f0e4b0a0295b180ab1","metadata":{"HardCodedAccount":{"detected":false},"HighBalance":{"detected":true,"balance":"362505895909702133448"},"VeryHighBalance":{"detected":true,"balance":"362505895909702133448"},"EnsRegistered":{"detected":false},"ManyTwitterFollowers":{"detected":false}}},{"address":"0x6aadc6cdc8da615c2bf0396b8548d48093abef44","metadata":{"HardCodedAccount":{"detected":false},"HighBalance":{"detected":true,"balance":"329640737280329804346"},"VeryHighBalance":{"detected":true,"balance":"329640737280329804346"},"EnsRegistered":{"detected":false},"ManyTwitterFollowers":{"detected":false}}},{"address":"0x03bf7fd823908e56c8785e4c7ebfc46fc6a6e41b","metadata":{"HardCodedAccount":{"detected":false},"HighBalance":{"detected":true,"balance":"180293875529037495763"},"VeryHighBalance":{"detected":true,"balance":"180293875529037495763"},"EnsRegistered":{"detected":false},"ManyTwitterFollowers":{"detected":false}}},{"address":"0xe3e182bc39951f99af86d8cd0c42a4b7c4cd93f7","metadata":{"HardCodedAccount":{"detected":false},"HighBalance":{"detected":true,"balance":"9964707455051110527"},"VeryHighBalance":{"detected":false,"balance":"9964707455051110527"},"EnsRegistered":{"detected":true,"name":"good.eth"},"ManyTwitterFollowers":{"detected":false}}},{"address":"0x4299885e97668415cd67484d4a2c5214480ff76d","metadata":{"HardCodedAccount":{"detected":false},"HighBalance":{"detected":true,"balance":"281070354380925137064"},"VeryHighBalance":{"detected":true,"balance":"281070354380925137064"},"EnsRegistered":{"detected":true,"name":"zyrb.eth"},"ManyTwitterFollowers":{"detected":false}}}],"honeypotRatio":0.8097560975609757}},"HoneypotShareDominance":{"detected":false},"TokenImpersonation":{"detected":false,"metadata":{"symbol":"SMTH","name":"Something","type":721}},"ObservationTimeIsOver":{"detected":false}}'
  }
}
```

## About the Author

I am a web developer by training, and have been an active member of the Forta Community since its inception in the Fall 2021. 
I participated in several early bot development contests hosted by the Forta Foundation, and won four of them. In
the Summer 2022, I was approached by the Foundation about contributing to Forta in a more formal capacity. I entered
into an independent contractor agreement with the Foundation and have been participating in core development related
activities for the last year, including leading the redesign of the Forta Explorer and Bot Profile pages, and supporting
the development of the Attack Detector.

I also developed and maintained one of the most popular bots on the network, the Attack Simulation Bot, which is
currently used by the Forta Foundation’s Attack Detector.

## 🗄️ Data Sources

Token data provided by CoinGecko

## 📜 License

The bot is released under the [Forta Bot License](./LICENSE).
