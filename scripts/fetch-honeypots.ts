import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { load } from 'cheerio';
import { retry, delay } from '../src/utils/helpers';

const DATA_FOLDER = path.resolve(__dirname, '../data');
const OUTPUT_FILE_PATH = path.resolve(DATA_FOLDER, 'honeypots.json');
const TEMP_OUTPUT_FILE_PATH = path.resolve(DATA_FOLDER, 'honeypots.temp.json');

const SPAM_TOKENS = [
  '0x010d7618b6c2f6d926f0f41d2c97f6644300317d',
  '0x0474dccbec6603188a7efa029452c4751a15902d',
  '0x04844d3d90e5043e42adcbef54361ccb761a121c',
  '0x06f474f6a8d641135599d73a3e15057874146667',
  '0x0bef91e926f36fecc7ad6e304479de7b6baa631d',
  '0x0c216004f230f992b1c44f2786dad06877fcaeff',
  '0x0c8b5dc797a19680458503ec75773f13e159df30',
  '0x0d8374a5fc9464c17d8c31d0bedfb772330654cf',
  '0x0ed21db11e1a396bc65191acacb7ad3b9fa12b27',
  '0x0fe0d87b6f8c9a8789e9c24fcc2ec1e1d6f332f8',
  '0x1041189d043d4eb059cb1eb9cb1b931a60e911d4',
  '0x112465c698bfd3b02a308085f35b53bf8c56c558',
  '0x1273e2854f716c39f8657b9e41846e3acf253a76',
  '0x129d67bc60732cabcf9b6c244c5b0f886b9038b3',
  '0x131306995a56834de5e73ffafb5cddade47e5c4c',
  '0x135f95d26713342b1591eb3d97a20b6d65cba931',
  '0x1435c4fd5e7f61224225f4b0f84b26bb679f8110',
  '0x146e3162cdcba8cd936cecdd1f5aec2707c86e59',
  '0x1551a64bcd8625b73e9a782e588a69ee809d86fb',
  '0x167dc32a663801c4fedbf5ab2bf77e4fc74ebb89',
  '0x1753819488327ed86206d233e011fbae1f6634c9',
  '0x1768dcbbd2129fc4d4f2c08928c625ed9419e0ef',
  '0x1977fb0c0bc734fc328f6ff3262eb7eda2e389e5',
  '0x1a4446cbb21e73e2b2cc7d8acabdd7d60341a7ce',
  '0x1a6c9b69a44291e367dacd9afa6368ae4e48c391',
  '0x1a979587f872e7676cfbbd071236fc00112f06f2',
  '0x1c1cc4f76d8d7545846abe03ee289248a48a6ee5',
  '0x1c80e6560bf7f1730f3a7b4782cec6bf7c441f58',
  '0x206a7ace7ba20198949f93b1f081f75b27ee0c5a',
  '0x21842986d252eae5be0d166f5ee7ede5f0826a82',
  '0x21b61c35c513c05cc9e1ff2c90f0ba72aa003a10',
  '0x22f2b5a67d9c7a4fad62826279522a31dd44b772',
  '0x23868f6a65e10d6e9a23deab25f35cd120981323',
  '0x2388d2cde1ca4f34968f987def84d535c2ecde79',
  '0x239564075b77e63ff7d7bb277f7f8a5ce369a365',
  '0x23acb5a56f5f12ffc0ffe348c7c0ee619fc57a59',
  '0x2ac1d101e46793e0103f630ea1adf085d9ec3c1c',
  '0x2ddecbd5e8bb75cef900d4f37f9726163b4a6232',
  '0x2e6f0468566cd5b482b94a3522ff2ff23776ce9f',
  '0x2e8cd167f20208007acf4f1c133ac7526c071f35',
  '0x2f909abda705f4993ff8119d60db492e73b944f7',
  '0x2fd6faf5adb7f2c075fdfc0f0cbf054ef29b7be0',
  '0x323a461794d9be41a57003e42936b3a6455b5e56',
  '0x32456ce36bce17e6d5f36de1d5e5592cbb155fd3',
  '0x34dbf4d6f188642fd06c1075c16b80db0ee3d26b',
  '0x35fbe9f7038f846d62c0c30c418b18371ab8887d',
  '0x3d5aa37f50ae777fa40d2070e407d57d1aa1e6c6',
  '0x4002f973fc973f3211757aad66e1f58d3a44bd5c',
  '0x480e3d1070109cdbb1e940f14c6e2235ced54ac4',
  '0x487917fa99da8b2083b37b7fb44b9645e6a243d5',
  '0x4905a4e9ffb1c1bb8361540799a0a662f6d83fe8',
  '0x4969b709c8720ee57f5ae7eda7b6f73ec1c2c1bd',
  '0x4c3390671cd7f1a1ed44c84792fe9747d9a43fe1',
  '0x4e3649bc7bb0a1226fff9902881026b0717dced1',
  '0x509037060cfcc4d1e28e18ad137696285909b0ca',
  '0x51329edfc2275b9e9fcaa5da7dfa4c49f2d508f0',
  '0x522048d2a759f31d4dab80150c4dd1a888467216',
  '0x536f49c14350d74f2dd2991ab483278176513083',
  '0x552ea1b419d4ac9f5ec2048979b1eb29406ee6eb',
  '0x5664c087d849a2ce38b7c7c9ba7d0db47052014e',
  '0x58f9b7f307666865ecb69ba91b4df91278d56bba',
  '0x5a5ab07954317f2588c4a7788f60c05317b8053d',
  '0x5b0fd89e6033a5790266fa1ea84d4a221e7dde2b',
  '0x5b75f2be553751a2ae5008a36f6ccb7461c4045a',
  '0x5cc9872e2f89aa3b63be97f7da04c014a08466f8',
  '0x5d234bdfd43e6e1926095394d80c2190bf2fa877',
  '0x5e9af785aeee0241b09ab5c883e8f6b87cfc805d',
  '0x608b71f7ff1ed8cab9bcf91f13fbf8680e3a42a7',
  '0x611cd955eab705117443f30cb479b4b7c2e43666',
  '0x613bdae015d3b9da1298ccc51e2c0373294595db',
  '0x61f8c4b9b97def7a3a6b09ec08343af82c6603b8',
  '0x62fa58f995260bd904a41a6a31312b7b2ba21f17',
  '0x6322cff6b4a76baf1a25b85c237c70fd9284d18c',
  '0x649b5cc015460e0a5c12a9db1895f1bb2d230567',
  '0x65ac911d8c450ae00701af51cc1fa91c5c26e7ae',
  '0x6897aca9b866def1ce49c5bab949b888f9e73246',
  '0x6ab8381c2628cbb2b774f5ff3f13cd5efceca6ec',
  '0x6d541fdee76011a681d5c3e700ac86048dc4038f',
  '0x6de5579d354616f738142a4fd40ad25d3e81d068',
  '0x6e6f65401013c929fd0747b1465eb792996ef614',
  '0x6f0fd3fe93d7a6a6c7c2dd35a4505f213119aa9f',
  '0x6f3b1831aee01d0b79d3208bf9977415b5c124c5',
  '0x70732e7931eb621c13972f47dbbf3334476b28e7',
  '0x73538b222b60717d9c54756186ed25c3cf3da093',
  '0x73c3115107c7036a9feb0793a03c7e9b5f1ed03d',
  '0x7585234fc33091991b3f9939f41ed8ad8e5de8da',
  '0x7923a629bc32c28c4aee2314651b95646fc6cb90',
  '0x794a9ceb65bf8de804607a6ef60072c968314d7e',
  '0x7a4aa94027624135e9b6574fc79eeb30bb2972b0',
  '0x7ced1c7bf313d2a5bfb2c4012e3541c5a73b34e9',
  '0x7d96124df22d1e8c13c48d078c51cca1c4cc2f2a',
  '0x7fd0947bda0477871c6b4cc0f6257d1996773758',
  '0x8005a533ff460ba4682a5c890b08285f16009a0d',
  '0x809ce28362e5f51f75d22ceefd4170417e257c79',
  '0x81a4141738d72eacaecf5422070046b41909ae41',
  '0x828e770c4160a1de66302a3a5a00fd6d1dd00aaf',
  '0x844c5e575d9095adb68d85ed7067ed25fbe2992a',
  '0x8524c2312eaac849b20f9e8f36734ecae40e07e1',
  '0x858edb99c5eaa26e036b09482dfa677dd9df2aa0',
  '0x8680e863cf43089c377a5b1151ca158ed240c223',
  '0x8b43bf1b3dc6f0a162d7168e95bc0933cd9ced34',
  '0x8cee786d26f2c93c347dc2b42e5cc6139211163e',
  '0x90224a60436a228b151f3a8178c642073fd7fdef',
  '0x90daf3d623967eef84be224ea4b36890de153311',
  '0x95e4d136b2faee01a74877fc3eabdfa8f6421cb9',
  '0x96b97a374d15bda6483ddc8528e0fa7dba7cfb8e',
  '0x96bc521ab96aed521e921f542dfbbbdad5622856',
  '0x97d75b70bc8cd337d01be24ce12c19916ba22f77',
  '0x9c285f8e36313fade01a283ab591b3b18b36e50d',
  '0x9e2708c5c37d2a3820403cfb46d82b47f27424c0',
  '0x9e7e492c26f8bbd2e1c64486c27f023df19245bb',
  '0x9f5c7163648a299ce5da6b6aa07abb6d99109c3f',
  '0x9f731990e5e3fecb4a115ed66f1227171070f0c2',
  '0xa2e0aee9e32caba843ae7804f50b692f034367da',
  '0xa4b1f1e19a878449bfce12ffcaaf187244c55174',
  '0xa68b93742af9224d819445968907356a5e127707',
  '0xa6edad01bf197b0ff7c1a8a456731bd2081d6940',
  '0xa7dccae031228af33d581706b5904c2e2ef94d13',
  '0xaa902a0e9f75af51bd056507c14ed0464b02643c',
  '0xac3793d749f9469dc10a90bac90eeada570b3ac9',
  '0xae33e64f4aad7b909ba901135ce2007b7a990bf8',
  '0xae675e5cbc9a6534727ced0f0dc6f86a94a4622f',
  '0xaf0b9c5877837e4a0eae37e6f59c7506e320d7a6',
  '0xb06d152619195cb60bdf06ffc7e6e31cc2f25f27',
  '0xb0fd91b1b31a674e5fd09c7a73ca08ec2c63a3ae',
  '0xb1218b1e9d2057a4f5c85555327a348bce4bf6d8',
  '0xb65444540c94507f89c82a1db87219fcb3cbd3bd',
  '0xb6da95c1e2bfd903902a6206840139a8ef54f69d',
  '0xb83aab0391fe20fc61803fb03ac1c0c56c3d69d8',
  '0xb8899c04cb651b5f8313c0f6929a5a24b3bc943b',
  '0xb8dde5a49526f7643750937a2aa5f2108326a1e4',
  '0xba60a90d76d44819acb8452a9f89632d57f5692f',
  '0xbaee067711f7c3d8c70457440860b58560be17f2',
  '0xbcc8a7ad3964417dd3e84503091a76e0c5ee8d4f',
  '0xbd1196fbc38fea0151ee1e113ea93433983272d5',
  '0xbd5296fbca47aa911023c8c2a02fb7e47da9df91',
  '0xbd81c9b7207fab57dcfc78b2946886eef4eb78cd',
  '0xbdc3e1e99d3ec94d92c45441abc75666cbe64b98',
  '0xbe24db8c689b2058fb26f94e722ef84313edb15c',
  '0xbedca4221ffb546dc3206711d158b891e1f5e8a9',
  '0xbef0c074cf00733925295a068365374c887f6038',
  '0xc0dfe287e4e2033573f4897a283e031bc574d70b',
  '0xc1e0d4db5b1db4cdd044e60fef24c044aaad28d9',
  '0xc21550a7409497aa8b889841b65d4b7ecadab17e',
  '0xc28c00d9fd0922a1e8fcb02790bcd1771ff1514e',
  '0xc6d377cfc9a5262832ffd7d996f3920fc857b14c',
  '0xc7cccd2eade216aa59d54cb54fe3bc34d09cfd9e',
  '0xc8150e1c994e7433d879293615c83b3b6dd2e9c8',
  '0xc86452e53dd1fe47089e7ae78c94e43cce0db685',
  '0xc87ec5cb59f460fc5105ba3da43168a9d0b68e06',
  '0xcbb4bf96e396dfe6c78f47d8b8cf976426359027',
  '0xcd7e81dbf07af897e718a3588d50e173db5060bc',
  '0xd234d0ca09dfd0f2195b3e7038df218f33e96e6d',
  '0xd3956e2bbe38c74a61e22f3aef680055d90b3dc0',
  '0xd47b87992e83e30e3096200cf58d5a497c01b847',
  '0xd550e574f4d631fd77bcc83783e4dae23ff359b6',
  '0xd707898a34135ee9b00a49d93d25adcba359b9cf',
  '0xd8048d5087ad0e3d3e76030bd696d417c6fec87e',
  '0xd8cfdb6da7467dfaf6274168b50f5d8a470367e7',
  '0xde1cf48538a7ce96630f2cab23518cc14c3830ed',
  '0xdf984ce0cf9c7dbac9b0e595db7a4eeb043b94f4',
  '0xdfa35c211862ee3220542393b154291c60866942',
  '0xe110bb2265d8b14a4664143a6b15f182184ec75c',
  '0xe1e0ee5b2e4498921b451b6dff5ba2a296d76ea5',
  '0xe35af79aec8788457fd32116d6a3353a5db39b37',
  '0xe40c0395501b37e64390cdbe5f6b4d7cb56aebed',
  '0xe7182a5e91e18ce756bb237480703b5797434d0f',
  '0xe75ce59fe9eba5e910f2494bb44e062af08d6ab6',
  '0xea676760469b41b98fa66d222a4a342ca9ebbd4b',
  '0xec7bb89123cc661d22c4e861e525bafc3a25ea56',
  '0xed0439275ab6b9190e5fb1ead83f462d8d4a542a',
  '0xedba7530dcd55bf0e334379aedfb2f9deef7b52e',
  '0xf063279c0d5ebf459d220e7ff2d8863a0bb3533e',
  '0xf10902619c42271e31c19881f7536854b02af899',
  '0xf3c8238f3797d5e14c729d025eaaf2ae0c46f245',
  '0xf5fcde8e580c485de07fb2a4e39f2fb616f5f5cb',
  '0xf6682f9474ef2ae40587f0fbe65f8c659591afc6',
  '0xf6cd127a127e351c0e6157d802d25a332fd3dd49',
  '0xf812f02af3581b087fff04f2e48e5b5f2751d4b4',
  '0xf82ff5ece49b0fa65b5ab11fa236f50b82167d15',
  '0xfa015c0d473a294eb4788eb51da0d1e8d84e8f84',
  '0xfb4899869817003c1196299ae78a218e10cc5df8',
  '0xfec64651c8b441f2526b1a54febb2122124bf041',
];

