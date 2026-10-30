import {createClient} from "https://esm.sh/@supabase/supabase-js@2";
import {SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY} from "./supabase-config.js";
const db=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{flowType:"pkce",persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const $=id=>document.getElementById(id);
const money=x=>new Intl.NumberFormat("es-CO",{style:"currency",currency:"COP",maximumFractionDigits:0}).format(Number(x)||0);
const today=()=>new Intl.DateTimeFormat("sv-SE",{timeZone:"America/Bogota",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=String(text??"");if(cls)e.className=cls;return e};
const set=(id,text)=>{$(id).textContent=text};
const formatNum=v=>String(v).padStart(6,"0");
let allowed=false,busy=false,request=0,patients=[],quotes=[],items=[];
const states={borrador:"Borrador",enviada:"Enviada",aprobada:"Aprobada",rechazada:"Rechazada",convertida:"Convertida"};
const num=(raw)=>{const v=window.tsysParseCOP?.(String(raw??"").trim());return Number.isFinite(v)?v:NaN};
async function isAdmin(){
 const {data,error}=await db.auth.getUser();if(error||!data?.user)return false;
 const {data:p,error:e}=await db.from("usuarios_tsysoptics").select("activo,rol").eq("id",data.user.id).maybeSingle();
 return !e&&p?.activo&&p.rol==="administrador";
}
function reset(){
 allowed=false;request++;items=[];patients=[];quotes=[];
 window.tsysCotizacionesSetPendientes?.(null);
 window.tsysCotizacionesSetVencidas?.(null);
 for(const id of ["cot-items","cot-lista"])$(id).replaceChildren();
 $("cot-guardar").disabled=true;$("cot-refrescar").disabled=true;set("cot-status","Acceso reservado al administrador.");
}
function options(id,values,placeholder){
 const field=$(id),selected=field.value;field.replaceChildren(new Option(placeholder,""));
 for(const [value,label] of values)field.append(new Option(label,value));
 if(values.some(([v])=>v===selected))field.value=selected;
}
function renderItems(){
 const box=$("cot-items");box.replaceChildren();
 for(const [index,x] of items.entries()){
  const row=el("div",undefined,"item cot-item"),info=el("div");
  info.append(el("strong",(x.tipo?x.tipo+" · ":"")+x.nombre));
  info.append(el("small",x.cantidad+" x "+money(x.precio_unitario)+" = "+money(x.cantidad*x.precio_unitario)));
  const del=el("button","Quitar","btn alt");del.type="button";
  del.addEventListener("click",()=>{items.splice(index,1);renderItems()});
  row.append(info,del);box.append(row);
 }
 if(!items.length)box.append(el("p","Sin conceptos. Escribe la descripción y el precio negociado de la montura, el lente o ambos.","muted"));
 set("cot-total",money(items.reduce((sum,x)=>sum+x.cantidad*x.precio_unitario,0)));
}
function addItem(tipo){
 const montura=tipo==="Montura";
 const descripcion=$(montura?"cot-montura-descripcion":"cot-lente-descripcion");
 const cantidad=$(montura?"cot-montura-cantidad":"cot-lente-cantidad");
 const precio=$(montura?"cot-montura-precio":"cot-lente-precio");
 const nombre=descripcion.value.trim().toLocaleUpperCase("es-CO");
 const n=Number(cantidad.value),unit=num(precio.value);
 if(nombre.length<3||nombre.length>120){set("cot-form-status","Escribe una descripción de "+(montura?"montura":"lente")+" de 3 a 120 caracteres.");descripcion.focus();return}
 if(!Number.isSafeInteger(n)||n<1||n>100||!Number.isFinite(unit)||unit<0||unit>999999999){
  set("cot-form-status","Ingresa cantidad entre 1 y 100 y precio válido para "+(montura?"montura":"lente")+".");return;
 }
 if(items.length>=20){set("cot-form-status","Máximo 20 conceptos por cotización.");return}
 items.push({tipo,nombre,cantidad:n,precio_unitario:unit});
 descripcion.value="";cantidad.value="";precio.value="";
 renderItems();
 set("cot-form-status",(montura?"Montura":"Lente")+" agregado sin crear referencias de inventario.");
}
function quotePatient(q){return patients.find(p=>p.id===q.paciente_id)}
async function printQuote(q,button){
 button.disabled=true;set("cot-status","Preparando PDF…");
 try{
  const {jsPDF}=await import("https://esm.sh/jspdf@2.5.2");
  const {data:business}=await db.from("identidad_optica_tsysoptics").select("nombre_optica,logo_data_url,nit_optica,direccion_optica,telefono_optica").limit(1).maybeSingle();
  const doc=new jsPDF({unit:"mm",format:"a4"});
  const navy=[11,28,64],gray=[88,95,115];
  let y=18;
  doc.setFillColor(...navy);doc.rect(0,0,210,34,"F");
  let textX=16;
  if(business?.logo_data_url?.startsWith("data:image/")){
   try{doc.addImage(business.logo_data_url,"PNG",16,5,24,24);textX=44}catch{}
  }
  doc.setTextColor(255);doc.setFont("helvetica","bold");doc.setFontSize(16);
  doc.text(String(business?.nombre_optica||"TsysOptics").slice(0,35),textX,16);
  doc.setFontSize(10);doc.text("COTIZACIÓN Nº COT-"+formatNum(q.numero),textX,24);
  doc.setTextColor(...navy);y=43;doc.setFontSize(10);doc.setFont("helvetica","normal");
  const patient=quotePatient(q);
  for(const line of [
    "Fecha: "+q.fecha+"   Válida hasta: "+q.vigente_hasta,
    "Cliente: "+(q.cliente_nombre||patient?.nombre_completo||"No registrado"),
    "Documento: "+(q.cliente_documento||patient?.documento||"No indicado"),
    "Teléfono del cliente: "+(q.cliente_telefono||"No indicado"),
    "NIT: "+(business?.nit_optica||"No registrado"),
    "Dirección: "+(business?.direccion_optica||"") + "  Teléfono: "+(business?.telefono_optica||"")
  ]){doc.text(doc.splitTextToSize(line,178),16,y);y+=8;}
  y+=4;doc.setFillColor(239,243,248);doc.rect(14,y-6,182,9,"F");
  doc.setFont("helvetica","bold");doc.text("PRODUCTO",17,y);doc.text("CANT.",135,y);doc.text("TOTAL",188,y,{align:"right"});y+=9;
  doc.setFont("helvetica","normal");doc.setTextColor(...gray);
  for(const item of q.items){
   if(y>265){doc.addPage();y=20}
   const lines=doc.splitTextToSize((item.tipo?item.tipo+" · ":"")+(item.codigo?item.codigo+" · ":"")+(item.nombre||""),107);
   doc.text(lines,17,y);doc.text(String(item.cantidad),139,y,{align:"right"});
   doc.text(money(Number(item.cantidad)*Number(item.precio_unitario)),190,y,{align:"right"});
   y+=Math.max(9,lines.length*5+3);
  }
  if(y>260){doc.addPage();y=20}
  doc.setDrawColor(190,200,210);doc.line(14,y,196,y);y+=10;
  doc.setTextColor(...navy);doc.setFont("helvetica","bold");doc.setFontSize(13);
  doc.text("TOTAL: "+money(q.total),190,y,{align:"right"});y+=10;
  doc.setFont("helvetica","normal");doc.setFontSize(9);
  for(const line of doc.splitTextToSize(q.observaciones||"Cotización informativa sujeta a vigencia.",176)){doc.text(line,16,y);y+=5}
  y+=6;doc.setFontSize(8);doc.setTextColor(...gray);
  doc.text(doc.splitTextToSize("Presupuesto informativo. No constituye venta, reserva de inventario ni comprobante de pago. Las descripciones son indicadas por la óptica y no obligan a registrar una referencia en Inventario.",177),16,y);
  doc.save("TsysOptics-COT-"+formatNum(q.numero)+".pdf");
  set("cot-status","PDF de cotización descargado.");
 }catch(e){set("cot-status","No se pudo generar PDF: "+(e?.message||e))}
 finally{button.disabled=false}
}
function renderQuotes(){
 const root=$("cot-lista");root.replaceChildren();
 const filter=$("cot-filtro").value;
 const shown=quotes.filter(x=>!filter||filter===x.estado||(filter==="pendiente"&&["borrador","enviada"].includes(x.estado)&&x.vigente_hasta>=today())||(filter==="vencida"&&x.estado!=="convertida"&&x.estado!=="rechazada"&&x.vigente_hasta<today()));
 const summary={pendientes:quotes.filter(q=>["borrador","enviada"].includes(q.estado)).length,aprobadas:quotes.filter(q=>q.estado==="aprobada").length,vencidas:quotes.filter(q=>q.vigente_hasta<today()&&!["convertida","rechazada"].includes(q.estado)).length,convertidas:quotes.filter(q=>q.estado==="convertida").length};
 for(const [name,value] of Object.entries(summary))set("cot-ind-"+name,String(value));
 if(!shown.length)root.append(el("p","No hay cotizaciones con este filtro.","muted"));
 for(const q of shown){
  const row=el("div",undefined,"item cot-item"),info=el("div"),actions=el("div",undefined,"cot-actions");
  const expired=q.vigente_hasta<today()&&!["convertida","rechazada"].includes(q.estado);
  info.append(el("strong","COT-"+formatNum(q.numero)+" · "+(q.cliente_nombre||quotePatient(q)?.nombre_completo||"Cliente sin nombre histórico")));
  info.append(el("small",(states[q.estado]||q.estado)+(expired?" · VENCIDA":"")+" · "+q.fecha+" → "+q.vigente_hasta+" · "+money(q.total)));
  info.append(el("small",q.items.map(x=>x.cantidad+"× "+(x.tipo?x.tipo+" · ":"")+x.nombre).join(", ")));
  const pdf=el("button","PDF","btn alt");pdf.type="button";pdf.addEventListener("click",()=>void printQuote(q,pdf));actions.append(pdf);
  const transition=(label,to)=>{
   const b=el("button",label,"btn alt");b.type="button";
   b.addEventListener("click",()=>void changeState(q,to,b));actions.append(b);
  };
  if(q.estado==="borrador"){transition("Marcar enviada","enviada");if(!expired)transition("Aprobar","aprobada");transition("Rechazar","rechazada")}
  if(q.estado==="enviada"){if(!expired)transition("Aprobar","aprobada");transition("Rechazar","rechazada")}
  if(q.estado==="aprobada"){transition("Rechazar","rechazada")}
  if(q.estado==="convertida")info.append(el("small","Registro histórico convertido anteriormente. Las nuevas cotizaciones son independientes de Ventas."));
  row.append(info,actions);root.append(row);
 }
}
async function load(){
 if(!allowed)return;const t=++request;set("cot-status","Cargando cotizaciones…");
 try{
  const [q,c]=await Promise.all([
   db.from("cotizaciones_tsysoptics").select("id,numero,paciente_id,cliente_nombre,cliente_documento,cliente_telefono,fecha,vigente_hasta,estado,items,total,observaciones,venta_id").order("creado_en",{ascending:false}).limit(1000),
   db.from("pacientes_tsysoptics").select("id,nombre_completo,documento").order("nombre_completo").limit(1500)
  ]);
  if(q.error)throw Error(q.error.message);
  if(t!==request||!allowed)return;
  // Los pacientes solo se consultan como respaldo para documentos históricos.
  // Su ausencia o una falla de lectura no debe bloquear cotizaciones independientes.
  patients=c.error?[]:(c.data||[]);quotes=q.data||[];
  renderQuotes();
  window.tsysCotizacionesSetPendientes?.(quotes.filter(x=>["borrador","enviada"].includes(x.estado)&&x.vigente_hasta>=today()).length);
  window.tsysCotizacionesSetVencidas?.(quotes.filter(x=>!["convertida","rechazada"].includes(x.estado)&&x.vigente_hasta<today()).length);
  set("cot-status",quotes.length+" cotizaciones consultadas.");
 }catch(e){set("cot-status","Error al consultar cotizaciones: "+(e?.message||e))}
}
async function save(event){
 event.preventDefault();if(busy||!allowed)return;
 if(!items.length){set("cot-form-status","Agrega al menos una montura o lente.");return}
 if($("cot-vigencia").value<today()){set("cot-form-status","La fecha de validez no puede estar vencida.");return}
 busy=true;$("cot-guardar").disabled=true;
 try{
  if(!(await isAdmin())){reset();return}
  const cliente_nombre=$("cot-cliente-nombre").value.trim();
  const cliente_documento=$("cot-cliente-documento").value.trim()||null;
  const cliente_telefono=$("cot-cliente-telefono").value.trim()||null;
  if(cliente_nombre.length<2||cliente_nombre.length>120)throw Error("Escribe el nombre del cliente (2 a 120 caracteres).");
  if(cliente_documento&&(cliente_documento.length<3||cliente_documento.length>30))throw Error("Revisa el documento del cliente.");
  if(cliente_telefono&&(cliente_telefono.length<7||cliente_telefono.length>30))throw Error("Revisa el teléfono del cliente.");
  const payload={paciente_id:null,cliente_nombre,cliente_documento,cliente_telefono,vigente_hasta:$("cot-vigencia").value,
   items:items.map(x=>({...x})),total:items.reduce((a,x)=>a+x.cantidad*x.precio_unitario,0),
   observaciones:$("cot-observaciones").value.trim()};
  const {error}=await db.from("cotizaciones_tsysoptics").insert(payload);
  if(error)throw Error(error.message);
  items=[];renderItems();$("cot-form").reset();$("cot-vigencia").value=today();
  set("cot-form-status","Cotización guardada a nombre del cliente. No se creó paciente ni venta, ni se modificó inventario o caja.");
  await load();
 }catch(e){set("cot-form-status","No se guardó: "+(e?.message||e))}
 finally{busy=false;$("cot-guardar").disabled=!allowed}
}
async function changeState(q,next,button){
 if(busy||!allowed)return;
 if(!window.confirm("¿Cambiar COT-"+formatNum(q.numero)+" a "+(states[next]||next)+"?"))return;
 busy=true;button.disabled=true;
 try{
  if(!(await isAdmin())){reset();return}
  const {error}=await db.from("cotizaciones_tsysoptics").update({estado:next}).eq("id",q.id).eq("estado",q.estado);
  if(error)throw Error(error.message);
  await load();set("cot-status","Estado actualizado correctamente.");
 }catch(e){set("cot-status","No se actualizó: "+(e?.message||e))}
 finally{busy=false;button.disabled=false}
}
$("cot-agregar-montura").addEventListener("click",()=>addItem("Montura"));
$("cot-agregar-lente").addEventListener("click",()=>addItem("Lente oftálmico"));
$("cot-filtro").addEventListener("change",renderQuotes);
window.addEventListener("tsys:cotizaciones-ver-pendientes",()=>{$("cot-filtro").value="pendiente";renderQuotes()});
window.addEventListener("tsys:cotizaciones-ver-vencidas",()=>{$("cot-filtro").value="vencida";renderQuotes()});
$("cot-refrescar").addEventListener("click",()=>void load());
$("cot-form").addEventListener("submit",e=>void save(e));
window.addEventListener("tsys:cotizaciones-refrescar",()=>void load());
window.addEventListener("tsys:locked",reset);
window.addEventListener("tsys:role",async e=>{const ok=e.detail?.role==="administrador"&&await isAdmin();allowed=ok;$("cot-guardar").disabled=!ok;$("cot-refrescar").disabled=!ok;if(ok)void load();else reset()});
$("cot-vigencia").value=today();
for(const id of ["cot-montura-descripcion","cot-montura-cantidad","cot-montura-precio","cot-lente-descripcion","cot-lente-cantidad","cot-lente-precio"]){$(id).value=""}
renderItems();reset();
if($("tsys-app")?.dataset.role==="administrador")void isAdmin().then(ok=>{allowed=ok;$("cot-guardar").disabled=!ok;$("cot-refrescar").disabled=!ok;if(ok)void load()});
