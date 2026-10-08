import {cents} from './production-model.mjs';

// Uso financeiro acumulado, com o valor global já atualizado pelos aditivos.
export function contractUsage(contract){
 const global=cents(contract.current_contract_value),paid=cents(contract.paid_value);
 return Number.isFinite(global)&&global>0&&Number.isFinite(paid)?paid*100/global:null;
}

const dateValue=value=>{
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
 const stamp=Date.parse(value+'T00:00:00Z');
 return Number.isFinite(stamp)&&new Date(stamp).toISOString().slice(0,10)===value?stamp:null;
};

export function contractExpiry(contract,referenceDate){
 if(!['active','suspended'].includes(contract.status))return null;
 const end=dateValue(contract.end_date),today=dateValue(referenceDate);
 if(end===null||today===null)return null;
 const days=Math.round((end-today)/86400000);
 if(days>60)return null;
 return {days,end_date:contract.end_date,severity:days<=30?'critical':'warning',
  title:days<0?'Vigência encerrada':days===0?'Vigência termina hoje':'Vigência próxima do fim'};
}
