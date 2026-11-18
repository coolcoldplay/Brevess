'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const fs = require('node:fs'), vm = require('node:vm');
const viewer = require('../extension/core/figure-viewer.js');
const {functionSource} = require('./helpers/r28-full07-source.js');
const {selectedPaths} = require('../extension/core/workspace-storage.js');
const {buildReadingPackEntries} = require('../extension/core/reading-pack.js');
const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jT1sAAAAASUVORK5CYII=';
const bytes = new Uint8Array(Buffer.from(dataUrl.split(',')[1], 'base64'));
const pageUrl = 'https://publisher.test/articles/one';
const originalUrl = 'https://cdn.test/figure1.png?token=secret';
const metadata = {pageUrl, documentHash:'hash1', figureId:'Fig1', imageIndex:0, sourceIdentity:'original-srcset'};
const resource = {bytes, dataUrl, pixelWidth:1, pixelHeight:1, cacheStored:true,
  cacheReceipt:{cacheKey:originalUrl, byteLength:bytes.length, sha256:createHash('sha256').update(bytes).digest('hex')}};
const record = () => viewer.createFigureOriginalAsset(resource, metadata, [originalUrl]);

test('durable originals reopen from verified bytes and do not export signed URL credentials', async () => {
  const saved = await record();
  assert.equal(JSON.stringify(saved).includes('secret'), false);
  assert.equal(saved.sourceUrl, 'https://cdn.test/figure1.png');
  assert.deepEqual((await viewer.readFigureOriginalAsset(saved, saved)).bytes, bytes);
  assert.equal((await viewer.readFigureOriginalAsset(saved, saved)).workspaceStored, true);
  assert.equal((await record()).assetPath, saved.assetPath);
});
test('responsive variants share candidates; saved readers rebind only the same paper and figure', async () => {
  const saved = await record();
  assert.equal(await viewer.matchFigureOriginalAsset(saved, {...metadata,sourceIdentity:'new responsive src',candidates:[originalUrl]}), true);
  assert.equal(await viewer.matchFigureOriginalAsset(saved, {...metadata,sourceIdentity:'data image',savedReader:true}), true);
  for (const changed of [{pageUrl:pageUrl+'-other'}, {documentHash:'other'}, {figureId:'Fig2'}, {imageIndex:1}]) {
    assert.equal(await viewer.matchFigureOriginalAsset(saved, {...metadata,...changed,savedReader:true}), false);
  }
  assert.equal(await viewer.matchFigureOriginalAsset(saved, {...metadata,sourceIdentity:'unrelated image',candidates:[]}), false);
});
test('corrupt, swapped and non-image assets cannot be restored', async () => {
  const saved = await record();
  for (const changed of [{dataUrl:dataUrl.replace('iVBOR','aVBOR')},{figureId:'Fig2'},{byteLength:bytes.length+1},{dataUrl:'data:text/html;base64,YQ=='}]) {
    await assert.rejects(()=>viewer.readFigureOriginalAsset({...saved,...changed}, saved), /INVALID/);
  }
  await assert.rejects(()=>viewer.createFigureOriginalAsset({...resource,bytes:bytes.slice(1)},metadata),/INVALID/);
});
test('page deletion includes original image assets; deleting annotations preserves them', () => {
  const paths=['article/offline-snapshot.html','figures/originals/index.json','figures/originals/one.json','figures/inventory.json','annotations/highlights.json'];
  const assets=paths.map(relativePath=>({relativePath}));
  assert.deepEqual(selectedPaths(assets,{page:true,user:false}),paths.slice(0,3));
  assert.deepEqual(selectedPaths(assets,{page:false,user:true}),paths.slice(3));
});
test('sharing an older HTML snapshot embeds an original downloaded afterwards', async () => {
  const saved=await record(),snapshot='<html><body><img src="data:image/png;base64,AA==" data-brevess-figure-id="Fig1" data-brevess-image-index="0"><img data-brevess-figure-id="Fig2" data-brevess-image-index="0"></body></html>';
  const pack=buildReadingPackEntries({workspace:{workspaceId:'w'},assets:[{relativePath:'article/offline-snapshot.html',content:snapshot},{relativePath:'article/structure.json',content:{documentHash:'hash1'}},{relativePath:saved.assetPath,content:saved}]});
  const html=pack.entries.find(e=>e.path==='snapshot.html').data;
  assert.ok(html.includes('data-brevess-original-image="'+dataUrl+'"'));
  assert.equal((html.match(/data-brevess-original-image=/g)||[]).length,1);
});
test('actual restoration uses local workspace bytes with an empty browser cache and no publisher request', async () => {
  const saved=await record(),source=fs.readFileSync(require.resolve('../extension/content.js'),'utf8');
  const image={isConnected:true,naturalWidth:1,naturalHeight:1};
  const applied=[],reads=[];
  const context=vm.createContext({
    savedFigureOriginalDisplayPageActive:true,savedFigureOriginalDisplayRestore:null,
    activeNativePdfStructure:()=>false,activeSavedArticleDocument:()=>({ready:true}),
    figureOriginalDisplayPageIdentity:()=> 'navigation',figureOriginalDisplaySourceUrl:()=>pageUrl,
    currentArticleWorkspace:{workspaceId:'w'},document:{baseURI:'chrome-extension://test/offline-reader.html'},
    SciLLM:{...viewer,publicPageStorage:{get:async()=>({})},figureOriginalDisplaySourceIdentity:()=> 'data image',collectFigureImageCandidates:()=>[]},
    getWorkspaceAssetCheckpoint:async path=>{reads.push(path);return{content:path.endsWith('index.json')?{entries:[saved]}:saved};},
    getCanonicalArticleSnapshot:()=>({documentHash:'hash1'}),
    getFigureWorkspaceInventory:()=>[{figureId:'Fig1',imageElements:[image]}],
    getSavedFigureOriginalDisplayAssets:()=>new Map(),queueVisibleFigureOriginal:async(_,__,apply)=>apply(),
    figureOriginalDisplayManager:()=>({apply:async(img,resource,entry)=>{applied.push({img,resource,entry});return true;}}),
    fetchExportImageSource:()=>{throw Error('must not fetch');},persistFigureOriginalAsset:()=>{throw Error('must not rewrite durable bytes');}
  });
  vm.runInContext(functionSource(source,'restoreSavedFigureOriginalDisplays'),context);
  await context.restoreSavedFigureOriginalDisplays();
  assert.equal(applied.length,1);assert.equal(applied[0].resource.dataUrl,dataUrl);
  assert.equal(applied[0].entry.sourceIdentity,'data image');assert.deepEqual(reads,['figures/originals/index.json',saved.assetPath]);
});

