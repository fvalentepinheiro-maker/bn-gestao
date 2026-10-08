// Valores em centavos evitam acumular erros de arredondamento na apuração.
export const cents=value=>Math.round((Number(value||0)+Number.EPSILON)*100);
export const shiftAmount=row=>(Number(row.quantity_6h||0)*cents(row.unit_value_6h)+Number(row.quantity_12h||0)*cents(row.unit_value_12h))/100;
export const configuredShiftSectors=contract=>Array.isArray(contract?.medical_shift_sectors)?contract.medical_shift_sectors:[];
// Uma data pode ter vários lançamentos: soma as quantidades e os preços de cada registro.
export function groupShifts(rows,{daily=false,bySector=false}={}){
 const groups=new Map();
 for(const row of rows){
  if(row.execution_status==='Cancelada')continue;
  const period=daily?row.shift_date:row.shift_date.slice(0,7),sector=bySector?row.sector||null:null;
  const key=JSON.stringify([row.contract_id,period,sector,row.execution_status]);
  if(!groups.has(key))groups.set(key,{contract_id:row.contract_id,period,sector,status:row.execution_status,quantity_6h:0,quantity_12h:0,value_cents:0,entry_count:0});
  const g=groups.get(key);g.quantity_6h+=Number(row.quantity_6h||0);g.quantity_12h+=Number(row.quantity_12h||0);g.value_cents+=cents(row.production_value??shiftAmount(row));g.entry_count++;
 }
 return [...groups.values()].sort((a,b)=>a.period.localeCompare(b.period)||a.contract_id.localeCompare(b.contract_id)||(a.sector||'').localeCompare(b.sector||'')||a.status.localeCompare(b.status)).map(g=>({...g,total_shifts:g.quantity_6h+g.quantity_12h,hours:g.quantity_6h*6+g.quantity_12h*12,value:g.value_cents/100}));
}
export function productionForMonth(id,ym,executions,shifts,settings={}){
 const manual=executions.filter(x=>x.contract_id===id&&x.competence?.slice(0,7)===ym);
 const entries=shifts.filter(x=>x.contract_id===id&&x.shift_date?.slice(0,7)===ym&&x.execution_status!=='Cancelada');
 const total=status=>manual.filter(x=>x.execution_status===status).reduce((n,x)=>n+cents(x.production_value),0)+entries.filter(x=>x.execution_status===status).reduce((n,x)=>n+cents(x.production_value??shiftAmount(x)),0);
 const actual=total('Confirmada')/100,estimated=total('Estimada')/100,used=(total('Confirmada')+total('Estimada'))/100;
 const quantity_6h=entries.reduce((n,x)=>n+Number(x.quantity_6h||0),0),quantity_12h=entries.reduce((n,x)=>n+Number(x.quantity_12h||0),0);
 const confirmed_quantity_6h=entries.filter(x=>x.execution_status==='Confirmada').reduce((n,x)=>n+Number(x.quantity_6h||0),0),confirmed_quantity_12h=entries.filter(x=>x.execution_status==='Confirmada').reduce((n,x)=>n+Number(x.quantity_12h||0),0);
 const estimated_quantity_6h=quantity_6h-confirmed_quantity_6h,estimated_quantity_12h=quantity_12h-confirmed_quantity_12h;
 const teto=settings.default_monthly_cap==null?null:Number(settings.default_monthly_cap);
 return {actual,estimated,used,teto,remaining:teto==null?null:(cents(teto)-cents(used))/100,percent:teto>0?used/teto*100:null,quantity_6h,quantity_12h,confirmed_quantity_6h,confirmed_quantity_12h,estimated_quantity_6h,estimated_quantity_12h,hours:quantity_6h*6+quantity_12h*12,remaining_6h:settings.monthly_limit_6h==null?null:Number(settings.monthly_limit_6h)-quantity_6h,remaining_12h:settings.monthly_limit_12h==null?null:Number(settings.monthly_limit_12h)-quantity_12h,entry_count:entries.length,has_manual:manual.length>0};
}
export function periodMonths(start,end){
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(start)||!/^\d{4}-(0[1-9]|1[0-2])$/.test(end)||start>end)throw new Error('Informe um período válido, com o mês final igual ou posterior ao inicial.');
 const months=[];let y=Number(start.slice(0,4)),m=Number(start.slice(5));
 while(y+'-'+String(m).padStart(2,'0')<=end){months.push(y+'-'+String(m).padStart(2,'0'));m++;if(m>12){m=1;y++;}}
 return months;
}
