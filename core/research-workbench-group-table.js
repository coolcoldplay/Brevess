(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;Object.assign(root.SciLLM ||= {},api);})(globalThis,()=>{
  'use strict';
  const axisName=(kind,index)=>(globalThis.SciLLM?.getInterfaceLanguage?.()==='en'?(kind==='row'?'Group ':'Condition '):(kind==='row'?'组 ':'条件 '))+index;
  const clone=value=>structuredClone(value),uid=prefix=>prefix+'_'+crypto.randomUUID();
  const WORKBENCH_GROUP_TABLE_LIMITS=Object.freeze({rows:50,columns:20,nameLength:2000,cellLength:20000});
  const tableError=(field,reason)=>Object.assign(Error('实验分组表格无效：'+reason),{code:'WORKBENCH_INVALID_GROUP_TABLE',details:{field,reason}});
  const plain=value=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
  const tableId=id=>typeof id==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)&&!['__proto__','constructor','prototype'].includes(id);
  function tableText(value,field,max){if(typeof value!=='string'||value.length>max)throw tableError(field,'必须为限定长度内的文字');return value;}
  function validateWorkbenchGroupTable(table){
    if(!plain(table)||table.version!==1)throw tableError('version','只支持 version=1 的表格对象');
    const validateAxis=(axis,max)=>{if(!Array.isArray(table[axis])||table[axis].length>max)throw tableError(axis,'行列数量超出限制');const ids=new Set();for(const [index,item] of table[axis].entries()){
      if(!plain(item)||!tableId(item.id)||ids.has(item.id))throw tableError(axis+'.'+index+'.id','ID 无效或重复');
      tableText(item.name,axis+'.'+index+'.name',WORKBENCH_GROUP_TABLE_LIMITS.nameLength);ids.add(item.id);
    }return ids;};
    const rows=validateAxis('rows',WORKBENCH_GROUP_TABLE_LIMITS.rows),columns=validateAxis('columns',WORKBENCH_GROUP_TABLE_LIMITS.columns);
    for(const field of ['showRowNames','showColumnNames'])if(typeof table[field]!=='boolean')throw tableError(field,'必须为 true 或 false');
    if(!plain(table.cells))throw tableError('cells','必须为以行 ID 和列 ID 索引的对象');
    for(const [rowId,cells] of Object.entries(table.cells)){
      if(!rows.has(rowId)||!plain(cells))throw tableError('cells.'+rowId,'行 ID 不存在或内容无效');
      for(const [columnId,value] of Object.entries(cells)){
        if(!columns.has(columnId))throw tableError('cells.'+rowId+'.'+columnId,'列 ID 不存在');
        tableText(value,'cells.'+rowId+'.'+columnId,WORKBENCH_GROUP_TABLE_LIMITS.cellLength);
      }
    }
    return clone(table);
  }
  function createWorkbenchGroupTable(rowCount=2,columnCount=2){
    for(const [field,value,max] of [['rows',rowCount,WORKBENCH_GROUP_TABLE_LIMITS.rows],['columns',columnCount,WORKBENCH_GROUP_TABLE_LIMITS.columns]])if(!Number.isInteger(value)||value<0||value>max)throw tableError(field,'数量必须为 0 至 '+max+' 的整数');
    const rows=Array.from({length:rowCount},(_,i)=>({id:uid('row'),name:axisName('row',i+1)})),columns=Array.from({length:columnCount},(_,i)=>({id:uid('column'),name:axisName('column',i+1)}));
    return {version:1,rows,columns,cells:Object.fromEntries(rows.map(row=>[row.id,Object.fromEntries(columns.map(column=>[column.id,'']))])),showRowNames:true,showColumnNames:true};
  }
  function editWorkbenchGroupTable(table,op){
    const next=validateWorkbenchGroupTable(table);if(!plain(op))throw tableError('operation','必须为对象');
    const find=(axis,id)=>{const i=next[axis].findIndex(item=>item.id===id);if(i<0)throw tableError(axis==='rows'?'rowId':'columnId','目标 ID 不存在');return i;};
    const index=(axis)=>{const n=op.index??next[axis].length;if(!Number.isInteger(n)||n<0||n>next[axis].length)throw tableError('index','插入位置无效');return n;};
    switch(op.action){
      case 'add_row':{const row={id:uid('row'),name:op.value===undefined?axisName('row',next.rows.length+1):tableText(op.value,'value',WORKBENCH_GROUP_TABLE_LIMITS.nameLength)};next.rows.splice(index('rows'),0,row);next.cells[row.id]=Object.fromEntries(next.columns.map(c=>[c.id,'']));break;}
      case 'remove_row':{const i=find('rows',op.rowId);next.rows.splice(i,1);delete next.cells[op.rowId];break;}
      case 'add_column':{const column={id:uid('column'),name:op.value===undefined?axisName('column',next.columns.length+1):tableText(op.value,'value',WORKBENCH_GROUP_TABLE_LIMITS.nameLength)};next.columns.splice(index('columns'),0,column);for(const row of next.rows)(next.cells[row.id] ||= {})[column.id]='';break;}
      case 'remove_column':{const i=find('columns',op.columnId);next.columns.splice(i,1);for(const cells of Object.values(next.cells))delete cells[op.columnId];break;}
      case 'row_name':next.rows[find('rows',op.rowId)].name=tableText(op.value,'value',WORKBENCH_GROUP_TABLE_LIMITS.nameLength);break;
      case 'column_name':next.columns[find('columns',op.columnId)].name=tableText(op.value,'value',WORKBENCH_GROUP_TABLE_LIMITS.nameLength);break;
      case 'cell':find('rows',op.rowId);find('columns',op.columnId);(next.cells[op.rowId] ||= {})[op.columnId]=tableText(op.value,'value',WORKBENCH_GROUP_TABLE_LIMITS.cellLength);break;
      case 'visibility':for(const field of ['showRowNames','showColumnNames'])if(Object.hasOwn(op,field)){if(typeof op[field]!=='boolean')throw tableError(field,'必须为 true 或 false');next[field]=op[field];}break;
      default:throw tableError('action','操作无效');
    }
    return validateWorkbenchGroupTable(next);
  }
  return {WORKBENCH_GROUP_TABLE_LIMITS,createWorkbenchGroupTable,validateWorkbenchGroupTable,editWorkbenchGroupTable};
});