test('explicit viewer acquisition also prefers the saved original before publisher candidate resolution', async () => {
  const saved=await record(),source=fs.readFileSync(require.resolve('../extension/content.js'),'utf8');
  const image={isConnected:true},figure={figureId:'Fig1',imageElements:[image]};
  const context=vm.createContext({
    figureOriginalResourceScope:()=>({pageIdentity:'navigation',originalImages:[{image,sourceIdentity:'original-srcset'}],figureId:'Fig1',current:()=>true,key:'figure-key'}),
    sharedFigureOriginalPage:'',sharedFigureOriginalResources:new Map(),figureImageCacheMode:async()=> 'read-only',
    getSavedFigureOriginalDisplayAssets:()=>new Map(),getWorkspaceAssetCheckpoint:async path=>({content:path.endsWith('index.json')?{entries:[saved]}:saved}),
    getFigureWorkspaceInventory:()=>[figure],figureOriginalDisplaySourceUrl:()=>pageUrl,getCanonicalArticleSnapshot:()=>({documentHash:'hash1'}),
    document:{baseURI:pageUrl},activeSavedArticleDocument:()=>null,SciLLM:{...viewer,collectFigureImageCandidates:()=>[originalUrl]},
    resolveFigureImageSources:()=>{throw Error('publisher lookup must not run');},selectBestFigureImageResource:()=>{throw Error('network must not run');}
  });
  vm.runInContext(functionSource(source,'loadSharedFigureOriginalResource'),context);
  const result=await context.loadSharedFigureOriginalResource(figure);
  assert.equal(result.resource.workspaceStored,true);assert.deepEqual(result.resource.bytes,bytes);
});

