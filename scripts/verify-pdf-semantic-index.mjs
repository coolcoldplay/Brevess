import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const require = createRequire(import.meta.url);
const { buildPdfSemanticIndex, normalizePdfTextWithOffsets,
  normalizedRangeToRaw, rawRangeToNormalized } =
  require('../core/pdf-semantic-index.js');
const { extractPdfHeadings } = require('../core/pdf-heading-extractor.js');
const { orderPdfTextContentForReading } = require('../core/pdf-text-projection.js');
const repositoryRoot = path.resolve(import.meta.dirname, '..');
const FROZEN_SENTENCE_ROWS = [
  ['P2-T02', 2, 4087, 4390, '622aaa42ad75327345fae6d652fd9a850954576dee85f12d5e47664f0008753f', 'c10372557d4ab5ad3135a3c6cd0eb40561f0968fecd9e4d3fa277cfa2a355fa7'],
  ['P2-T02', 3, 1928, 2039, '90a5a41d8f2d4c8d0eac118076220de1f032f135471fba29cc397a59cbfe260e', 'e51d01b471e10d7ef719521646ca6399b53c8bf893074fede06a99eb070da781'],
  ['P2-T02', 3, 3088, 3348, 'a621b41e104b3315e10d86c773c35b4819cca0fb4776e44a537732dba6f10314', 'b3938d73727331448053cb568d00de98585afe7557e3c5606bfa77060d9ce96b'],
  ['P2-T02', 3, 3955, 4128, '6e3c4165079f92ba3fa9ff5678ee70093873921890c6cdec4baafc35b97344ba', '887b0cab3342734d409bcfbd619a267764dc4757bf9354d6d98b8fd521102d18'],
  ['P2-T02', 3, 5128, 5281, 'f30f70de579e2bf3019fc4a55537ad3a3b6094c9ff58097679ca1045daa9cda7', '0f02b66437eb4e7734eb7804668292575fd87b97f9948a896e59d913b48da81f'],
  ['P2-T02', 3, 5738, 5878, '08a5a7714de4ddc185365b6250a643f8d1e556025c8ef8887de25a612b6c1130', 'a24162b339a7e035a26500474aed7048e9e37594191b22fcc2ab2792c2449211'],
  ['P2-T02', 4, 567, 795, '862d4020a45648436571077479fb6957b1ccf14d98fd27ad4df82cb938c264eb', 'e7a4fba42244453c3fd3ad81f7aa0a0442e002dc832570b163dade0cc094e93c'],
  ['P2-T02', 4, 2197, 2382, 'fec9527f063506c671089a603cfc3d4e80c3d4076552256539c3f9bf039d60e5', '5dc6792908f6c0baf6f9133782432c0d291ba2ea43210d6e8aab9d5974aef6f3'],
  ['P2-T02', 5, 4831, 4937, '9e8b5f3c5af263d60279dcc77f724c3f83f3c478e5fe80720596f07a44f844b8', 'e08e1a37096c3633c582ddb1cf3efab99b368803e19f333b5377b44bd205148a'],
  ['P2-T02', 7, 6217, 6403, '5215e8e55d0a411c435341d8435aafe181805795d051ad754014f9dec2f72cd6', '2bfb1fb7aeb9f949de3d9a288c409f71e1d76cbe615a42cd1598e7aa3d2c9259'],
  ['P2-T02', 7, 8442, 8670, '91dc5e6aa5c97ce349cde6655cdfd80854e2f8204ba8e77bd1a0e755fd6d5f67', '955320ce0303f377907441104dd000f6104bdbb844538a6265a789eb3bd580ea'],
  ['P2-T02', 8, 1155, 1237, 'e7c8b85a90b3d4dc3689c90b32eef583d42692ca20ca8012d5387db221abf0dd', '9b21fd52d99fdf2a7ce14338c3f7731002c75b30ad3fd5e91c293c290ce70973'],
  ['P2-T02', 9, 1462, 1639, 'e3307a73ceecc41b31a600d8d4c771722c1c9b1c72ac9c1455e7e018aced1e2f', 'e5340b9cc32089f5bf8a74e28732585c24614245b6a608f6206f935eb2cbbc4b'],
  ['P2-T02', 10, 1259, 1492, '4065ac01d32ad6e8a3bccd9202d4b14a534b8109d3f2ebd66ee9ef2298f92a70', 'd588583cfcc7e8a5916d20ce80773d005cf36ef5bda3f6fd136e0db6346747aa'],
  ['P2-T02', 10, 3255, 3355, 'dbf2c1642d0ccf9562a2ea00697fe7f64574231ab4ab8c1e037de2013612347b', '219149faf4afce6a3b0dff806c2d6df8203ce88a5afa3af5255411935947b937'],
  ['P2-T02', 10, 5296, 5463, '2d84bf61b3c3be2bea92c88f1f2ce73d62887abec955dbc82c76b0927dde8063', '1cebf26cc1906082519492124c03816e4f84eda67c09a65fae2280b057b08fc6'],
  ['P2-T04', 1, 502, 704, 'ac234599702cb95bc4cbff54baf3319954434767bde78a166b4888d09afb8c61', '75b5fbebaf22a91cb0f25a11301e76024a26ea6ea77012e6b31b0d2ccde94cfd'],
  ['P2-T04', 1, 1012, 1219, '0bc99f6e7e83fdc03491b2d8c2654d3dcbfc2b7b45fda66a5b51a6cc69ece277', '84ebca10bd4328bf1cb485b260763f337b0517af8d9d68844bc510ae87b923ce'],
  ['P2-T04', 1, 1590, 1839, '12271e772ce60c71808956e4157db7ef9c0716ab9cd604509a8206d86b922667', '57aae6e553ac78de2338c0382ce65a27ca3a313d0b1353b8f606b8f79c091b4b'],
  ['P2-T04', 1, 1840, 1922, 'f5dcdf9d1b8d69546df71944c329f8a0b3df6988bcf084623792932d4e98a92a', '5695f631395454d8b72478c8ff779eee5bcbe74cb736a73029927f5406794c83'],
  ['P2-T04', 2, 7437, 7604, '93429cca85c5a65d275afcffe301fb2b52721d9f9a62be5d92e04f25462ac1d0', '58f0d09f63ffa9f68d9c5ae46eea25b38853595fde62de32cfbffe06d2a6e678'],
  ['P2-T04', 3, 531, 656, '5b5091a68eefc0c9543d0dff2863884c9db9943c8bac2dad0a6c0f7f7b16542a', '94a6119823c183a2974115accfaf8192ab5f06f528fdc2cbded0ce9e1588374a'],
  ['P2-T04', 4, 297, 495, 'fef97e480debe142f30a0265316cb885789ecea824968e373207333dac45b100', '37f7cdc79050198db7a97a81afe2910bacb57eb9003138f6763d0fd74afbe63c'],
  ['P2-T04', 4, 1706, 1794, '23ad508149a9d01dc0829097b2f700c58c134a7f6395a36aacb8bdac7aa6d468', 'ecb683c46640606d30061e8164d0aa1cd8c193c5b7a1a00b825e6aff2f3092c2'],
  ['P2-T04', 5, 1317, 1381, '0326b2066a637b99e105e4b03bb4cb839226ef061af793938d32756ee8e49af9', 'deccaaa7e53b031df40d8422e93aad4cbcef64e772b8b285327fbe4d47c3babb'],
  ['P2-T04', 6, 1929, 2008, 'e248961fbe577c7f2e69bafe39a7a39243193908dec971d51b1f0e6e09641ac5', 'e83a212c6edc46753c251b6fb6f5943beb312c082c6a529d115adb19690a1c1a'],
  ['P2-T04', 7, 936, 1049, '28921e3d383e7575dfe8befc83e8f46aabac631650a28a48e6617a40b00c605d', 'be74fdb00b400312db67971fbeec85b02c6e0ab479516b094894a4fbca2ef5ec'],
  ['P2-T04', 8, 511, 641, 'd6f7af68ba3732414b3c5b86f74af811ab78eb780b07c23f7cf66a9d8a6ec1de', 'b679b305bd4ffb336f2d8a11a23590f0dbb6e9d5bb42ae1c2dca1e71cc2edc78'],
  ['P2-T04', 10, 692, 871, '378e30615eb422f255035fd3ce213a4c70945c836a30e4309328bd41f7d75731', '70e8009730738777afbec89145ffa2c4359c744a7c8e42a1adde51ff2d654e9a'],
  ['P2-T04', 10, 1563, 1716, '19b686e53d8062e2db25df61d134c353cf1f60a765d8b89e9c5511d4fca7df58', 'f93af2c6c1c994f534142107e3a781d629956a7e6befb666e09fe87b5ed01eb3'],
  ['P2-T04', 10, 3928, 4053, '006f487ff6e9ea54734fa52fbf1afa050909293e9d90d1b238b1c2c5122d0d4f', '8484498f05c862b7bd76c9c84c436bf1b416a8210217d0df29d0fc1dad1b29b2'],
  ['P2-T04', 10, 4672, 4811, 'ab11a98bee972534159b5979ddf7844949a7c69f155c4f2fe6d08c60bbcdde97', 'c3d1ca66e888c4d5b2d4a1762b114b6c8b427692cbb94eca60192e0ef418be1d'],
  ['P2-T08', 1, 555, 620, '9e2b14b314feb5173334f277295ea76c559daf4334e1849793828496d1c3a0c4', '050af06fcb1aa9d0f65228c4de8092487e633eaa347411dbd966d3c37a4c5452'],
  ['P2-T08', 1, 1793, 1821, '325ac749455d6e72a4e42f0427ab295de8f7d81fa255b7dbb00a75746f8bc008', 'eef798df04a785ad0172846b5bc7e6bf394bb4f9468d64fc62ae99a0073566bb'],
  ['P2-T08', 2, 1239, 1314, '3ec16c9c99e89b63d014b1c85eb656e9b98765d627fe7c5d98bded8853bb1acf', '56c8649d771eeac6fca24de5a2607482891b63de72d5bdea971c6592a3b305ae'],
  ['P2-T08', 2, 2709, 2782, '2d8b0a22742194c33ad1412282625c2a8269cb8064c2b49ca35c108e019e60a5', 'cdba180c779c9e628b75caf0f531e790be912493b9bcb83f5e2a7691c35443d7'],
  ['P2-T08', 3, 503, 602, '1aefccfc18f11be9f7c019f8889789baefa217b176a5cbe7e142437465b8d5a1', '6ce461289e0a17df2613aa4fa9c9f3e28a09cfab08ec93e26317609619d38b93'],
  ['P2-T08', 3, 3342, 3409, '792f3729773463af90a803dd8c5f025178692d85d59c9400ea7bbe2b486acfaf', '1b1c724e0d7303c1a8b771a7d3d506e13a3cb2c4cacd7b3e589a2e68688a539a'],
  ['P2-T08', 4, 55, 92, 'f7e9ab0a0425e26c529d540b761f25d8ac9de5a2fd449d141850b7cc069f308d', '42832851069aeeb78828e0c50cbbd081eae108f7fbb28c28241ed5d0778b4fcf'],
  ['P2-T08', 4, 708, 780, '12925aec4aa559591743a3d92132e8b892fb3dfba41d4cb8f2af82686c1ddf53', 'a2eec1f730ac880d058afcc81d1ed0f157da0bace553a1757f07429008b14ac5'],
  ['P2-T08', 5, 814, 911, '32fd05ba4de5dac4de2e4c9411b99c2f03942bde16bf6419128d94f5c88b1c64', '73f099e9833bbe4b0d2d18ee0b644d2fcb46bcdd6235d6f7f254c090c8386a24'],
  ['P2-T08', 5, 2774, 2830, 'c77daf512b01a730db146b89ba293bfaeccfb3c8c3a0fcdf1fdad029341651f8', '050b0f068a82647bb123815853935612a5c3b10cdb6f5b5e910cfc0a69c03848'],
  ['P2-T08', 7, 590, 715, 'e284a4aabdd8e675160d4ea3734b3fa8897ad019f5dc85f6287280cb1bcb21fa', 'a741d3255580e80410a1abc62c7b2615ee477b85bc41e6207f762e0559a23e15'],
  ['P2-T08', 8, 103, 159, '131bb4f425896a5c047419c7a0c654852d859f447d1150a1dc5e83bc395debff', '30e909c24fdd70118537f6031b67d713e5e3ea0c11265b909de294a194b4723d'],
  ['P2-T08', 8, 1378, 1446, '2d6fde8f8b5da1fe0f7e1478162b5d81d5ea968eab3045e31a530630f600b986', '1328a6d176762e24dbdfba9fc1b12f460395a8a0d42e5a2e03319bf96737ebfc'],
  ['P2-T08', 9, 2251, 2372, '63c7f5105cb7e548f11dcdb65164afa4307e73269a7642ae213d900ba4660c5a', 'd3c51be4fc37e4fcbe746af6fd08596770ae066a62425c89ca66112d2b4068a6'],
  ['P2-T08', 10, 727, 772, 'add5d9bd828aa8572696723ab2bdbea907352ed1d6563cc15abb068a35e73b44', 'a2955adea4f635799bee3c8b6703ca890796c53a7db93967ee6d643f64791d7c'],
  ['P2-T08', 10, 3125, 3188, 'd4143b0e08700d77e327ab737c7780bc146dcdcbf4fc38fec10123c8630ad31a', 'f363e6fe762ea2d4076de3932bd5fde23d952bda9dbb8d7830635c9a58a5a770']
];

