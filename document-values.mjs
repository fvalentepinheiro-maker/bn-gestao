// PDF.js 5.6.205, Mozilla, Apache-2.0; arquivos distribuídos localmente.
export function monetaryCandidates(text) {
 const candidates=[];const seen=new Set();
 const pattern=/(?:R\$\s*)?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}\b/g;
 for(const match of text.matchAll(pattern)) {
  const amount=Number(match[0].replace(/R\$|\s|\./g,'').replace(',','.'));
  if(!Number.isFinite(amount)||amount<0||seen.has(amount))continue;
  seen.add(amount);candidates.push({amount,context:text.slice(Math.max(0,match.index-100),match.index+match[0].length+100).replace(/\s+/g,' ').trim()});
  if(candidates.length===150)break;
 }
 return candidates;
}
export async function readDocumentValues(file) {
 if(file.size>20*1024*1024)throw new Error('O arquivo excede 20 MB.');
 if(/\.txt$/i.test(file.name))return monetaryCandidates(await file.text());
 if(!/\.pdf$/i.test(file.name))throw new Error('A leitura de valores aceita PDF com texto ou TXT. Confira os demais arquivos e informe o valor no campo.');
 const pdfjs=await import('./vendor/pdf.mjs');
 pdfjs.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdf.worker.mjs',import.meta.url).href;
 const fontUrl=new URL('./vendor/standard_fonts/',import.meta.url);
 const fonts=fontUrl.protocol==='file:'?decodeURIComponent(fontUrl.pathname):fontUrl.href;
 const task=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false,standardFontDataUrl:fonts});
 let pdf;
 try {
  pdf=await task.promise;
  if(pdf.numPages>200)throw new Error('O PDF tem mais de 200 páginas. Informe os valores após conferir o documento.');
  let text='';
  for(let n=1;n<=pdf.numPages;n++) {
   const page=await pdf.getPage(n);const content=await page.getTextContent();
   text+=content.items.map(item=>item.str+(item.hasEOL?'\n':' ')).join('')+'\n';page.cleanup();
  }
  return monetaryCandidates(text);
 }finally{await task.destroy();}
}
