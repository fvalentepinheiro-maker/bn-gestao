// Regra informada pela GSER: dia 20 do mês seguinte ao mês do serviço.
export function paymentDeadline(competence){
 const ym=typeof competence==='string'?competence.slice(0,7):'';
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym))return null;
 let year=Number(ym.slice(0,4)),month=Number(ym.slice(5))+1;
 if(month===13){year++;month=1;}
 return String(year).padStart(4,'0')+'-'+String(month).padStart(2,'0')+'-20';
}

export function pendingPaymentMonths(contracts,payments,tracking,referenceDate){
 // O PAE ou a etapa, por si só, não representam um pagamento pendente.
 const ids=new Set(contracts.map(c=>c.id)),groups=new Map();
 const key=(id,ym)=>JSON.stringify([id,ym]);
 const add=(id,ym)=>{
  const due_date=paymentDeadline(ym);if(!ids.has(id)||!due_date)return;
  groups.set(key(id,ym),{contract_id:id,competence:ym,due_date,
   overdue:due_date<referenceDate,is_due_today:due_date===referenceDate});
 };
 for(const p of payments){
  if(!ids.has(p.contract_id)||!paymentDeadline(p.competence))continue;
  if(!['Pago','Cancelado'].includes(p.status)&&Number(p.value)>0)add(p.contract_id,p.competence.slice(0,7));
 }
 return [...groups.values()].sort((a,b)=>a.due_date.localeCompare(b.due_date)||a.contract_id.localeCompare(b.contract_id));
}
