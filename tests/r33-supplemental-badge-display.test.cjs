'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../popup.js'),'utf8');
function fn(name){const start=source.indexOf('function '+name+'('),end=source.slice(start+1).search(/\r?\n(?:async )?function /);assert.ok(start>=0&&end>=0);return source.slice(start,start+1+end);}
function node(tagName,className='',textContent=''){
 return{tagName,className,textContent,children:[],attrs:{},dataset:{},hidden:false,classList:{toggle(){},remove(){}},
  setAttribute(key,value){this.attrs[key]=value;},addEventListener(){},replaceChildren(){this.children=[];},appendChild(child){this.children.push(child);return child;},append(...children){this.children.push(...children);}};
}
function context(){const nav=node('nav'),box={String,Number,Array,clearTimeout,setTimeout,currentWorkspaceSnapshot:{},figureQuickNavHoverTimer:null,figureQuickNavActiveId:'',figureQuickNavExpandedFigureId:'',
 document:{getElementById:()=>nav},createWorkspaceElement:node,figureWorkspaceViewState:{get:()=>null,resolve:()=>({panels:[]})}};
 vm.createContext(box);vm.runInContext(fn('compactFigureDisplayNumber')+'\n'+fn('renderFigureQuickNav'),box);return{box,nav};}
test('actual compact formatter gives S-prefixed display numbers for named supplemental and Extended Data figures',()=>{
 const {box}=context();
 for(const [figure,expected] of [[{figureLabel:'Extended Data Figure 12'},'S12'],[{figureLabel:'Extended Data Fig. 2'},'S2'],[{figureLabel:'Supplementary Figure 3'},'S3'],[{figureLabel:'Supplemental Fig. S4'},'S4'],[{figureLabel:'Figure 5',isSupplemental:true},'S5'],[{figureId:'figure-S6'},'S6'],[{figureNumber:7,isSupplemental:true},'S7']]){
  const before=JSON.stringify(figure);assert.equal(box.compactFigureDisplayNumber(figure),expected,JSON.stringify(figure));assert.equal(JSON.stringify(figure),before);
 }
 for(const figure of [{figureLabel:'Figure 3'},{figureLabel:'Fig. 3'},{figureLabel:'图 3'},{figureId:'figure-3'}])assert.equal(box.compactFigureDisplayNumber(figure),'3');
});
test('actual quick navigation displays short supplemental badges while preserving main labels and complete source names',()=>{
 const {box,nav}=context(),figures=[{figureId:'extended-data-1',figureLabel:'Extended Data Figure 1',isSupplemental:true},{figureId:'supp-2',figureLabel:'Supplementary Figure 2'},{figureId:'figure-3',figureLabel:'Figure 3'}],before=JSON.stringify(figures);
 box.renderFigureQuickNav(figures);
 const items=nav.children[0].children;
 assert.deepEqual(items.map(item=>item.children[1].children[1].textContent),['FigS1','FigS2','Figure 3']);
 items.forEach((item,index)=>{const label=item.children[1].children[1];assert.equal(item.dataset.figureId,figures[index].figureId);assert.equal(label.title,figures[index].figureLabel);assert.equal(label.attrs['aria-label'],figures[index].figureLabel);});
 assert.equal(JSON.stringify(figures),before);
});
test('actual card badge render block retains full scientific name in title and aria while displaying FigS',()=>{
 const {box}=context();box.figure={figureId:'extended-data-10',figureLabel:'Extended Data Figure 10',isSupplemental:true};box.loading=false;
 const start=source.indexOf('        const displayNumber = compactFigureDisplayNumber(figure);',source.indexOf('function renderFigureWorkspaceSnapshot('));
 const end=source.indexOf('        const gestureContext = ',start);assert.ok(start>=0&&end>start);
 vm.runInContext(source.slice(start,end)+'\nglobalThis.badge=summaryHeading;',box);
 assert.equal(box.badge.textContent,'FigS10');assert.equal(box.badge.dataset.figureBadge,'extended-data-10');assert.match(box.badge.title,/Extended Data Figure 10/);assert.match(box.badge.attrs['aria-label'],/Extended Data Figure 10/);
});
