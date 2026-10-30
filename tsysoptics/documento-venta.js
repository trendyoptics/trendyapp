// Documento único: vista previa, impresión/PDF y archivo para compartir.
const DEFAULTS={
 nombre_optica:"ÓPTICA",titulo_documento:"HISTORIA CLÍNICA Y COMPROBANTE DE VENTA",
 nota_garantia:"NO SE DA GARANTÍA POR FÓRMULAS DE OTRO LUGAR.",
 pie_documento:"Comprobante comercial interno. No equivale a factura electrónica DIAN.",
 mensaje_whatsapp:"¡Nos alegra que nos hayas elegido! Gracias por confiar en {optica}. Te compartimos tu documento de compra {venta} en PDF. ¡Disfruta tus nuevos lentes!"
};
const money=n=>new Intl.NumberFormat("es-CO",{style:"currency",currency:"COP",maximumFractionDigits:2}).format(Number(n)||0);
const fecha=d=>new Date(d).toLocaleString("es-CO",{timeZone:"America/Bogota",dateStyle:"medium",timeStyle:"short"});
const txt=v=>v===null||v===undefined?"":String(v).trim();
function fromHistory(d,key){return txt(d?.[key])}
export async function loadDocumentContext(sb,sale){
 const id=sale.paciente_id;
 const queries=[
  sb.from("identidad_optica_tsysoptics").select("nombre_optica,logo_data_url,nit_optica,direccion_optica,telefono_optica,titulo_documento,nota_garantia,pie_documento,mensaje_whatsapp").eq("id",1).maybeSingle(),
  id?sb.from("pacientes_tsysoptics").select("nombre_completo,tipo_documento,documento,fecha_nacimiento,telefono,direccion,eps").eq("id",id).maybeSingle():Promise.resolve({data:null,error:null}),
  id?sb.from("historias_clinicas_tsysoptics").select("fecha_consulta,optometra_nombre,datos_clinicos,estado").eq("paciente_id",id).eq("estado","finalizada").order("fecha_consulta",{ascending:false}).limit(1):Promise.resolve({data:[],error:null})
 ];
 const [identity,patient,histories]=await Promise.all(queries);
 if(identity.error)throw Error("No se pudo consultar la personalización de documentos.");
 if(id&&(patient.error||histories.error))throw Error("No se pudo consultar la historia clínica del paciente. No se generará un documento incompleto.");
 const config={...DEFAULTS,...identity.data};
 const history=histories.data?.[0]||null;
 return {sale,config,patient:patient.data||null,history};
}
const exclusion=new Set(["nombre","documento","tipoDoc","direccion","telefono","eps","fechaNacimiento","fechaConsulta","horaConsulta","optometra","timestamp","id","modo","metodoPago","valorAbonado","precioTotal","saldoPendiente","montura"]);
function clinicalRows(history){
 const d=history?.datos_clinicos||{};
 const groups=[
  ["Motivo de consulta",[["Motivo",d.motivoConsulta||d.motivo],["Antecedentes",d.antecedentes],["Ocupación",d.ocupacion]]],
  ["Agudeza visual",[["OD sin corrección lejos",d.avScOdLejos],["OI sin corrección lejos",d.avScOiLejos],["OD cerca",d.odAvCerca||d.avScOdCerca],["OI cerca",d.oiAvCerca||d.avScOiCerca]]],
  ["Fórmula óptica",[["OD esfera",d.odEsfera],["OD cilindro",d.odCilindro],["OD eje",d.odEje],["OD adición",d.odAdicion],["OD DNP",d.odDnp],["OI esfera",d.oiEsfera],["OI cilindro",d.oiCilindro],["OI eje",d.oiEje],["OI adición",d.oiAdicion],["OI DNP",d.oiDnp],["Distancia pupilar",d.dp]]],
  ["Exploración",[["Biomicroscopía",d.biomicroscopia],["Oftalmoscopía",d.oftalmoscopia],["Motilidad",d.motilidad]]],
  ["Diagnóstico y recomendaciones",[["Diagnóstico",d.diagnostico],["Observaciones",d.notas],["CIE-10",Array.from({length:5},(_,i)=>d["cie"+(i+1)]).filter(Boolean).join("; ")]]]
 ];
 const used=new Set();
 for(const g of groups)for(const [k,v] of g[1])if(txt(v))used.add(k);
 const out=[];
 for(const [title,rows] of groups){
  const cleaned=rows.filter(x=>txt(x[1]));
  if(cleaned.length)out.push({title,rows:cleaned});
 }
 const covered=new Set([...exclusion,"motivoConsulta","motivo","antecedentes","ocupacion","avScOdLejos","avScOiLejos","odAvCerca","oiAvCerca","avScOdCerca","avScOiCerca","odEsfera","odCilindro","odEje","odAdicion","odDnp","oiEsfera","oiCilindro","oiEje","oiAdicion","oiDnp","dp","biomicroscopia","oftalmoscopia","motilidad","diagnostico","notas",..."12345".split("").map(n=>"cie"+n)]);
 const extras=Object.entries(d).filter(([k,v])=>!covered.has(k)&&txt(v)&&typeof v!=="object").slice(0,50);
 if(extras.length)out.push({title:"Otros hallazgos registrados",rows:extras});
 return out;
}
export function previewDocument(ctx,container,notice){
 container.replaceChildren();
 const {history,patient}=ctx;
 notice.textContent=history
  ?"Última historia clínica finalizada: "+fecha(history.fecha_consulta)+". Se incluirá antes del detalle de la venta."
  :patient?"No hay historia clínica finalizada para este paciente. El documento incluirá solo la venta, sin crear datos clínicos."
  :"Venta sin paciente registrado: se generará únicamente el comprobante comercial.";
 if(!history)return;
 const title=document.createElement("h3");title.textContent="Historia clínica asociada";container.append(title);
 const meta=document.createElement("p");
 meta.textContent="Fecha: "+fecha(history.fecha_consulta)+" · Optómetra: "+(history.optometra_nombre||"No indicado");
 container.append(meta);
 for(const group of clinicalRows(history).slice(0,6)){
  const heading=document.createElement("strong");heading.textContent=group.title;
  container.append(heading);
  const p=document.createElement("p");
  p.style.whiteSpace="pre-wrap";
  p.textContent=group.rows.map(([name,value])=>name+": "+txt(value)).join("\n");
  container.append(p);
 }
}
export function shareMessage(ctx){
 const {config,sale,patient}=ctx;
 return (config.mensaje_whatsapp||DEFAULTS.mensaje_whatsapp)
  .replaceAll("{optica}",config.nombre_optica||DEFAULTS.nombre_optica)
  .replaceAll("{paciente}",patient?.nombre_completo||sale.paciente?.nombre_completo||"cliente")
  .replaceAll("{venta}","V-"+String(sale.numero).padStart(6,"0"));
}
async function printableLogo(source){
 if(typeof source!=="string"||!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(source)||source.length>210000)return null;
 const img=new Image();img.src=source;
 try{
  await img.decode();
  const canvas=document.createElement("canvas");
  const scale=Math.min(1,300/Math.max(img.naturalWidth,img.naturalHeight));
  canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));
  canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
  const context=canvas.getContext("2d");
  if(!context)return null;
  context.drawImage(img,0,0,canvas.width,canvas.height);
  return canvas.toDataURL("image/png");
 }catch{return null;}
}
export async function createSalePdf(ctx){
 const {jsPDF}=await import("https://esm.sh/jspdf@2.5.2");
 const pdf=new jsPDF({unit:"mm",format:"letter",orientation:"portrait"});
 const {sale,patient,history,config}=ctx;
 const logo=await printableLogo(config.logo_data_url);
 const W=215.9,H=279.4,L=12,R=203.9,CW=R-L;
 const NAVY=[11,28,64],GREY=[75,89,111],PALE=[233,238,246];
 const LIMIT=196,SALE_TOP=207,SALE_BOTTOM=270;
 const d=history?.datos_clinicos||{};
 const continuation=[];
 function color(rgb=NAVY){pdf.setTextColor(...rgb)}
 function font(size=8,bold=false){pdf.setFont("helvetica",bold?"bold":"normal");pdf.setFontSize(size)}
 function rule(y){pdf.setDrawColor(...NAVY);pdf.setLineWidth(.25);pdf.line(L,y,R,y)}
 function section(name,y,x=L,width=CW){
  if(y>=LIMIT&&name.startsWith("0")&&!name.startsWith("03"))return y;
  pdf.setFillColor(...PALE);pdf.rect(x,y-3.5,width,5.5,"F");
  color();font(8,true);pdf.text(name,x+2,y);return y+5;
 }
 function fitLines(value,width,size=7.3){
  font(size);return pdf.splitTextToSize(txt(value),width);
 }
 function cell(label,value,x,y,w,{size=7.3,maxLines=3}={}){
  if(!txt(value))return y;
  font(size,true);color();pdf.text(label,x,y);
  const gap=pdf.getTextWidth(label)+2;
  font(size);color(GREY);
  const lines=fitLines(value,Math.max(15,w-gap),size);
  const visible=lines.slice(0,maxLines);
  for(let i=0;i<visible.length;i++)pdf.text(visible[i],x+gap,y+i*3.4);
  if(lines.length>visible.length)continuation.push(label+" "+lines.slice(visible.length).join(" "));
  return y+Math.max(1,visible.length)*3.6+1;
 }
 function clinicalLine(label,value,y,{size=7.2,maxLines=3}={}){
  if(!txt(value))return y;
  const lines=fitLines(label+": "+txt(value),CW-4,size);
  const amount=Math.min(maxLines,lines.length);
  if(y+amount*3.4>LIMIT){continuation.push(label+": "+txt(value));return y;}
  font(size);color(GREY);
  for(let k=0;k<amount;k++)pdf.text(lines[k],L+2,y+k*3.4);
  if(lines.length>amount)continuation.push(label+": "+lines.slice(amount).join(" "));
  return y+amount*3.4+1;
 }
 function addHeading(label,y){
  if(y+8>LIMIT){continuation.push("§ "+label);return y;}
  return section(label,y);
 }
 function headingBlock(title,entries,y,options={}){
  const items=entries.filter(([k,v])=>txt(v));
  if(!items.length)return y;
  if(y+8>LIMIT){continuation.push(title+": "+items.map(([k,v])=>k+" "+txt(v)).join("; "));return y;}
  y=addHeading(title,y);
  for(const [key,val] of items)y=clinicalLine(key,val,y,options);
  return y+1;
 }
 function headline(){
  color();font(13,true);
  pdf.text(txt(config.nombre_optica||"ÓPTICA").slice(0,58),L,15);
  font(6.5);color(GREY);pdf.text("TsysOptics - Sistema de gestión",L,9);
  font(8,true);pdf.text(txt(config.titulo_documento||"HISTORIA CLÍNICA Y COMPROBANTE DE VENTA").slice(0,96),L,20);
  if(logo){try{pdf.addImage(logo,"PNG",R-19,8,18,18)}catch{}}
  const contact=[config.nit_optica?"NIT: "+config.nit_optica:"",
   config.direccion_optica||"",config.telefono_optica?"TEL: "+config.telefono_optica:""]
   .filter(Boolean).join("  ·  ");
  font(7);color(GREY);
  const lines=fitLines(contact,CW-26,7).slice(0,2);
  lines.forEach((line,i)=>pdf.text(line,L,24+i*3));
  rule(31);
 }
 headline();
 let y=37;
 y=section("01  ·  DATOS DEL PACIENTE",y);
 if(patient){
  const row1Y=y;
  const first=cell("PACIENTE:",patient.nombre_completo,L+2,row1Y,105,{maxLines:2});
  const second=cell("DOCUMENTO:",(patient.tipo_documento||"")+" "+(patient.documento||""),L+111,row1Y,77,{maxLines:2});
  y=Math.max(first,second);
  const birth=cell("NACIMIENTO:",patient.fecha_nacimiento||"",L+2,y,91);
  const tel=cell("TELÉFONO:",patient.telefono||"NO REGISTRADO",L+101,y,87);
  y=Math.max(birth,tel);
  const dir=cell("DIRECCIÓN:",patient.direccion||"",L+2,y,120,{maxLines:2});
  const eps=cell("EPS:",patient.eps||"",L+125,y,63,{maxLines:2});
  y=Math.max(dir,eps)+1;
 }else{y=clinicalLine("CLIENTE",sale.paciente?.nombre_completo||"CONSUMIDOR FINAL",y);}
 if(history){
  y=section("02  ·  HISTORIA CLÍNICA Y EVALUACIÓN",y);
  y=clinicalLine("CONSULTA",fecha(history.fecha_consulta)+"  ·  PROFESIONAL: "+(history.optometra_nombre||"NO REGISTRADO"),y);
  y=headingBlock("MOTIVO Y ANTECEDENTES",[
   ["MOTIVO",d.motivoConsulta||d.motivo],["ANTECEDENTES",d.antecedentes],["OCUPACIÓN",d.ocupacion]
  ],y,{size:7.1,maxLines:3});
  if(y+24<LIMIT){
   y=section("AGUDEZA VISUAL",y);
   const headers=["OJO","SIN CORRECCIÓN LEJOS","SIN CORRECCIÓN CERCA","CON CORRECCIÓN LEJOS","CON CORRECCIÓN CERCA"];
   const widths=[15,44,44,44,44];let x=L;
   pdf.setFillColor(247,248,251);pdf.rect(L,y-3.2,CW,5.5,"F");
   font(6.1,true);color();
   headers.forEach((v,i)=>{pdf.text(v,x+1,y,{maxWidth:widths[i]-2});x+=widths[i]});
   y+=5;
   const rows=[
    ["OD",d.avScOdLejos,d.avScOdCerca,d.odAvLejos,d.odAvCerca],
    ["OI",d.avScOiLejos,d.avScOiCerca,d.oiAvLejos,d.oiAvCerca]
   ];
   for(const row of rows){x=L;font(7);color(GREY);row.forEach((v,i)=>{pdf.text(txt(v)||"—",x+1,y,{maxWidth:widths[i]-2});x+=widths[i]});y+=5}
   y+=1;
  }
  if(y+30<LIMIT){
   y=section("FÓRMULA ÓPTICA",y);
   const widths=[15,32,32,28,36,48];let x=L;
   font(6.7,true);color();
   ["OJO","ESFERA","CILINDRO","EJE","ADICIÓN","DNP"].forEach((v,i)=>{pdf.text(v,x+1,y);x+=widths[i]});
   y+=5;
   const rows=[["OD",d.odEsfera,d.odCilindro,d.odEje,d.odAdicion,d.odDnp],["OI",d.oiEsfera,d.oiCilindro,d.oiEje,d.oiAdicion,d.oiDnp]];
   const dioptrias=value=>{
    const raw=txt(value).replace(",",".");
    if(!raw||raw==="—"||raw.toUpperCase()==="NO APLICA")return raw||"—";
    const number=Number(raw);
    if(!Number.isFinite(number))return raw;
    return (number>0?"+":"")+number.toFixed(2);
   };
   for(const row of rows){
    x=L;font(7.6);color(GREY);
    row.forEach((v,i)=>{
     const display=i===1||i===2||i===4?dioptrias(v):txt(v)||"—";
     pdf.text(display,x+1,y,{maxWidth:widths[i]-2});x+=widths[i];
    });y+=5
   }
   y=clinicalLine("DISTANCIA PUPILAR",d.dp,y);
  }else continuation.push("FÓRMULA: OD "+[d.odEsfera,d.odCilindro,d.odEje,d.odAdicion,d.odDnp].join(" / ")+"; OI "+[d.oiEsfera,d.oiCilindro,d.oiEje,d.oiAdicion,d.oiDnp].join(" / "));
  y=headingBlock("DIAGNÓSTICO, REMISIONES Y OBSERVACIONES",[
   ["DIAGNÓSTICO",d.diagnostico],
   ["CIE-10",[d.cie1,d.cie2,d.cie3,d.cie4,d.cie5].filter(Boolean).join("; ")],
   ["NOTAS / CONDUCTA",d.notas],["REMISIONES",d.remisiones||d.remision||d.recomendaciones],
   ["CONTROL",d.control||d.proximoControl]
  ],y,{size:7,maxLines:4});
  y=headingBlock("HALLAZGOS DEL EXAMEN",[
   ["BIOMICROSCOPÍA",d.biomicroscopia],["OFTALMOSCOPÍA",d.oftalmoscopia],
   ["MOTILIDAD",d.motilidad],["LENSOMETRÍA OD",d.lensoOd],["LENSOMETRÍA OI",d.lensoOi]
  ],y,{size:7,maxLines:3});
  const covered=new Set(["motivoConsulta","motivo","antecedentes","ocupacion","avScOdLejos","avScOiLejos","avScOdCerca","avScOiCerca","odAvLejos","oiAvLejos","odAvCerca","oiAvCerca","odEsfera","odCilindro","odEje","odAdicion","odDnp","oiEsfera","oiCilindro","oiEje","oiAdicion","oiDnp","dp","biomicroscopia","oftalmoscopia","motilidad","lensoOd","lensoOi","diagnostico","cie1","cie2","cie3","cie4","cie5","notas","remisiones","remision","recomendaciones","control","proximoControl",...exclusion]);
  const extra=Object.entries(d).filter(([key,value])=>!covered.has(key)&&txt(value)&&typeof value!=="object");
  if(extra.length&&y<165)y=headingBlock("OTROS DATOS CLÍNICOS",extra.slice(0,8),y,{size:6.6,maxLines:1});
 }else{
  y=section("02  ·  HISTORIA CLÍNICA",y);
  y=clinicalLine("ESTADO",patient?"No hay consulta finalizada para este paciente.":"Venta sin paciente registrado.",y);
 }
 // Resumen clínico-comercial en una hoja carta. La historia completa permanece
 // en el expediente digital; no se genera una segunda hoja ni se superponen textos.
 if(continuation.length){
  font(6.5,true);color(GREY);
  pdf.text("EL DETALLE CLÍNICO COMPLETO SE CONSERVA EN LA HISTORIA DIGITAL.",L+2,202);
 }
 pdf.setDrawColor(...NAVY);pdf.setLineWidth(.4);
 pdf.line(L,SALE_TOP-2,R,SALE_TOP-2);
 y=section("03  ·  DETALLE DE VENTA Y GARANTÍAS",SALE_TOP+3);
 font(7);color();
 pdf.text("VENTA V-"+String(sale.numero).padStart(6,"0")+"  ·  "+fecha(sale.fecha),L+2,y);
 y+=4;
 font(6.6,true);color();
 pdf.text("PRODUCTO / LENTE / MONTURA",L+2,y);
 pdf.text("CANT.",L+119,y);
 pdf.text("VALOR",R-2,y,{align:"right"});
 y+=3.4;
 const saleLines=sale.lineas||[];
 for(const item of saleLines.slice(0,3)){
  font(6.6);color(GREY);
  const label=txt(item.nombre_snapshot||item.codigo_snapshot);
  const maxLen=80;
  const display=label.length>maxLen?label.slice(0,maxLen-1)+"…":label;
  pdf.text(display,L+2,y,{maxWidth:114});
  pdf.text(txt(item.cantidad)||"1",L+121,y);
  pdf.text(money(item.total_linea),R-2,y,{align:"right"});
  y+=3.7;
 }
 if(saleLines.length>3){font(6.2);color(GREY);pdf.text("Y "+(saleLines.length-3)+" REFERENCIA(S) MÁS. TOTAL INCLUIDO EN EL RESUMEN.",L+2,y);}
 const sumY=SALE_TOP+29;
 pdf.setFillColor(...PALE);pdf.rect(L,sumY-3,CW,10,"F");
 font(7.7,true);color();
 pdf.text("TOTAL",L+2,sumY);
 pdf.text(money(sale.total),L+18,sumY);
 pdf.text("ABONADO",L+74,sumY);
 pdf.text(money(sale.abonado),L+99,sumY);
 pdf.text("SALDO",L+151,sumY);
 pdf.text(money(sale.saldo),R-2,sumY+4,{align:"right"});
 const payments=(sale.pagos||[]).map(p=>p.medio+": "+money(p.monto)).join(" · ");
 font(6.2);color(GREY);
 const paytext=payments?"PAGOS: "+payments:"PAGOS: SIN PAGOS REGISTRADOS";
 pdf.text(fitLines(paytext,CW-4,6.2).slice(0,1),L+2,SALE_TOP+39);
 const guarantees=[
  "LENTES: GARANTÍA DE 6 MESES, EXCEPTO DAÑOS POR MAL USO.",
  "MONTURAS: GARANTÍA DE 4 MESES, EXCEPTO DAÑOS POR MAL USO.",
  txt(config.nota_garantia)||"NO SE DA GARANTÍA POR FÓRMULAS DE OTRO LUGAR."
 ];
 font(6.5,true);color();
 let warrantyY=SALE_TOP+45;
 for(const statement of guarantees){
  const wrapped=fitLines(statement,CW-3,6.5);
  pdf.text(wrapped.slice(0,2),L+2,warrantyY);
  warrantyY+=wrapped.slice(0,2).length*2.8+1;
 }
 if(txt(config.pie_documento)&&warrantyY<268){
  font(6);color(GREY);pdf.text(fitLines(config.pie_documento,CW-4,6).slice(0,1),L+2,warrantyY+1);
 }
 const count=pdf.getNumberOfPages();
 for(let k=1;k<=count;k++){
  pdf.setPage(k);font(7);color(GREY);
  pdf.text("PÁGINA "+k+" DE "+count,R,H-9,{align:"right"});
  if(k===1)pdf.text("TsysOptics - Sistema de gestión · COMPROBANTE INTERNO. NO EQUIVALE A FACTURA ELECTRÓNICA DIAN.",L,H-9);
 }
 return {blob:pdf.output("blob"),filename:"TsysOptics_V-"+String(sale.numero).padStart(6,"0")+".pdf"};
}
export function savePdf(blob,name){
 const url=URL.createObjectURL(blob);
 const link=document.createElement("a");link.href=url;link.download=name;link.click();
 setTimeout(()=>URL.revokeObjectURL(url),30000);
}
export async function shareSalePdf(ctx,pdfFile){
 const message=shareMessage(ctx);
 const file=new File([pdfFile.blob],pdfFile.filename,{type:"application/pdf"});
 if(navigator.canShare?.({files:[file]})&&navigator.share){
  await navigator.share({title:ctx.config.nombre_optica,text:message,files:[file]});
  return "Se abrió el menú para compartir el archivo PDF. Selecciona WhatsApp.";
 }
 // WhatsApp web no permite anexar un PDF mediante wa.me; guardar y pedir adjuntarlo.
 savePdf(pdfFile.blob,pdfFile.filename);
 const url="https://wa.me/?text="+encodeURIComponent(message);
 window.open(url,"_blank","noopener,noreferrer");
 return "PDF descargado. En WhatsApp adjunta manualmente el archivo "+pdfFile.filename+" antes de enviar.";
}
