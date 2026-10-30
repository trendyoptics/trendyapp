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
 const {jsPDF}=await import("https://esm.sh/jspdf@2.5.2");
 const pdf=new jsPDF({orientation:"portrait",unit:"mm",format:[139.7,215.9]});
 const L=9,R=130.7,W=R-L,MAX=202;
 let y=12;
 const dark=[11,28,64],soft=[85,95,110];
 const text=(value,x,yValue,opts)=>pdf.text(moneyless(value),x,yValue,opts);
 function font(size=7,bold=false){pdf.setFont("helvetica",bold?"bold":"normal");pdf.setFontSize(size)}
 function line(){pdf.setDrawColor(...dark);pdf.setLineWidth(.2);pdf.line(L,y,R,y);y+=3}
 function block(title){
  pdf.setFillColor(232,237,246);pdf.rect(L,y-3,W,5,"F");
  font(7.2,true);pdf.setTextColor(...dark);text(title,L+2,y);y+=6;
 }
 function row(label,value,{size=7,limit=2}={}){
  if(!moneyless(value))return;
  font(size,true);pdf.setTextColor(...dark);
  const labelText=label+": ";
  const labelWidth=pdf.getTextWidth(labelText);
  text(labelText,L+1,y);
  font(size);pdf.setTextColor(...soft);
  const words=pdf.splitTextToSize(moneyless(value),Math.max(20,W-labelWidth-3));
  for(const [i,part] of words.slice(0,limit).entries())text(part,L+1+labelWidth,y+i*3.4);
  y+=3.8*Math.min(words.length,limit)+1;
 }
 font(11,true);pdf.setTextColor(...dark);text("ORDEN DE LABORATORIO",L,y);y+=4;
 font(6.7);text("TsysOptics - Sistema de gestión",L,y);y+=4;
 font(8,true);text(identity.nombre_optica||"ÓPTICA",L,y);y+=4;
 font(6.5);text("N.º V-"+String(sale.numero).padStart(6,"0")+"   ·   ORDEN "+order.id.slice(0,8).toUpperCase(),L,y);y+=4;
 line();
 block("PACIENTE Y PEDIDO");
 row("PACIENTE",patient.nombre_completo);
 row("DOCUMENTO",(patient.tipo_documento||"")+" "+(patient.documento||""));
 row("TELÉFONO",patient.telefono||"NO REGISTRADO");
 row("LABORATORIO",order.laboratorio);
 row("ENTREGA ESTIMADA",date(order.fecha_entrega_estimada));
 row("CONSULTA",history.fecha_consulta?new Date(history.fecha_consulta).toLocaleDateString("es-CO"):"");
 line();
 block("FÓRMULA ÓPTICA");
 const col=[L+2,L+19,L+44,L+69,L+89,L+109];
 font(6.5,true);pdf.setTextColor(...dark);
 ["OJO","ESF","CIL","EJE","ADD","DNP"].forEach((z,i)=>text(z,col[i],y));y+=5;
 for(const [eye,prefix] of [["OD","od"],["OI","oi"]]){
  const values=[eye,signed(d[prefix+"Esfera"]),signed(d[prefix+"Cilindro"]),moneyless(d[prefix+"Eje"])||"—",signed(d[prefix+"Adicion"]),moneyless(d[prefix+"Dnp"])||"—"];
  font(7);pdf.setTextColor(...soft);values.forEach((z,i)=>text(z,col[i],y));y+=5;
 }
 row("DISTANCIA PUPILAR",d.dp);
 line();
 block("LENTES, MONTURA Y ESPECIFICACIONES");
 const lines=sale.lineas||[];
 if(!lines.length)row("DETALLE","NO REGISTRADO");
 for(const item of lines.slice(0,6)){
  if(y>160)break;
  row("REFERENCIA",item.nombre_snapshot+" · "+item.codigo_snapshot+" · CANT: "+item.cantidad,{size:6.8,limit:2});
 }
 if(lines.length>6)row("OTRAS REFERENCIAS",String(lines.length-6)+" MÁS");
 line();
 block("INDICACIONES PARA FABRICACIÓN");
 row("OBSERVACIONES",order.observaciones||"SIN INDICACIONES ADICIONALES",{size:6.7,limit:5});
 if(d.dp)row("DP",d.dp);
 // Espacio libre para apuntes y control de calidad del laboratorio.
 y=Math.min(Math.max(y+5,174),184);
 font(7);pdf.setTextColor(...dark);text("CONTROL DEL LABORATORIO",L,y);y+=6;
 pdf.setDrawColor(170);pdf.line(L,y,R,y);y+=9;pdf.line(L,y,R,y);y+=9;
 font(6.2);pdf.setTextColor(...soft);
 text("RECIBIÓ: ___________________    FECHA: __________",L,203);
 text("ORDEN INTERNA DE FABRICACIÓN · SIN VALORES COMERCIALES",L,210);
 const blob=pdf.output("blob");
 return {blob,filename:"Orden_Laboratorio_V-"+String(sale.numero).padStart(6,"0")+".pdf"};
}
export function downloadLabPdf(file){
 const url=URL.createObjectURL(file.blob);
 const a=document.createElement("a");a.href=url;a.download=file.filename;a.click();
 setTimeout(()=>URL.revokeObjectURL(url),30000);
}
