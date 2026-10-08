import {cents,productionForMonth} from './production-model.mjs?v=20';

export function dashboardSlices(contracts,payments,ym,metric='balance'){
 const values=new Map();
 if(metric==='payments'){
  for(const p of payments)if(p.status==='Pago'&&p.paid_at?.slice(0,7)===ym){
   values.set(p.contract_id,(values.get(p.contract_id)||0)+cents(p.value));
  }
 }else for(const c of contracts)values.set(c.id,cents(metric==='global'?c.current_contract_value:c.contractual_balance));
 const byId=new Map(contracts.map(c=>[c.id,c]));
 return [...values].map(([id,value])=>({id,value:value/100,contract:byId.get(id)})).sort((a,b)=>b.value-a.value||String(a.id).localeCompare(String(b.id)));
}

export function dashboardColumns(contracts,payments,executions,shifts,ym,metric='payments'){
 const year=ym.slice(0,4);
 const values=Array.from({length:12},(_,i)=>({ym:year+'-'+String(i+1).padStart(2,'0'),value:0}));
 if(metric==='payments'){
  for(const p of payments){
   const paidMonth=p.paid_at?.slice(0,7);
   if(p.status==='Pago'&&paidMonth?.slice(0,4)===year){
    const i=Number(paidMonth.slice(5,7))-1;if(i>=0&&i<12)values[i].value+=cents(p.value);
   }
  }
 }else for(const entry of values)for(const c of contracts.filter(c=>c.has_medical_shifts===true)){
  entry.value+=cents(productionForMonth(c.id,entry.ym,[],shifts,c).actual);
 }
 return values.map(entry=>({...entry,value:entry.value/100}));
}