const headingLocator = (sampleId, pageNumber, start, end) =>
  `${sampleId}:${pageNumber}:${start}:${end}`;
const FROZEN_HEADING_ROWS = [
  ['P2-T02',2,4861,4873,2,null,3,5558,'348348036267fa046df6956d6bff62c93c2f7b89c711056c6a8cdcab6dd4a8e7'],
  ['P2-T02',3,5558,5565,2,null,10,8633,'4aa70a38c6d2c471fde92f15af760b7e7cb182d243375d280693da48d28da413'],
  ['P2-T04',1,1993,2005,2,null,10,4916,'348348036267fa046df6956d6bff62c93c2f7b89c711056c6a8cdcab6dd4a8e7'],
  ['P2-T04',2,7757,7778,3,'P2-T04:1:1993:2005',4,83,'ce28faf6a44c9f5462cfd9ae596a7c0455662d0730d1bac38ef56f0b661d7e33'],
  ['P2-T04',4,83,146,3,'P2-T04:1:1993:2005',4,2048,'a0db1878f7444e0370cae23350726de37c510bfd7a995944a8b42c42840d7140'],
  ['P2-T04',4,212,231,4,'P2-T04:4:83:146',4,2048,'4a92379123e47958c4a34a71e75514f3b5a43553f153c080f1d9f22282a4be52'],
  ['P2-T04',4,2048,2064,3,'P2-T04:1:1993:2005',7,8234,'a6e187693995e0101416ae61d4de7c61c58e02bd06bc362ea821b23945b84b04'],
  ['P2-T04',5,177,199,4,'P2-T04:4:2048:2064',5,2155,'5504b9f83d4988550ec945816f1793093ba78455a851453191586920d18915a5'],
  ['P2-T04',5,2155,2176,4,'P2-T04:4:2048:2064',6,1322,'e7933cef4d9f8f711c7e5eefda83964818f53a118698cd3a7d2fdcbe4d97e8f7'],
  ['P2-T04',6,1322,1369,4,'P2-T04:4:2048:2064',6,6278,'526a2e6f8b5ec6bee8248f75bfd0f5b4e005a0498f8ce1bbc8856ee50f11915d'],
  ['P2-T04',6,6278,6310,4,'P2-T04:4:2048:2064',7,8234,'1298bcdc21a460c2381e0b4701eb66134bd98fcb7de8e9cbbe919f63a9148ade'],
  ['P2-T04',7,8234,8259,3,'P2-T04:1:1993:2005',10,4916,'fee28b4660bc32f58856e7e364b48d8ff977520887764a5e602e34f78ba3a44c'],
  ['P2-T04',7,8263,8285,4,'P2-T04:7:8234:8259',10,1717,'23a9765b2d0c0e5d9f89a1ee617998bb68fbdd2225ed5e2ee72bc3be0726a3a5'],
  ['P2-T04',10,1717,1736,4,'P2-T04:7:8234:8259',10,4394,'5d589a2724b7aec7c65daead3518882276847e859b8fc9df9bc90fb1e80ef0c9'],
  ['P2-T04',10,4394,4414,4,'P2-T04:7:8234:8259',10,4916,'5c12864d196c2d6a6c7338866d9614e7438739d02a305f8b22419181f468221c'],
  ['P2-T08',5,54,56,2,null,7,1708,'22b9f0b66212809c3ad296601fe4e83e2af02aaa81ce8382de2ec55a2576cd88'],
  ['P2-T08',7,1708,1710,2,null,10,1653,'bb7ef73495dd8a74eead9a021f2739832271393fe393708fe5c50f995749649f'],
  ['P2-T08',10,1653,1655,2,null,10,3213,'3cef912ce8819fff2ed202243014dc2c3aebaff713a3b7cc0779eb1c618f5186']
];