const SCAN_PAGE_URL = 'https://etherscan.io/token/tokenholderchart/';

async function main() {
  const result: { [token: string]: string[] } = {};

  try {
    const previousTempResult: object = JSON.parse(
      fs.readFileSync(TEMP_OUTPUT_FILE_PATH, { encoding: 'utf-8' }),
    );
    for (const [token, addresses] of Object.entries(previousTempResult)) {
      result[token] = addresses;
    }
  } catch {}

  for (let i = 0; i < SPAM_TOKENS.length; i++) {
    const tokenAddress = SPAM_TOKENS[i];

    if (result[tokenAddress]) continue;

    console.log(`[${i}/${SPAM_TOKENS.length}] Parsing ${tokenAddress}...`);

    const addresses: string[] = [];

    const grabUrl = SCAN_PAGE_URL + tokenAddress + '?range=500';
    const { data } = await retry(() => axios.get(grabUrl), { wait: 15 * 1000 });

    const $ = load(data);

    const linkElems = $(
      '#ContentPlaceHolder1_resultrows > table > tbody > tr > td:nth-child(2) > div > span > a',
    );

    for (const el of linkElems) {
      const address = el.attribs.href.split('?a=')[1];
      addresses.push(address);
    }

    const ensElems = $(
      '#ContentPlaceHolder1_resultrows > table > tbody > tr > td:nth-child(2) > div > a.d-inline-flex.align-items-center > span',
    );

    for (const el of ensElems) {
      const address = el.attribs['data-bs-title'].split('<br/>')[1].replace(/[()]/g, '');
      addresses.push(address);
    }

    console.log(`[${i}/${SPAM_TOKENS.length}] Extracted addresses: ${addresses.length}`);

    result[tokenAddress] = addresses;
    fs.writeFileSync(TEMP_OUTPUT_FILE_PATH, JSON.stringify(result));

    await delay(1000);
  }

  const countMap: { [address: string]: number } = {};
  for (const addresses of Object.values(result)) {
    for (const address of addresses) {
      countMap[address] = typeof countMap[address] == 'number' ? countMap[address] + 1 : 1;
    }
  }

  const honeypots: string[] = [];
  for (const [address, count] of Object.entries(countMap)) {
    if (count > 30) {
      honeypots.push(address);
    }
  }

  fs.writeFileSync(OUTPUT_FILE_PATH, JSON.stringify(honeypots));

  try {
    fs.rmSync(TEMP_OUTPUT_FILE_PATH);
  } catch {}
}

main().catch((e) => {
  console.error(e);
  return 1;
});
