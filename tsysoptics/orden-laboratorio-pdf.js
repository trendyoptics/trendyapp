// Orden imprimible media carta (5.5 x 8.5 pulgadas), exclusiva para fabricación.
const moneyless=value=>value===null||value===undefined?"":String(value).trim();
const date=value=>value?new Date(value+"T12:00:00").toLocaleDateString("es-CO"):"SIN FECHA";
const lensFields=["odEsfera","odCilindro","odEje","odAdicion","odDnp","oiEsfera","oiCilindro","oiEje","oiAdicion","oiDnp","dp"];
const signed=value=>{
 const v=moneyless(value).replace(",",".");
 if(!v)return "—";
 const n=Number(v);
 return Number.isFinite(n)?(n>0?"+":"")+n.toFixed(2):v;
};
async function printableLogo(source){
 if(typeof source!=="string"||!/^data:image\\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(source)||source.length>210000)return null;
 const image=new Image();image.src=source;
 try{
  await image.decode();
  const canvas=document.createElement("canvas");
  const scale=Math.min(1,300/Math.max(image.naturalWidth,image.naturalHeight));
  canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));
  canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
  const context=canvas.getContext("2d");
  if(!context)return null;
  context.drawImage(image,0,0,canvas.width,canvas.height);
  return {data:canvas.toDataURL("image/png"),ratio:canvas.width/canvas.height};
 }catch{return null;}
}
export async function generateLabOrderPdf(db,order){
 const saleResult=await db.from("ventas_tsysoptics")
  .select("id,numero,fecha,paciente_id,estado,lineas:detalle_ventas_tsysoptics(codigo_snapshot,nombre_snapshot,cantidad)")
  .eq("id",order.venta_id).maybeSingle();
 if(saleResult.error||!saleResult.data)throw Error("No fue posible consultar la venta de esta orden.");
 const sale=saleResult.data;
 if(!sale.paciente_id)throw Error("Esta venta no tiene paciente registrado. Asocia un paciente antes de imprimir una orden con fórmula.");
 const [patientRes,historyRes,identityRes]=await Promise.all([
  db.from("pacientes_tsysoptics").select("nombre_completo,tipo_documento,documento,telefono").eq("id",sale.paciente_id).maybeSingle(),
  db.from("historias_clinicas_tsysoptics").select("fecha_consulta,optometra_nombre,datos_clinicos").eq("paciente_id",sale.paciente_id).eq("estado","finalizada").order("fecha_consulta",{ascending:false}).limit(1),
  db.from("identidad_optica_tsysoptics").select("nombre_optica,nit_optica,telefono_optica,logo_data_url").eq("id",1).maybeSingle()
 ]);
 if(patientRes.error||!patientRes.data||historyRes.error||identityRes.error)throw Error("No se pudieron consultar los datos clínicos o de la óptica.");
 const history=historyRes.data?.[0];
 if(!history)throw Error("El paciente no tiene una historia clínica finalizada. No se generará una orden sin fórmula.");
 const patient=patientRes.data,identity=identityRes.data||{},d=history.datos_clinicos||{};
 const logo=await printableLogo(identity.logo_data_url);
 const {jsPDF}=await import("https://esm.sh/jspdf@2.5.2");
 const pdf=new jsPDF({orientation:"landscape",unit:"mm",format:[215.9,139.7]});
 // Media carta REAL, apaisada: 21,59 x 13,97 cm.
 // Dos columnas eliminan el espacio vacío de la versión vertical.
 const navy=[11,28,64],grey=[85,95,110],M=8,COL=96,GAP=7;
 const left=M,right=M+COL+GAP;
 const write=(v,x,y)=>pdf.text(moneyless(v),x,y);
 const font=(n=7,bold=false)=>{pdf.setFont("helvetica",bold?"bold":"normal");pdf.setFontSize(n)};
 const section=(title,x,y)=>{
  pdf.setFillColor(232,237,246);pdf.rect(x,y-3,COL,6,"F");
  font(7.5,true);pdf.setTextColor(...navy);write(title,x+2,y+1);
  return y+9;
 };
 const field=(label,value,x,y,width=COL,limit=2)=>{
  if(!moneyless(value))return y;
  font(7,true);pdf.setTextColor(...navy);
  const prefix=label+": ";
  const pw=pdf.getTextWidth(prefix);
  write(prefix,x+1,y);
  font(7);pdf.setTextColor(...grey);
  const lines=pdf.splitTextToSize(moneyless(value),Math.max(22,width-pw-3)).slice(0,limit);
  lines.forEach((t,i)=>write(t,x+1+pw,y+i*3.7));
  return y+Math.max(1,lines.length)*4.3;
 };
 font(12,true);pdf.setTextColor(...navy);write("ORDEN DE LABORATORIO",M,11);
 font(7);write("TsysOptics - Sistema de gestión",M,16);
 font(9,true);write(identity.nombre_optica||"ÓPTICA",M,22);
 font(7);write("VENTA V-"+String(sale.numero).padStart(6,"0")+" · ORDEN "+order.id.slice(0,8).toUpperCase(),right,12);
 font(7);write("FECHA PREVISTA: "+date(order.fecha_entrega_estimada),right,18);
 if(logo){
  const maxWidth=20,maxHeight=20;
  const width=Math.min(maxWidth,maxHeight*logo.ratio);
  const height=width/logo.ratio;
  try{pdf.addImage(logo.data,"PNG",215.9-M-width,3,width,height);}catch{}
 }
 pdf.setDrawColor(...navy);pdf.setLineWidth(.25);pdf.line(M,26,215.9-M,26);
 let ly=section("PACIENTE Y LABORATORIO",left,33);
 ly=field("PACIENTE",patient.nombre_completo,left,ly);
 ly=field("DOCUMENTO",(patient.tipo_documento||"")+" "+(patient.documento||""),left,ly);
 ly=field("TELÉFONO",patient.telefono||"NO REGISTRADO",left,ly);
 ly=field("LABORATORIO",order.laboratorio,left,ly);
 ly=field("CONSULTA",history.fecha_consulta?new Date(history.fecha_consulta).toLocaleDateString("es-CO"):"",left,ly);
 ly=Math.max(ly+4,68);
 ly=section("FÓRMULA ÓPTICA",left,ly);
 const coords=[left+1,left+15,left+34,left+53,left+68,left+84];
 font(6.7,true);pdf.setTextColor(...navy);
 ["OJO","ESF","CIL","EJE","ADD","DNP"].forEach((v,i)=>write(v,coords[i],ly));
 ly+=5;
 for(const [eye,prefix] of [["OD","od"],["OI","oi"]]){
  const values=[eye,signed(d[prefix+"Esfera"]),signed(d[prefix+"Cilindro"]),moneyless(d[prefix+"Eje"])||"—",signed(d[prefix+"Adicion"]),moneyless(d[prefix+"Dnp"])||"—"];
  font(6.8);pdf.setTextColor(...grey);values.forEach((v,i)=>write(v,coords[i],ly));ly+=5.3;
 }
 ly=field("DP",d.dp,left,ly+1);
 let ry=section("LENTES, MONTURA Y MATERIALES",right,33);
 const lines=sale.lineas||[];
 if(!lines.length)ry=field("DETALLE","NO REGISTRADO",right,ry);
 for(const item of lines.slice(0,6)){
  const value=moneyless(item.nombre_snapshot)+" · "+moneyless(item.codigo_snapshot)+" · "+item.cantidad+" UND";
  const next=field("REF",value,right,ry,COL,2);
  if(next>94) {ry=field("ADICIONAL","CONSULTAR VENTA ORIGINAL",right,ry,COL,1);break}
  ry=next;
 }
 if(lines.length>6)ry=field("RESTO",String(lines.length-6)+" REFERENCIAS MÁS",right,ry,COL,1);
 ry=Math.max(ry+3,86);
 ry=section("INDICACIONES DE FABRICACIÓN",right,ry);
 ry=field("NOTAS",order.observaciones||"SIN INDICACIONES ADICIONALES",right,ry,COL,4);
 // No llevar el control al fondo: dejar sólo un espacio breve para firmas.
 const controlY=Math.min(Math.max(ry+4,109),120);
 font(7,true);pdf.setTextColor(...navy);write("RECIBIÓ: __________________  FECHA: __________",right,controlY);
 pdf.setDrawColor(170);pdf.line(right,controlY+5,right+COL,controlY+5);
 font(6.2);pdf.setTextColor(...grey);
 write("ORDEN INTERNA DE FABRICACIÓN · SIN VALORES COMERCIALES",M,133);
 const blob=pdf.output("blob");
 return {blob,filename:"Orden_Laboratorio_V-"+String(sale.numero).padStart(6,"0")+".pdf"};
}
export function downloadLabPdf(file){
 const url=URL.createObjectURL(file.blob);
 const a=document.createElement("a");a.href=url;a.download=file.filename;a.click();
 setTimeout(()=>URL.revokeObjectURL(url),30000);
}