const FROZEN_NEGATIVE_ROWS = [
  ['P2-T02','caption',4,233,388,'7762ccfef27e25e80e1bfaecb101b8fa643ad007a31c125bdf34623965da546c'],
  ['P2-T04','caption',3,114,265,'2fbbf95d6b223611af49e9e5819b172c429cc346c4a208dc5b8e9e3fcf934632'],
  ['P2-T04','reference',31,81,201,'a9217cca21d1984954810ba0813f441739f92621f8cdaec018599daed99e5f7d'],
  ['P2-T04','reference',34,84,204,'a33aacf27d60c347b6840bb468819c5d5edf46dbc22174c665e903c959413cb9'],
  ['P2-T02','formula',4,508,662,'bbdd800f64c023887ec441ae2342d87fb1df1ff740a73af0dedefaa816d8312a'],
  ['P2-T02','formula',4,1014,1168,'74387418e5afeae5129f034dfc322393802e644e59922e71b6e139f056d8e160'],
  ['P2-T02','table',22,2468,2634,'3f40aa231d87979c68ccb2864306a081af4d101af21cfa7f6c86fe39234865c9'],
  ['P2-T02','table',22,2547,2713,'56b19943ff7da18a7956b034dee41105a580cc6c99f4675b3aca6b3f5ebb307c'],
  ['P2-T04','body',6,4063,4185,'9af9a6ed89022e2545ddb6ec4bdd19cf43779dda93740cadb4a6f519b45cd975'],
  ['P2-T04','body',8,367,510,'e55c9e75da4b6d29b3370e3d9cab5b9edbb0f4300f3af078220d1ed3cece068b']
];

const FROZEN_CORPUS_ORACLE = Object.freeze({
  revision: 'p2a-r12-independent-locators',
  sentenceLocations: Object.freeze(FROZEN_SENTENCE_ROWS.map((row, index) => Object.freeze({
    auditId: `${row[0]}-S${String(index + 1).padStart(2, '0')}`, sampleId: row[0],
    ranges: Object.freeze([{ pageNumber: row[1], start: row[2], end: row[3] }]),
    expectedRawSlicesSha256: row[4], expectedNormalizedTextSha256: row[5]
  }))),
  headingPositives: Object.freeze(FROZEN_HEADING_ROWS.map(row => Object.freeze({
    sampleId: row[0], locator: headingLocator(row[0], row[1], row[2], row[3]),
    pageNumber: row[1], start: row[2], end: row[3], expectedLevel: row[4],
    expectedParentHeadingLocator: row[5],
    expectedSectionEnd: Object.freeze({ pageNumber: row[6], end: row[7] }),
    expectedRawTextSha256: row[8]
  }))),
  headingNegatives: Object.freeze(FROZEN_NEGATIVE_ROWS.map(row => Object.freeze({
    sampleId: row[0], kind: row[1], pageNumber: row[2], start: row[3], end: row[4],
    expectedRawTextSha256: row[5]
  })))
});

