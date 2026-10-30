import {createClient} from "https://esm.sh/@supabase/supabase-js@2";
import {SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY} from "./supabase-config.js";
const db=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{flowType:"pkce",persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const $=id=>document.getElementById(id);
const money=x=>new Intl.NumberFormat("es-CO",{style:"currency",currency:"COP",maximumFractionDigits:0}).format(Number(x)||0);
const today=()=>new Intl.DateTimeFormat("sv-SE",{timeZone:"America/Bogota",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=String(text??"");if(cls)e.className=cls;return e};
const set=(id,text)=>{$(id).textContent=text};
const formatNum=v=>String(v).padStart(6,"0");
let allowed=false,busy=false,request=0,products=[],patients=[],quotes=[],items=[];
const states={borrador:"Borrador",enviada:"Enviada",aprobada:"Aprobada",rechazada:"Rechazada",convertida:"Convertida"};
const num=(raw)=>{const v=window.tsysParseCOP?.(String(raw??"").trim());return Number.isFinite(v)?v:NaN};
async function isAdmin(){
 const {data,error}=await db.auth.getUser();if(error||!data?.user)return false;
 const {data:p,error:e}=await db.from("usuarios_tsysoptics").select("activo,rol").eq("id",data.user.id).maybeSingle();
 return !e&&p?.activo&&p.rol==="administrador";
}
function reset(){
 allowed=false;request++;items=[];products=[];patients=[];quotes=[];
 for(const id of ["cot-items","cot-lista","cot-paciente","cot-producto"])$(id).replaceChildren();
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
  info.append(el("strong",x.nombre+" · "+x.codigo));
  info.append(el("small",x.cantidad+" x "+money(x.precio_unitario)+" = "+money(x.cantidad*x.precio_unitario)));
  const del=el("button","Quitar","btn alt");del.type="button";
  del.addEventListener("click",()=>{items.splice(index,1);renderItems()});
  row.append(info,del);box.append(row);
 }
 if(!items.length)box.append(el("p","Sin productos cotizados. Añade monturas o lentes del catálogo.","muted"));
 set("cot-total",money(items.reduce((sum,x)=>sum+x.cantidad*x.precio_unitario,0)));
}
function addItem(){
 const p=products.find(p=>p.id===$("cot-producto").value);
 const quantity=Number($("cot-cantidad").value);
 const price=num($("cot-precio").value);
 if(!p||!Number.isSafeInteger(quantity)||quantity<1||quantity>100||!Number.isFinite(price)||price<0||price>999999999){
  set("cot-form-status","Selecciona un producto, cantidad entre 1 y 100 y precio válido.");return;
 }
 if(items.some(x=>x.producto_id===p.id)){set("cot-form-status","Esa referencia ya está incluida. Quita la anterior para cambiar su cantidad.");return}
 if(items.length>=20){set("cot-form-status","Límite de 20 referencias por cotización.");return}
 items.push({producto_id:p.id,codigo:p.codigo,nombre:p.nombre,cantidad:quantity,precio_unitario:price});
 $("cot-cantidad").value="1";$("cot-producto").value="";$("cot-precio").value="";
 renderItems();set("cot-form-status","Referencia agregada. Aún no modifica Inventario.");
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
    "Cliente: "+(patient?.nombre_completo||"Consumidor final"),
    "Documento: "+(patient?.documento||"No registrado"),
    "NIT: "+(business?.nit_optica||"No registrado"),
    "Dirección: "+(business?.direccion_optica||"") + "  Teléfono: "+(business?.telefono_optica||"")
  ]){doc.text(doc.splitTextToSize(line,178),16,y);y+=8;}
  y+=4;doc.setFillColor(239,243,248);doc.rect(14,y-6,182,9,"F");
  doc.setFont("helvetica","bold");doc.text("PRODUCTO",17,y);doc.text("CANT.",135,y);doc.text("TOTAL",188,y,{align:"right"});y+=9;
  doc.setFont("helvetica","normal");doc.setTextColor(...gray);
  for(const item of q.items){
   if(y>265){doc.addPage();y=20}
   const lines=doc.splitTextToSize((item.codigo||"")+" · "+(item.nombre||""),107);
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
  doc.text(doc.splitTextToSize("Esta cotización no representa una venta, no garantiza inventario y no acredita ningún pago. Los precios y las existencias se verifican nuevamente al registrar la venta.",177),16,y);
  doc.save("TsysOptics-COT-"+formatNum(q.numero)+".pdf");
  set("cot-status","PDF de cotización descargado.");
 }catch(e){set("cot-status","No se pudo generar PDF: "+(e?.message||e))}
 finally{button.disabled=false}
}
function renderQuotes(){
 const root=$("cot-lista");root.replaceChildren();
 const filter=$("cot-filtro").value;
 const shown=quotes.filter(x=>!filter||filter===x.estado||filter==="vencida"&&x.estado!=="convertida"&&x.estado!=="rechazada"&&x.vigente_hasta<today());
 const summary={pendientes:quotes.filter(q=>["borrador","enviada"].includes(q.estado)).length,aprobadas:quotes.filter(q=>q.estado==="aprobada").length,vencidas:quotes.filter(q=>q.vigente_hasta<today()&&!["convertida","rechazada"].includes(q.estado)).length,convertidas:quotes.filter(q=>q.estado==="convertida").length};
 for(const [name,value] of Object.entries(summary))set("cot-ind-"+name,String(value));
 if(!shown.length)root.append(el("p","No hay cotizaciones con este filtro.","muted"));
 for(const q of shown){
  const row=el("div",undefined,"item cot-item"),info=el("div"),actions=el("div",undefined,"cot-actions");
  const expired=q.vigente_hasta<today()&&!["convertida","rechazada"].includes(q.estado);
  info.append(el("strong","COT-"+formatNum(q.numero)+" · "+(quotePatient(q)?.nombre_completo||"Consumidor final")));
  info.append(el("small",(states[q.estado]||q.estado)+(expired?" · VENCIDA":"")+" · "+q.fecha+" → "+q.vigente_hasta+" · "+money(q.total)));
  info.append(el("small",q.items.map(x=>x.cantidad+"× "+x.nombre).join(", ")));
  const pdf=el("button","PDF","btn alt");pdf.type="button";pdf.addEventListener("click",()=>void printQuote(q,pdf));actions.append(pdf);
  const transition=(label,to)=>{
   const b=el("button",label,"btn alt");b.type="button";
   b.addEventListener("click",()=>void changeState(q,to,b));actions.append(b);
  };
  if(q.estado==="borrador"){transition("Marcar enviada","enviada");if(!expired)transition("Aprobar","aprobada");transition("Rechazar","rechazada")}
  if(q.estado==="enviada"){if(!expired)transition("Aprobar","aprobada");transition("Rechazar","rechazada")}
  if(q.estado==="aprobada"){if(!expired){const convert=el("button","Preparar venta","btn");convert.type="button";convert.addEventListener("click",()=>prepare(q));actions.append(convert)}transition("Rechazar","rechazada")}
  if(q.estado==="convertida"&&q.venta_id)info.append(el("small","Venta vinculada: "+q.venta_id));
  row.append(info,actions);root.append(row);
 }
}
async function load(){
 if(!allowed)return;const t=++request;set("cot-status","Cargando catálogo, pacientes y cotizaciones…");
 try{
  const [p,c,q]=await Promise.all([
   db.from("productos_tsysoptics").select("id,codigo,nombre,tipo,precio_venta,activo,cantidad").eq("activo",true).order("nombre").limit(1000),
   db.from("pacientes_tsysoptics").select("id,nombre_completo,documento").order("nombre_completo").limit(1500),
   db.from("cotizaciones_tsysoptics").select("id,numero,paciente_id,fecha,vigente_hasta,estado,items,total,observaciones,venta_id").order("creado_en",{ascending:false}).limit(1000)
  ]);
  if(p.error||c.error||q.error)throw Error([p.error,c.error,q.error].filter(Boolean).map(x=>x.message).join("; "));
  if(t!==request||!allowed)return;
  products=p.data||[];patients=c.data||[];quotes=q.data||[];
  options("cot-producto",products.map(x=>[x.id,x.codigo+" · "+x.nombre+" · "+money(x.precio_venta)]),"Seleccionar montura, lente o accesorio");
  options("cot-paciente",patients.map(x=>[x.id,x.nombre_completo+" · "+x.documento]),"Consumidor final");
  renderQuotes();set("cot-status",quotes.length+" cotizaciones consultadas.");
 }catch(e){set("cot-status","Error al consultar cotizaciones: "+(e?.message||e))}
}
async function save(event){
 event.preventDefault();if(busy||!allowed)return;
 if(!items.length){set("cot-form-status","Agrega al menos una referencia.");return}
 if($("cot-vigencia").value<today()){set("cot-form-status","La fecha de validez no puede estar vencida.");return}
 busy=true;$("cot-guardar").disabled=true;
 try{
  if(!(await isAdmin())){reset();return}
  const payload={paciente_id:$("cot-paciente").value||null,vigente_hasta:$("cot-vigencia").value,
   items:items.map(x=>({...x})),total:items.reduce((a,x)=>a+x.cantidad*x.precio_unitario,0),
   observaciones:$("cot-observaciones").value.trim()};
  const {error}=await db.from("cotizaciones_tsysoptics").insert(payload);
  if(error)throw Error(error.message);
  items=[];renderItems();$("cot-form").reset();$("cot-vigencia").value=today();
  set("cot-form-status","Cotización guardada sin mover inventario ni caja.");
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
function prepare(q){
 if(!allowed)return;
 if(q.estado!=="aprobada"||q.vigente_hasta<today()){set("cot-status","Solo las cotizaciones aprobadas y vigentes pueden convertirse.");return}
 const invalid=q.items.find(x=>{const p=products.find(p=>p.id===x.producto_id);return !p||p.cantidad<x.cantidad});
 if(invalid){set("cot-status","No hay existencias suficientes de "+invalid.nombre+". Debes revisar Inventario antes de vender.");return}
 if(!window.confirm("Se preparará una venta con las referencias cotizadas. El importe final se calculará con precios ACTUALES de Inventario y el stock se descontará solo al confirmar la venta. ¿Continuar?"))return;
 window.dispatchEvent(new CustomEvent("tsys:cotizacion-preparar-venta",{detail:{id:q.id,paciente_id:q.paciente_id,items:q.items.map(x=>({producto_id:x.producto_id,cantidad:x.cantidad}))}}));
 document.querySelector('.sidebar button[data-page="ventas"]')?.click();
 set("cot-status","Ve a Ventas para revisar el carrito y confirmar la venta.");
}
$("cot-producto").addEventListener("change",()=>{
 const p=products.find(x=>x.id===$("cot-producto").value);
 $("cot-precio").value=p?String(p.precio_venta):"";
 window.tsysFormatCOPInput?.($("cot-precio"));
});
$("cot-agregar").addEventListener("click",addItem);
$("cot-filtro").addEventListener("change",renderQuotes);
$("cot-refrescar").addEventListener("click",()=>void load());
$("cot-form").addEventListener("submit",e=>void save(e));
window.addEventListener("tsys:cotizaciones-refrescar",()=>void load());
window.addEventListener("tsys:locked",reset);
window.addEventListener("tsys:role",async e=>{const ok=e.detail?.role==="administrador"&&await isAdmin();allowed=ok;$("cot-guardar").disabled=!ok;$("cot-refrescar").disabled=!ok;if(ok)void load();else reset()});
$("cot-vigencia").value=today();renderItems();reset();
if($("tsys-app")?.dataset.role==="administrador")void isAdmin().then(ok=>{allowed=ok;$("cot-guardar").disabled=!ok;$("cot-refrescar").disabled=!ok;if(ok)void load()});
