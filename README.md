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
document.querySelectorAll('#transactions > div > div.table-responsive > table > tbody > tr > td.d-none.d-sm-table-cell > a').forEach(el => blockNumbers.push(el.innerText));console.log(blockNumbers.filter(onlyUnique).reverse().join(','))
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

## 🗄️ Data Sources

Token data provided by CoinGecko

## 📜 License

The bot is released under the [Forta Bot License](./LICENSE).