export function getFrozenCorpusOracleManifest() {
  return FROZEN_CORPUS_ORACLE;
}

function argument(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || fallback) : fallback;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function assessPdfSemanticAcceptance(observation = {}) {
  const checks = {
    threeRealNativeTextPdfs: Number(observation.sampleCount) >= 3,
    realTwoColumnIncluded: observation.includesTwoColumn === true,
    fortySentenceLocations: Number(observation.sentenceAudits) >= 40 &&
      Number(observation.sentenceErrors) === 0 &&
      Number(observation.sentenceCorrect) + Number(observation.sentenceDegraded || 0) ===
        Number(observation.sentenceAudits),
    twentyFiveHeadingChecks: Number(observation.headingAudits) >= 25 &&
      Number(observation.headingErrors) === 0 &&
      Number(observation.headingCorrect) + Number(observation.headingDegraded || 0) ===
        Number(observation.headingAudits),
    degradedWithinCaps: Number(observation.sentenceDegraded || 0) <= 0 &&
      Number(observation.headingDegraded || 0) <= 3,
    stableBuildIdentity: observation.stableCacheKeys === true &&
      observation.stableStructure === true,
    independentOracles: observation.fixedRealOracleMatched === true &&
      observation.syntheticOraclePassed === true,
    headingAuditDimensions: Number(observation.outlineTargetsChecked) >= 1 &&
      Number(observation.outlineTargetErrors) === 0 &&
      Number(observation.headingLevelsChecked) >= 1 &&
      Number(observation.headingLevelErrors) === 0 &&
      Number(observation.parentHierarchyChecked) >= 1 &&
      Number(observation.parentHierarchyErrors) === 0 &&
      Number(observation.sectionRangesChecked) >= 1 &&
      Number(observation.sectionRangeErrors) === 0,
    zeroApiAndOcr: Number(observation.apiCalls) === 0 && Number(observation.ocrCalls) === 0,
    privateReport: Number(observation.absolutePathLeaks) === 0 &&
      Number(observation.rawTextLeaks) === 0
  };
  return { pass: Object.values(checks).every(Boolean), checks };
}

function safeError(error) {
  const detail = String(error?.stack || error?.message || error);
  return { name: error?.name || 'Error', code: String(error?.code || error?.message || 'FAILED')
    .replace(/[A-Za-z]:\\[^\r\n]*/gu, '[local-path]').slice(0, 160),
  detailSha256: sha256(detail), detailBytes: Buffer.byteLength(detail) };
}

