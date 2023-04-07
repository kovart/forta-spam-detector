# Spam Detector Bot

## 💬 Description

This bot is equipped with advanced algorithms that analyze multiple indicators to detect spam tokens. These
indicators include token metadata analysis, compliance with declared token standards, distribution rationality, and
analysis of creator and recipient behavior. Additionally, the bot has the ability to adjust its assessment during token
monitoring, providing accurate and up-to-date detection of spam tokens.

## 🛠️ How it Works

The bot utilizes a modular system of indicators for analyzing tokens. The modules
are designed to detect both negative indications of spam and positive indications of a legitimate token.

Each module's result is recorded in the overall token analysis context, which can be used by subsequent modules.
Additionally, some modules can interrupt the execution of other modules and determine the final evaluation of the token,
i.e. `ObservationTimeIsOver` module.

The [TokenAnalyzer](./src/analyzer/analyzer.ts) interprets the final result of the modules and decides whether the
token is spam or not.
When spam is detected, the bot publishes an alert that includes information about the token and the context of the
modules used to evaluate it.
If there are changes during token monitoring, such as when a module finds additional signs of spam, the bot will publish
an update alert to indicate the changes.
If there is a change that alters the evaluation, such as when the bot no longer identifies the token as spam, it will
publish an alert instructing Forta Protocol to remove the labels that identify it as spam.

## 🕵️‍♀️ Modules

Here is a table containing all the indicator modules utilized in the project.

| Name         | Description |
|:-------------|:------------|
| **Airdrop** | A passive airdrop with no claim by the recipient of the mint (or transfer). The airdrop indicator considers the number of unique recipients, both within a single transaction and across multiple transactions during a specified time period. |
| **LowActivityAfterAirdrop** | A very few of the accounts that received a token had any interaction with the token after a massive distribution of the token. This behavior often indicates that the value of the token is low. |
| **TooMuchAirdropActivity** | There is a redundancy in the massiveness and duration of an airdrop. For instance, an airdrop that lasts for several months and affects many accounts, given the low token activity, is likely indicative of spam. |
| **HighActivity** | The activity level of a token meets the criteria to be classified as a good token. |
| **HoneyPotShareDominance** | A significant portion of the tokens in the airdrop were distributed to accounts that are Honeypot, indicating an unwarranted airdrop. |
| **TooManyHoneyPotOwners** | The significant presence of Honeypots, such as Binance, Pranksy, vitalik.eth, among the token holders, which is a strong indication of unwarranted airdrops. |
| **TooManyCreations** | A token creator generated a vast quantity of unique tokens within a brief timeframe, a conduct commonly associated with spammy behavior. |
|  **Erc721MultipleOwners** | A single token in the ERC-721 collection has been transferred to multiple owners indicating fraudulent transfers. This action constitutes a direct violation of the ERC-721 standard. |
| **Erc721NonUniqueTokens** | An ERC-721 NFT collection contains numerous duplicate tokens indicating fraudulent behaviour. |
| **Erc721FalseTotalSupply** | A token contract lies about its token supply, as there is a substantial difference between the value obtained by running totalSupply() on the contract and the actual number of tokens in circulation. |
| **SilentMint** | An account has somehow managed to spend more tokens than they possess. This may indicate an inadequately operating token contract that fails to emit Transfer events upon the mint of new tokens. |
| **SleepMint** | As part of the airdrop, a fraudulent technique is used to create events supposedly about the transfers of tokens from some well-known account, such as Binance, OpenSea or accounts like vitalik.eth. *Unfortunately, this module is temporarily disabled due to False Positives.* |
| **PhishingMetadata** | The metadata of an airdropped token features a link to a website, and the token employs deceitful tactics to lure users to follow the link. These tactics include the use of keywords like "claim," "reward," and "activate," as well as incorporating an alleged token price into its name. |
| **TokenImpersonation** | The metadata of the airdropped token replicates the name and symbol of an existing token identically. |
| **ObservationTimeIsOver** | The token's observation period is over, indicating the completion of the token evaluation. |

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


- SPAM-TOKEN-UPDATE
    - Fired when new indicators of spam are detected, or when the previously identified signs of spam become irrelevant
    - Severity: "low" 
    - Type: "suspicious"
    - Metadata: 
      - `tokenAddress`: the address of the detected token
      - `tokenStandard`: the standard implemented by the token, such as ERC-20, ERC-721, or ERC-1155
      - `tokenDeployer`: the account that deployed the token
      - `analysis`: a stringified object containing a simplified overview of each indicator's execution context


- SPAM-TOKEN-REMOVE
    - Fired when the positive reputation indicators for a token outweigh the negative reputation indicators
    - Severity: "info" 
    - Type: "info"
    - Metadata: 
      - `tokenAddress`: the address of the detected token
      - `tokenStandard`: the standard implemented by the token, such as ERC-20, ERC-721, or ERC-1155
      - `tokenDeployer`: the account that deployed the token
      - `analysis`: a stringified object containing a simplified overview of each indicator's execution context


## 📜 License

The bot is released under the [Forta Bot License](./LICENSE).