test('complete save persists already acquired originals without another publisher request', async () => {
  const source=fs.readFileSync(require.resolve('../extension/content.js'),'utf8');
  const image={isConnected:true},figure={figureId:'Fig1',imageElements:[image]},writes=[],hints=[];
  const captured={article:{documentHash:'hash1'},originalBindings:new Map([[image,{figureId:'Fig1',imageIndex:0,sourceIdentity:'original-srcset'}]]),
    collected:{inventoryById:new Map([['Fig1',figure]])}};
  const bundle={embeddedImageByElement:new Map([[image,{data:bytes,dataUrl,pixelWidth:1,pixelHeight:1,requestedSourceUrl:originalUrl}]])};
  const context=vm.createContext({crypto:globalThis.crypto,figureOriginalDisplayPageIdentity:()=> 'navigation',
    figureOriginalDisplaySourceUrl:()=>pageUrl,SciLLM:{figureOriginalDisplaySourceIdentity:()=> 'original-srcset'},
    persistFigureOriginalAsset:async(fig,img,original,entry,options)=>{
      assert.equal(fig,figure);assert.equal(img,image);assert.equal(options.requireDirectoryPersistence,true);
      writes.push(await viewer.createFigureOriginalAsset(original,entry,[originalUrl]));return true;
    },rememberFigureOriginalDisplay:async entry=>hints.push(entry),fetch:()=>{throw Error('must not fetch');}});
  vm.runInContext(functionSource(source,'persistSnapshotFigureOriginalAssets'),context);
  await context.persistSnapshotFigureOriginalAssets(captured,bundle,()=>{});
  assert.equal(writes.length,1);assert.deepEqual((await viewer.readFigureOriginalAsset(writes[0],writes[0])).bytes,bytes);
  assert.equal(hints[0].figureId,'Fig1');
  image.isConnected=false;
  await assert.rejects(()=>context.persistSnapshotFigureOriginalAssets(captured,bundle,()=>{}),/图片已变化/);
  assert.equal(writes.length,1);
});

test('legacy originals migrate even when the publisher already displays the same resolution', async () => {
  const source=fs.readFileSync(require.resolve('../extension/content.js'),'utf8'),image={isConnected:true,naturalWidth:1,naturalHeight:1};
  const cached={...metadata,cacheKey:originalUrl,...resource.cacheReceipt},writes=[];
  const context=vm.createContext({savedFigureOriginalDisplayPageActive:true,savedFigureOriginalDisplayRestore:null,
    activeNativePdfStructure:()=>false,activeSavedArticleDocument:()=>null,
    figureOriginalDisplayPageIdentity:()=> 'navigation',figureOriginalDisplaySourceUrl:()=>pageUrl,
    currentArticleWorkspace:{workspaceId:'w'},document:{baseURI:pageUrl},
    SciLLM:{...viewer,publicPageStorage:{get:async()=>({['sciFigureOriginalDisplayV1:'+pageUrl]:[cached]})},
      figureOriginalDisplaySourceIdentity:()=>metadata.sourceIdentity,collectFigureImageCandidates:()=>[originalUrl]},
    getWorkspaceAssetCheckpoint:async()=>null,getCanonicalArticleSnapshot:()=>({documentHash:'hash1'}),
    getFigureWorkspaceInventory:()=>[{figureId:'Fig1',imageElements:[image]}],getSavedFigureOriginalDisplayAssets:()=>new Map(),
    queueVisibleFigureOriginal:async(_,__,apply)=>apply(),figureOriginalDisplayManager:()=>({apply:async()=>false}),
    fetchExportImageSource:async(_,options)=>{assert.equal(options.cacheMode,'read-only');return resource;},
    measureExportImageResource:async value=>value,persistFigureOriginalAsset:async(...args)=>writes.push(args)
  });
  vm.runInContext(functionSource(source,'restoreSavedFigureOriginalDisplays'),context);
  await context.restoreSavedFigureOriginalDisplays();
  assert.equal(writes.length,1);assert.equal(writes[0][2].dataUrl,dataUrl);
});