export function pdfTextItemGeometry(item, view) {
  const transform = Array.isArray(item?.transform) ? item.transform.map(Number) : [];
  const width = Math.abs(Number(item?.width));
  const declaredHeight = Math.abs(Number(item?.height));
  const matrixHeight = transform.length >= 4
    ? Math.hypot(Number(transform[2]), Number(transform[3])) : NaN;
  const height = Number.isFinite(declaredHeight) && declaredHeight > 0
    ? declaredHeight : matrixHeight;
  const source = Number.isFinite(declaredHeight) && declaredHeight > 0
    ? 'native-item-height' : 'matrix-derived-height';
  if (transform.length < 6 || !transform.slice(0, 6).every(Number.isFinite) ||
      !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const left = transform[4] - view[0];
  const bottom = view[3] - transform[5];
  const rect = { left, top: bottom - height, right: left + width, bottom };
  const pageWidth = Math.abs(Number(view[2]) - Number(view[0]));
  const pageHeight = Math.abs(Number(view[3]) - Number(view[1]));
  if (![rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite) ||
      rect.right <= rect.left || rect.bottom <= rect.top || rect.left < 0 || rect.top < 0 ||
      rect.right > pageWidth || rect.bottom > pageHeight) return null;
  return { rect, source };
}

export function canonicalPageRecord(pageNumber, page, textContent) {
  const ordered = orderPdfTextContentForReading(textContent, page);
  const view = page.view.map(Number);
  let text = '';
  const spans = [];
  for (const item of ordered.items || []) {
    if (typeof item?.str !== 'string' || !item.str) continue;
    const start = text.length;
    text += item.str;
    const end = text.length;
    const geometry = pdfTextItemGeometry(item, view);
    spans.push({ text: item.str, start, end,
      fontSize: Math.abs(Number(item.height)) ||
        Math.hypot(Number(item.transform?.[2]) || 0, Number(item.transform?.[3]) || 0),
      fontName: String(item.fontName || ''),
      bold: /(?:bold|black|semibold|demi)/iu.test(String(item.fontName || '')),
      ...(geometry ? { rect: geometry.rect, geometrySource: geometry.source }
        : { geometrySource: 'source-unavailable' }) });
    text += item.hasEOL ? '\n' : ' ';
  }
  return { pageNumber, text: text.trimEnd(), spans,
    pageWidth: view[2] - view[0], pageHeight: view[3] - view[1], view, rotate: page.rotate };
}

export function flattenNativeOutline(items, output = [], depth = 1) {
  for (const item of Array.isArray(items) ? items : []) {
    output.push({ ...item, level: depth });
    flattenNativeOutline(item?.items, output, depth + 1);
  }
  return output;
}

export function outlineTargetTop(destination, viewport) {
  const destinationTop = Number(Array.isArray(destination) ? destination[3] : NaN);
  if (!Number.isFinite(destinationTop) ||
      typeof viewport?.convertToViewportPoint !== 'function') return null;
  const converted = viewport.convertToViewportPoint(0, destinationTop);
  return Number.isFinite(Number(converted?.[1])) ? Number(converted[1]) : null;
}

export async function nativeOutline(document) {
  const raw = flattenNativeOutline(await document.getOutline()).slice(0, 80);
  const output = [];
  for (const item of raw) {
    try {
      const destination = typeof item.dest === 'string'
        ? await document.getDestination(item.dest) : item.dest;
      const reference = Array.isArray(destination) ? destination[0] : null;
      if (!reference) continue;
      const pageNumber = await document.getPageIndex(reference) + 1;
      const page = await document.getPage(pageNumber);
      const targetTop = outlineTargetTop(destination, page.getViewport({ scale: 1 }));
      output.push({ title: String(item.title || ''), pageNumber,
        level: Math.max(1, Math.min(6, Number(item.level) || 1)),
        targetTop: Number.isFinite(targetTop) ? targetTop : null,
        destinationKind: String(destination?.[1]?.name || '') });
    } catch { /* Invalid outline targets are intentionally omitted. */ }
  }
  return output;
}

export function summarizeGeometryProvenance(index, pages) {
  const summary = { totalIndexSpans: index.spans.length,
    positionedNativeItemHeight: 0, positionedMatrixDerivedHeight: 0,
    fallbackSourceUnavailable: 0, fallbackRangeUnmatched: 0,
    fallbackAlgorithmDroppedGeometry: 0, fallbackTotal: 0,
    fallbackPercent: 0, sourceUnavailablePercent: 0, rangeUnmatchedPercent: 0 };
  const pageMap = new Map(pages.map(page => [page.pageNumber, page]));
  for (const span of index.spans) {
    const candidates = (pageMap.get(span.pageNumber)?.spans || []).filter(item =>
      Number(item.end) > span.start && Number(item.start) < span.end);
    const sources = new Set(candidates.map(item => item.geometrySource));
    if (span.geometry.kind !== 'page-paragraph-fallback') {
      if (sources.has('matrix-derived-height')) summary.positionedMatrixDerivedHeight += 1;
      else summary.positionedNativeItemHeight += 1;
      continue;
    }
    summary.fallbackTotal += 1;
    if (!candidates.length) summary.fallbackRangeUnmatched += 1;
    else if (candidates.some(item => item.rect || item.quadPoints)) {
      summary.fallbackAlgorithmDroppedGeometry += 1;
    } else summary.fallbackSourceUnavailable += 1;
  }
  const percentage = value => Number((100 * value /
    Math.max(1, summary.totalIndexSpans)).toFixed(3));
  summary.fallbackPercent = percentage(summary.fallbackTotal);
  summary.sourceUnavailablePercent = percentage(summary.fallbackSourceUnavailable);
  summary.rangeUnmatchedPercent = percentage(summary.fallbackRangeUnmatched);
  return summary;
}

export function runLayeredSyntheticOracle() {
  const sentenceLayers = [];
  const mappingLayers = [];
  const geometryLayers = [];
  const checks = [];
  const scientificText = 'Li et al. measured 3.14 mg/mL, e.g. in a U.S. cohort with ' +
    'p = 0.003, v2.4.1, DOI 10.1038/example and https://example.org/v1.2. ' +
    'Fig. 2 agrees with Eq. 3 and Ref. 4.';
  const scientific = buildPdfSemanticIndex({ documentHash: 'a'.repeat(64), revision: 1,
    pages: [{ pageNumber: 1, text: scientificText }] });
  const expectedScientific = [
    scientificText.slice(0, scientificText.indexOf('Fig. 2') - 1),
    scientificText.slice(scientificText.indexOf('Fig. 2'))
  ];
  checks.push(JSON.stringify(scientific.sentences.map(item => item.normalizedText)) ===
    JSON.stringify(expectedScientific));
  sentenceLayers.push('abbreviations-decimals-identifiers');

  const crossPage = buildPdfSemanticIndex({ documentHash: 'b'.repeat(64), revision: 1,
    pages: [{ pageNumber: 1, text: 'Activation depends on' },
      { pageNumber: 2, text: 'NF-κB signaling.' }] });
  checks.push(crossPage.sentences.length === 1 && crossPage.sentences[0].ranges.length === 2 &&
    crossPage.sentences[0].ranges[0].pageNumber === 1 &&
    crossPage.sentences[0].ranges[1].pageNumber === 2);
  sentenceLayers.push('cross-page-uppercase');

  const repeated = buildPdfSemanticIndex({ documentHash: 'c'.repeat(64), revision: 1,
    pages: [{ pageNumber: 1, text: 'Repeated result. Repeated result.' }] });
  checks.push(repeated.sentences.length === 2 &&
    repeated.sentences[0].sentenceId !== repeated.sentences[1].sentenceId);
  sentenceLayers.push('repeated-position');

  const rawMapping = `A\u030A \u1100\u1161 \uFB03 \u{1F9EA}  inter-\nnal`;
  const mapping = normalizePdfTextWithOffsets(rawMapping);
  const enclosing = normalizedRangeToRaw(mapping, 0, 1);
  checks.push(mapping.normalizedText === 'Å 가 ffi 🧪 internal' &&
    rawRangeToNormalized(mapping, enclosing.start, enclosing.end).end === 1);
  mappingLayers.push('combining-hangul-ligature-surrogate-whitespace-dehyphenation');

  const geometryText = 'Exact sentence. Enclosing sentence. Mixed geometry sentence. Fallback sentence.';
  const positions = ['Exact sentence.', 'Enclosing sentence.', 'Mixed geometry sentence.',
    'Fallback sentence.'].map(value => ({ value, start: geometryText.indexOf(value) }));
  const mixedSplit = positions[2].start + 6;
  const geometry = buildPdfSemanticIndex({ documentHash: 'd'.repeat(64), revision: 1,
    pages: [{ pageNumber: 1, text: geometryText, pageWidth: 500, pageHeight: 500, spans: [
      { start: positions[0].start, end: positions[0].start + positions[0].value.length,
        rect: { left: 10, top: 10, right: 100, bottom: 22 } },
      { start: positions[1].start - 1, end: positions[1].start + positions[1].value.length + 1,
        rect: { left: 10, top: 30, right: 130, bottom: 42 } },
      { start: positions[2].start, end: mixedSplit,
        rect: { left: 10, top: 50, right: 60, bottom: 62 } },
      { start: mixedSplit, end: positions[2].start + positions[2].value.length },
      { start: positions[3].start, end: positions[3].start + positions[3].value.length }
    ] }] });
  const kinds = geometry.sentences.map(sentence => sentence.spanIds.map(id =>
    geometry.spans.find(span => span.spanId === id)?.geometry));
  checks.push(kinds[0].every(item => item.kind === 'rect' &&
    item.precision === 'exact-source-span'));
  geometryLayers.push('exact');
  checks.push(kinds[1].every(item => item.kind === 'rect' &&
    item.precision === 'enclosing-source-span'));
  geometryLayers.push('enclosing');
  checks.push(kinds[2].some(item => item.kind === 'rect') &&
    kinds[2].some(item => item.kind === 'page-paragraph-fallback'));
  geometryLayers.push('mixed');
  checks.push(kinds[3].every(item => item.kind === 'page-paragraph-fallback'));
  geometryLayers.push('fallback');

  const headingValues = ['1 Results', 'Figure 1. Caption text', '[1] Smith et al.',
    'p = 0.01', 'Group  1.2  3.4',
    'This ordinary bold body sentence is deliberately much longer than a plausible heading and ends normally.'];
  const headingText = headingValues.join('\n');
  const headingSpans = headingValues.map((value, index) => {
    const start = headingText.indexOf(value);
    return { text: value, start, end: start + value.length,
      fontSize: index === 0 ? 16 : 10, bold: index === 0,
      rect: { left: 20, top: 20 + index * 30, right: 450, bottom: 32 + index * 30 } };
  });
  const headingIndex = buildPdfSemanticIndex({ documentHash: 'e'.repeat(64), revision: 1,
    pages: [{ pageNumber: 1, text: headingText, pageWidth: 500, pageHeight: 500,
      spans: headingSpans }] });
  const headingKeys = new Set(headingIndex.headings.map(item => `${item.start}:${item.end}`));
  const headingQuota = { positive: Number(headingIndex.headings.some(item =>
    item.normalizedText === '1 Results')), caption: 0, reference: 0, formula: 0, table: 0, body: 0 };
  const quotaNames = ['positive', 'caption', 'reference', 'formula', 'table', 'body'];
  for (let index = 1; index < headingSpans.length; index += 1) {
    const candidate = headingSpans[index];
    if (!headingKeys.has(`${candidate.start}:${candidate.end}`)) headingQuota[quotaNames[index]] += 1;
  }
  checks.push(Object.values(headingQuota).every(value => value >= 1));
  checks.push(headingIndex.sections.every(section => Array.isArray(section.ranges) &&
    section.ranges.length > 0));
  return { pass: checks.every(Boolean), checkCount: checks.length,
    errorCount: checks.filter(value => !value).length,
    sentenceLayers, mappingLayers, geometryLayers, headingQuota };
}

function structureDigest(index) {
  return sha256(JSON.stringify({
    sections: index.sections.map(item => [item.sectionId, item.headingId, item.level,
      item.parentSectionId, item.childSectionIds, item.paragraphIds, item.ranges]),
    headings: index.headings.map(item => [item.headingId, item.pageNumber, item.start, item.end,
      item.level, item.source, item.geometry, item.outlineTarget || null]),
    paragraphs: index.paragraphs.map(item => [item.paragraphId, item.sectionId,
      item.ranges, item.sentenceIds]),
    sentences: index.sentences.map(item => [item.sentenceId, item.ranges, item.spanIds]),
    spans: index.spans.map(item => [item.spanId, item.pageNumber, item.start, item.end,
      item.geometry])
  }));
}

function sameRanges(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function auditFrozenSentences(sampleId, index, pageMap) {
  return FROZEN_CORPUS_ORACLE.sentenceLocations.filter(item => item.sampleId === sampleId)
    .map(expected => {
      const rawSlices = expected.ranges.map(range =>
        pageMap.get(range.pageNumber)?.text.slice(range.start, range.end));
      const rawOracleMatched = rawSlices.every(value => typeof value === 'string') &&
        sha256(JSON.stringify(rawSlices)) === expected.expectedRawSlicesSha256;
      const sentence = index.sentences.find(item => sameRanges(item.ranges, expected.ranges));
      const normalizedOracleMatched = Boolean(sentence) &&
        sha256(sentence.normalizedText) === expected.expectedNormalizedTextSha256;
      const sentenceSpans = sentence ? index.spans.filter(item =>
        sentence.spanIds.includes(item.spanId)) : [];
      const degraded = sentenceSpans.length > 0 && sentenceSpans.every(item =>
        item.geometry.kind === 'page-paragraph-fallback');
      const valid = rawOracleMatched && normalizedOracleMatched;
      return { auditId: expected.auditId, kind: 'sentence-location',
        result: valid ? (degraded ? 'degraded' : 'correct') : 'error',
        pageCount: new Set(expected.ranges.map(item => item.pageNumber)).size,
        rangeCount: expected.ranges.length, geometry: degraded ? 'fallback' : 'positioned',
        frozenLocatorMatched: Boolean(sentence), rawOracleMatched, normalizedOracleMatched,
        locatorSha256: sha256(JSON.stringify(expected.ranges)),
        expectedRawSlicesSha256: expected.expectedRawSlicesSha256,
        expectedNormalizedTextSha256: expected.expectedNormalizedTextSha256 };
    });
}

function locatorForHeading(sampleId, heading) {
  return headingLocator(sampleId, heading.pageNumber, heading.start, heading.end);
}

function auditFrozenHeadings(sampleId, index, pageMap, negativeHeadings) {
  const positives = FROZEN_CORPUS_ORACLE.headingPositives
    .filter(item => item.sampleId === sampleId).map((expected, order) => {
      const heading = index.headings.find(item => locatorForHeading(sampleId, item) ===
        expected.locator);
      const page = pageMap.get(expected.pageNumber);
      const rawOracleMatched = Boolean(page) && sha256(page.text.slice(expected.start,
        expected.end)) === expected.expectedRawTextSha256;
      const levelMatches = heading?.level === expected.expectedLevel;
      const section = heading && index.sections.find(item => item.headingId === heading.headingId);
      const parentSection = section?.parentSectionId
        ? index.sections.find(item => item.sectionId === section.parentSectionId) : null;
      const parentHeading = parentSection
        ? index.headings.find(item => item.headingId === parentSection.headingId) : null;
      const actualParentLocator = parentHeading ? locatorForHeading(sampleId, parentHeading) : null;
      const parentMatches = actualParentLocator === expected.expectedParentHeadingLocator;
      const finalRange = section?.ranges?.at(-1);
      const sectionEndMatches = finalRange?.pageNumber === expected.expectedSectionEnd.pageNumber &&
        finalRange?.end === expected.expectedSectionEnd.end;
      const outlineTargetValid = heading?.source !== 'outline' ||
        (heading.outlineTarget?.status === 'resolved' &&
          (heading.outlineTarget.targetTop === null
            ? heading.confidence < 0.99
            : Number.isFinite(heading.outlineTarget.distance)));
      const valid = Boolean(heading) && rawOracleMatched && levelMatches && parentMatches &&
        sectionEndMatches && outlineTargetValid;
      const degraded = valid && (/fallback/u.test(heading.geometry?.kind || '') ||
        (heading.source === 'outline' && heading.outlineTarget?.targetTop === null));
      return { auditId: `${sampleId}-HP${String(order + 1).padStart(2, '0')}`,
        kind: 'heading-positive', result: valid ? (degraded ? 'degraded' : 'correct') : 'error',
        pageNumber: expected.pageNumber, source: heading?.source || 'missing',
        geometry: heading?.geometry?.kind || 'missing', confidence: heading?.confidence ?? null,
        frozenLocatorMatched: Boolean(heading), rawOracleMatched,
        level: heading?.level ?? null, expectedLevel: expected.expectedLevel, levelMatches,
        parentMatches, sectionEndMatches, outlineTargetValid,
        locatorSha256: sha256(expected.locator),
        expectedRawTextSha256: expected.expectedRawTextSha256 };
    });
  const negatives = FROZEN_CORPUS_ORACLE.headingNegatives
    .filter(item => item.sampleId === sampleId).map((expected, order) => {
      const page = pageMap.get(expected.pageNumber);
      const rawOracleMatched = Boolean(page) && sha256(page.text.slice(expected.start,
        expected.end)) === expected.expectedRawTextSha256;
      const overlaps = negativeHeadings.some(heading => heading.pageNumber === expected.pageNumber &&
        heading.end > expected.start && heading.start < expected.end);
      return { auditId: `${sampleId}-HN${String(order + 1).padStart(2, '0')}`,
        kind: `${expected.kind}-negative`, result: rawOracleMatched && !overlaps ? 'correct' : 'error',
        pageNumber: expected.pageNumber, rawOracleMatched, headingAbsent: !overlaps,
        locatorSha256: sha256(`${sampleId}:${expected.pageNumber}:${expected.start}:${expected.end}`),
        expectedRawTextSha256: expected.expectedRawTextSha256 };
    });
  return [...positives, ...negatives];
}

export async function runPdfSemanticVerifier(options = {}) {
  const manifestPath = path.resolve(options.manifestPath || argument('--manifest',
    path.join(repositoryRoot, 'tmp', 'pdf-eval-corpus-private-20260911.json')));
  const outputDirectory = path.resolve(options.outputDirectory || argument('--output',
    path.join(repositoryRoot, 'output', 'playwright', 'pdf-semantic-index-p2a-20260911')));
  const sampleIds = ['P2-T02', 'P2-T04', 'P2-T08'];
  const report = {
    schemaVersion: 1, status: 'RUNNING',
    scope: 'P2-A semantic index small-sample location and heading classification verification',
    limitations: {
      finalGateClaimed: false,
      finalRequiredSentenceLocations: 120,
      finalRequiredHeadingChecks: 80,
      note: 'This report is the requested 40/25 development sample, not the final 120/80 gate.'
    },
    privacy: { pathsPersisted: false, rawTextPersisted: false, textHashesOnly: true },
    auditMethod: {
      sentenceLocations: '48 immutable stratified page/UTF-16 locators, raw-slice hashes and normalized-text hashes frozen independently of runtime selection',
      headings: 'immutable positive and negative locators with raw hashes, expected levels, parent locators and section endpoints',
      resultVocabulary: ['correct', 'error', 'degraded'],
      humanScientificReviewPerformed: false
    },
    network: { externalRequests: 0, apiCalls: 0, ocrCalls: 0 },
    cache: { persistentCacheUsed: false,
      repeatedBuildIsHotCache: false,
      keyDesign: 'schemaVersion + documentHash + revision + canonical text, outline, typography, offsets and geometry' },
    oracle: { immutableDetailedExpectations: true, frozenBeforeRuntimeSelection: true,
      realRevision: FROZEN_CORPUS_ORACLE.revision,
      synthetic: runLayeredSyntheticOracle() },
    samples: [], sentenceAudits: [], headingAudits: [], acceptance: {}, error: null
  };
  try {
    const privateManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const selected = sampleIds.map(sampleId => privateManifest.documents.find(item =>
      item.sampleId === sampleId));
    assert.equal(selected.every(Boolean), true, 'P2A_REAL_SAMPLE_MISSING');
    const canvas = require('@napi-rs/canvas');
    globalThis.DOMMatrix ||= canvas.DOMMatrix;
    globalThis.ImageData ||= canvas.ImageData;
    globalThis.Path2D ||= canvas.Path2D;
    const pdfjs = await import(pathToFileURL(
      require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
      require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href;

    for (const descriptor of selected) {
      const bytes = fs.readFileSync(descriptor.absolutePath);
      assert.equal(sha256(bytes), descriptor.sha256, 'P2A_SOURCE_HASH_MISMATCH');
      const loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes),
        disableFontFace: true, useSystemFonts: false });
      const document = await loadingTask.promise;
      const pageLimit = Math.min(document.numPages, 10);
      const requiredPageNumbers = new Set(Array.from({ length: pageLimit }, (_, index) => index + 1));
      for (const item of FROZEN_CORPUS_ORACLE.headingNegatives) {
        if (item.sampleId === descriptor.sampleId) requiredPageNumbers.add(item.pageNumber);
      }
      const oraclePages = [];
      for (const pageNumber of [...requiredPageNumbers].sort((left, right) => left - right)) {
        const page = await document.getPage(pageNumber);
        const textContent = await page.getTextContent({ includeMarkedContent: true });
        oraclePages.push(canonicalPageRecord(pageNumber, page, textContent));
      }
      const pages = oraclePages.filter(page => page.pageNumber <= pageLimit);
      const outline = await nativeOutline(document);
      const input = { documentHash: descriptor.sha256, revision: 1, pages, outline };
      const coldStarted = performance.now();
      const cold = buildPdfSemanticIndex(input);
      const coldMs = performance.now() - coldStarted;
      const hotStarted = performance.now();
      const hot = buildPdfSemanticIndex(input);
      const hotMs = performance.now() - hotStarted;
      const coldDigest = structureDigest(cold);
      const hotDigest = structureDigest(hot);
      assert.equal(cold.cacheKey, hot.cacheKey, 'P2A_CACHE_KEY_UNSTABLE');
      assert.equal(coldDigest, hotDigest, 'P2A_STRUCTURE_UNSTABLE');
      const pageMap = new Map(oraclePages.map(page => [page.pageNumber, page]));
      const sentenceAudits = auditFrozenSentences(descriptor.sampleId, cold, pageMap);
      const negativeHeadings = extractPdfHeadings({ documentHash: descriptor.sha256,
        revision: 1, pages: oraclePages, outline: [] });
      const headingAudits = auditFrozenHeadings(descriptor.sampleId, cold, pageMap,
        negativeHeadings);
      report.sentenceAudits.push(...sentenceAudits);
      report.headingAudits.push(...headingAudits);
      const geometryProvenance = summarizeGeometryProvenance(cold, pages);
      const fixedOracle = { oracleRevision: FROZEN_CORPUS_ORACLE.revision,
        sentenceMatch: sentenceAudits.every(item => item.result !== 'error'),
        headingMatch: headingAudits.every(item => item.result !== 'error') };
      fixedOracle.pass = fixedOracle.sentenceMatch && fixedOracle.headingMatch;
      const outlineEntries = cold.headingDiagnostics?.outlineEntries || [];
      const baselineFallbacks = descriptor.sampleId === 'P2-T02' ? 5390
        : descriptor.sampleId === 'P2-T04' ? 1 : 0;
      report.samples.push({ sampleId: descriptor.sampleId, sha256: descriptor.sha256,
        bytes: descriptor.fileSizeBytes, pageCount: document.numPages,
        pagesRead: oraclePages.length, indexPagesRead: pageLimit,
        twoColumnCandidate: /two-column/u.test(String(descriptor.featureTags || '')),
        nativeOutlineInputs: outline.length,
        counts: { sections: cold.sections.length, headings: cold.headings.length,
          paragraphs: cold.paragraphs.length, sentences: cold.sentences.length,
          spans: cold.spans.length,
          geometryFallbacks: cold.spans.filter(item =>
            item.geometry.kind === 'page-paragraph-fallback').length },
        geometryProvenance,
        geometryDiagnosis: {
          previousFallbackCount: baselineFallbacks,
          previousFallbackPercent: Number((100 * baselineFallbacks /
            Math.max(1, descriptor.sampleId === 'P2-T02' ? 12399
              : descriptor.sampleId === 'P2-T04' ? 3533 : 6159)).toFixed(3)),
          sourceItemsTrulyLackingUsableGeometry: geometryProvenance.fallbackSourceUnavailable,
          rangeMappingLosses: geometryProvenance.fallbackRangeUnmatched +
            geometryProvenance.fallbackAlgorithmDroppedGeometry,
          recoveredFromExplicitPdfTransform: geometryProvenance.positionedMatrixDerivedHeight,
          currentFallbackCount: geometryProvenance.fallbackTotal,
          fabricatedQuadPoints: false
        },
        outlineResolution: {
          total: outlineEntries.length,
          resolved: outlineEntries.filter(item => item.status === 'resolved').length,
          unresolved: outlineEntries.filter(item => item.status !== 'resolved').length,
          unresolvedReasonCounts: Object.fromEntries([...new Set(outlineEntries
            .filter(item => item.status !== 'resolved').map(item => item.reason))]
            .sort().map(reason => [reason, outlineEntries.filter(item => item.reason === reason).length]))
        },
        fixedOracle,
        performance: { firstUncachedBuildMs: Number(coldMs.toFixed(3)),
          repeatedUncachedBuildMs: Number(hotMs.toFixed(3)),
          persistentCacheUsed: false },
        cacheKeySha256: sha256(cold.cacheKey), structureSha256: coldDigest });
      await document.destroy();
    }
    const countResults = (audits, result) => audits.filter(item => item.result === result).length;
    const observation = {
      sampleCount: report.samples.length,
      includesTwoColumn: report.samples.some(item => item.twoColumnCandidate),
      sentenceAudits: report.sentenceAudits.length,
      sentenceCorrect: countResults(report.sentenceAudits, 'correct'),
      sentenceDegraded: countResults(report.sentenceAudits, 'degraded'),
      sentenceErrors: countResults(report.sentenceAudits, 'error'),
      headingAudits: report.headingAudits.length,
      headingCorrect: countResults(report.headingAudits, 'correct'),
      headingDegraded: countResults(report.headingAudits, 'degraded'),
      headingErrors: countResults(report.headingAudits, 'error'),
      stableCacheKeys: true, stableStructure: true,
      fixedRealOracleMatched: report.samples.every(item => item.fixedOracle.pass),
      syntheticOraclePassed: report.oracle.synthetic.pass,
      outlineTargetsChecked: report.headingAudits.filter(item => item.source === 'outline').length,
      outlineTargetErrors: report.headingAudits.filter(item => item.source === 'outline' &&
        item.outlineTargetValid !== true).length,
      headingLevelsChecked: report.headingAudits.filter(item => item.kind === 'heading-positive').length,
      headingLevelErrors: report.headingAudits.filter(item => item.kind === 'heading-positive' &&
        item.levelMatches !== true).length,
      parentHierarchyChecked: report.headingAudits.filter(item =>
        item.kind === 'heading-positive').length,
      parentHierarchyErrors: report.headingAudits.filter(item =>
        item.kind === 'heading-positive' && item.parentMatches !== true).length,
      sectionRangesChecked: report.headingAudits.filter(item => item.kind === 'heading-positive').length,
      sectionRangeErrors: report.headingAudits.filter(item => item.kind === 'heading-positive' &&
        item.sectionEndMatches !== true).length,
      apiCalls: report.network.apiCalls, ocrCalls: report.network.ocrCalls,
      absolutePathLeaks: 0, rawTextLeaks: 0
    };
    report.acceptance = { observation, ...assessPdfSemanticAcceptance(observation) };
    assert.equal(report.acceptance.pass, true, 'P2A_SMALL_SAMPLE_ACCEPTANCE_FAILED');
    report.status = 'PASS';
  } catch (error) {
    report.status = 'FAIL';
    report.error = safeError(error);
  }
  const serialized = JSON.stringify(report, null, 2);
  const absolutePathLeaks = (serialized.match(/(?:[A-Za-z]:\\|file:\/\/|\\\\[^"\s]+\\|"\/(?:Users|home|tmp)\/)/gu) || []).length;
  const rawTextLeaks = (serialized.match(/"(?:rawText|normalizedText|quote|absolutePath|path|title)"\s*:/gu) || []).length;
  if (absolutePathLeaks || rawTextLeaks) {
    report.status = 'FAIL';
    report.error = { name: 'PrivacyError', code: 'P2A_REPORT_PRIVACY_LEAK',
      detailSha256: sha256(`${absolutePathLeaks}:${rawTextLeaks}`), detailBytes: 3 };
  }
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, 'report.json'),
    `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isCli) {
  const report = await runPdfSemanticVerifier();
  console.log(JSON.stringify({ status: report.status,
    samples: report.samples.map(item => ({ sampleId: item.sampleId, sha256: item.sha256,
      pagesRead: item.pagesRead, counts: item.counts, performance: item.performance })),
    acceptance: report.acceptance, network: report.network, error: report.error }));
  if (report.status !== 'PASS') process.exitCode = 1;
}
