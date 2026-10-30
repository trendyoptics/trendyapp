// Documento único: vista previa, impresión/PDF y archivo para compartir.
const DEFAULTS={
 nombre_optica:"ÓPTICA",titulo_documento:"HISTORIA CLÍNICA Y COMPROBANTE DE VENTA",
 nota_garantia:"NO SE DA GARANTÍA POR FÓRMULAS DE OTRO LUGAR.",
 pie_documento:"Comprobante comercial interno. No equivale a factura electrónica DIAN.",
 mensaje_whatsapp:"Gracias por elegir {optica}. Te compartimos la información de tu compra {venta} en PDF."
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
 const logo=await printableLogo(ctx.config.logo_data_url);
 const pdf=new jsPDF({unit:"mm",format:"letter",orientation:"portrait"});
 const W=215.9,H=279.4,pad=15,max=W-pad*2;
 let y=18,page=0;
 const colors={dark:[11,28,64],muted:[65,77,97]};
 function header(){
  if(page++)pdf.addPage();
  y=18;pdf.setTextColor(...colors.dark);pdf.setFont("helvetica","bold");pdf.setFontSize(16);
  if(logo){try{pdf.addImage(logo,"PNG",W-pad-22,11,21,21)}catch{}}
  pdf.text(txt(ctx.config.nombre_optica||"ÓPTICA").slice(0,55),pad,y);y+=7;
  pdf.setFontSize(10);pdf.text(txt(ctx.config.titulo_documento).slice(0,100),pad,y);y+=6;
  const contact=[
   ctx.config.nit_optica?"NIT: "+ctx.config.nit_optica:"",
   ctx.config.direccion_optica||"",
   ctx.config.telefono_optica?"Tel: "+ctx.config.telefono_optica:""
  ].filter(Boolean).join(" · ");
  if(contact){pdf.setFont("helvetica","normal");pdf.setFontSize(8);pdf.text(pdf.splitTextToSize(contact,max-26),pad,y);y+=5;}

  pdf.setDrawColor(150);pdf.line(pad,y,W-pad,y);y+=6;
 }
 function space(h=6){if(y+h>H-18)header();}
 function paragraph(text,{bold=false,size=10,indent=0}={}){
  const v=txt(text);if(!v)return;
  pdf.setTextColor(...(bold?colors.dark:colors.muted));pdf.setFont("helvetica",bold?"bold":"normal");pdf.setFontSize(size);
  const lines=pdf.splitTextToSize(v,max-indent);
  for(const line of lines){space(5);pdf.text(line,pad+indent,y);y+=4.8}
  y+=1;
 }
 function heading(t){space(12);y+=3;paragraph(t,{bold:true,size:12});}
 header();
 const {patient,history,sale,config}=ctx;
 paragraph("Documento de venta: V-"+String(sale.numero).padStart(6,"0")+" · "+fecha(sale.fecha));
 if(patient){
  heading("DATOS DEL PACIENTE");
  paragraph("Nombre: "+patient.nombre_completo+" · "+patient.tipo_documento+" "+patient.documento);
  paragraph("Nacimiento: "+(patient.fecha_nacimiento||"No registrado")+" · Teléfono: "+(patient.telefono||"No registrado"));
  paragraph("Dirección: "+(patient.direccion||"No registrada")+" · EPS: "+(patient.eps||"No registrada"));
 }else paragraph("Cliente: "+(sale.paciente?.nombre_completo||"Consumidor final"));
 if(history){
  heading("HISTORIA CLÍNICA · ÚLTIMA CONSULTA FINALIZADA");
  paragraph("Consulta: "+fecha(history.fecha_consulta)+" · Profesional: "+(history.optometra_nombre||"No registrado"));
  for(const group of clinicalRows(history)){heading(group.title);for(const [label,value] of group.rows)paragraph(label+": "+txt(value));}
 }
 heading("DETALLE DE LA VENTA");
 for(const line of sale.lineas||[])paragraph(line.codigo_snapshot+" · "+line.nombre_snapshot+" · Cantidad: "+line.cantidad+" · Unitario: "+money(line.precio_unitario)+" · Total: "+money(line.total_linea));
 paragraph("Total: "+money(sale.total)+"   Abonado: "+money(sale.abonado)+"   Saldo: "+money(sale.saldo),{bold:true,size:11});
 heading("PAGOS REGISTRADOS");
 if(!(sale.pagos||[]).length)paragraph("Sin pagos registrados");
 else for(const p of sale.pagos)paragraph(fecha(p.registrado_en)+" · "+p.medio+" · "+money(p.monto));
 heading("GARANTÍA Y CONDICIONES");
 paragraph(config.nota_garantia);
 paragraph(config.pie_documento);
 paragraph("Documento comercial interno. No equivale a factura electrónica DIAN.",{bold:true,size:9});
 const num=pdf.getNumberOfPages();
 for(let j=1;j<=num;j++){
  pdf.setPage(j);pdf.setTextColor(95);pdf.setFontSize(8);
  pdf.text("Página "+j+" de "+num,W-pad,H-9,{align:"right"});
 }
 const blob=pdf.output("blob");
 const filename="TsysOptics_V-"+String(sale.numero).padStart(6,"0")+".pdf";
 return {blob,filename};
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
