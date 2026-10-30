import {createClient} from "https://esm.sh/@supabase/supabase-js@2";
import {SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY} from "./supabase-config.js";
import "./ventas-movil.js?v=20261029a";
import {loadDocumentContext,previewDocument,createSalePdf,savePdf,shareSalePdf} from "./documento-venta.js?v=20261030";

const sb=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{
 auth:{flowType:"pkce",persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
});
const $=id=>document.getElementById(id);
const form=$("form-venta");
const paymentsForm=$("ventas-form-abono");
const receipt=$("venta-comprobante");
const cartRoot=$("venta-carrito");
const saleList=$("lista-ventas");
const productSelect=$("venta-producto");
const lensCatalog=$("venta-lente-catalogo");
const lensName=$("venta-lente-descripcion");
const lensPrice=$("venta-lente-precio-manual");
const lensQuantity=$("venta-lente-cantidad");
let creatingLens=false;
let receiptContext=null,receiptRequest=0;
const LENS_CATALOG=[
 ["CR BLUE",100000],["CR FOTO BLUE",220000],["POLY BLUE",180000],
 ["POLY FOTO BLUE",250000],["CR TRANSITIONS + AR",460000],
 ["POLY TRANSITIONS + AR",520000],["PROGRESIVO GAMA MEDIA BLUE",480000],
 ["PROGRESIVO GAMA ALTA BLUE",580000],["PROGRESIVO GAMA MEDIA BLUE + FOTO",570000],
 ["PROGRESIVO GAMA ALTA BLUE + FOTO",710000],["PROGRESIVO GAMA TRANSITION",870000],
 ["PROGRESIVO GAMA ALTA BLUE + TRANS",1070000]
];
const patientSelect=$("venta-paciente");
const paymentSaleSelect=$("ventas-abono-venta");
const money=n=>new Intl.NumberFormat("es-CO",{style:"currency",currency:"COP",maximumFractionDigits:2}).format(Number(n)||0);
const paymentLabel={efectivo:"Efectivo",transferencia:"Transferencia",nequi:"Nequi",daviplata:"Daviplata",tarjeta:"Tarjeta",otro:"Otro"};
let isActive=false,isStarting=false,registering=false,collecting=false,voiding=false;
let cajaAbierta=false;
let generation=0;
let products=[],patients=[],sales=[],cart=[];
let mobileProductFilter="";
let saleToken=crypto.randomUUID();
let paymentToken=crypto.randomUUID();
let voidToken=crypto.randomUUID();
let saleToVoid=null;
let receiptSaleCurrent=null;
const voidModal=$("venta-anular-modal");
const voidForm=$("venta-anular-form");
const voidMessage=$("venta-anular-status");
function canVoid(sale){
 return sale.estado==="emitida"&&Number(sale.abonado)===0&&!(sale.pagos||[]).length;
}
function closeVoid(){
 if(voiding)return;
 voidModal.hidden=true;saleToVoid=null;voidForm.reset();voidMessage.textContent="";
}
function openVoid(sale){
 if(!isActive||!canVoid(sale))return;
 saleToVoid=sale;voidToken=crypto.randomUUID();
 $("venta-anular-info").textContent="Venta "+salesNumber(sale.numero)+
  " por "+money(sale.total)+". Sin pagos. Al confirmar se reintegran "+
  (sale.lineas||[]).map(x=>x.codigo_snapshot+" × "+x.cantidad).join(", ")+
  " al inventario y queda un registro de auditoría.";
 voidModal.hidden=false;voidMessage.textContent="";
 $("venta-anular-motivo").focus();
}
$("venta-anular-cancelar").addEventListener("click",closeVoid);
voidModal.addEventListener("click",e=>{if(e.target===voidModal)closeVoid()});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!voidModal.hidden)closeVoid()});
voidForm.addEventListener("submit",async e=>{
 e.preventDefault();
 if(!isActive||voiding||!saleToVoid)return;
 const motivo=String($("venta-anular-motivo").value||"").trim();
 if(motivo.length<10||motivo.length>300){
  voidMessage.textContent="Escribe una justificación de 10 a 300 caracteres.";return;
 }
 const id=saleToVoid.id;
 if(!window.confirm("¿Anular "+salesNumber(saleToVoid.numero)+
  " y reintegrar el inventario? Esta acción no se puede deshacer."))return;
 voiding=true;$("venta-anular-confirmar").disabled=true;$("venta-anular-cancelar").disabled=true;
 voidMessage.textContent="Anulando venta y reintegrando existencias…";
 try{
  const {data,error}=await sb.rpc("anular_venta_sin_pago_tsysoptics",{
   p_venta_id:id,p_motivo:motivo,p_operacion_id:voidToken
  });
  if(error||!data){
   const message=String(error?.message||"");
   voidMessage.textContent=message.includes("requiere devolución financiera")
    ?"Esta venta tiene cobros y requiere una devolución financiera."
    :message.includes("ya fue anulada")?"Esta venta ya fue anulada. Actualiza el historial."
    :"No se pudo confirmar la anulación. Revisa el historial antes de reintentar.";
   return;
  }
  voidToken=crypto.randomUUID();voidModal.hidden=true;voidForm.reset();saleToVoid=null;
  await refresh();
  displayStatus("ventas-list-status","Anulación confirmada en Supabase: existencias reintegradas con auditoría.");
 }catch{
  voidMessage.textContent="No se confirmó la operación. Actualiza el historial antes de repetirla.";
 }finally{
  voiding=false;$("venta-anular-confirmar").disabled=false;$("venta-anular-cancelar").disabled=false;
 }
});
function displayStatus(id,text){$(id).textContent=text}
function element(tag,text,cls){
 const n=document.createElement(tag);
 if(text!==undefined&&text!==null)n.textContent=String(text);
 if(cls)n.className=cls;
 return n;
}
function salesNumber(num){return "V-"+String(num).padStart(6,"0")}
function setCajaEstado(abierta) {
 cajaAbierta=Boolean(abierta);
 const msg=cajaAbierta?"Caja abierta: puedes registrar ventas y abonos.":"Caja cerrada: abre turno en Caja para registrar nuevas ventas o cobros.";
 $("venta-turno-estado").textContent=msg;
 $("ventas-abono-turno").textContent=msg;
 $("venta-guardar").disabled=!cajaAbierta||registering;
 $("ventas-registrar-abono").disabled=!cajaAbierta||collecting;
}
async function refreshCaja(){
 if(!isActive)return false;
 const {data,error}=await sb.rpc("resumen_turno_caja_tsysoptics");
 if(error){setCajaEstado(false);return false}
 const abierta=Array.isArray(data)&&data[0]?.estado==="abierta";
 setCajaEstado(abierta);
 return abierta;
}
window.addEventListener("tsys:caja",event=>{if(isActive)setCajaEstado(event.detail?.abierta===true)});
function saleError(err){
 const message=String(err?.message||"");
 if(err?.code==="22023" && message.includes("Existencias insuficientes"))return "Existencias insuficientes. Actualiza el inventario y revisa el carrito.";
 if(err?.code==="22023" && message.includes("abono"))return "El pago inicial supera el valor real de la venta.";
 if(err?.code==="22023" && message.includes("repet"))return "La referencia está repetida en el carrito.";
 if(err?.code==="23505")return "La operación podría haberse registrado. Actualiza el historial antes de repetirla.";
 if(err?.code==="42501")return "No tienes permiso para realizar esta operación.";
 return "No se pudo registrar. Comprueba los datos, el stock y la conexión.";
}
async function authorized(){
 const {data,error}=await sb.auth.getUser();
 if(error||!data?.user)return false;
 const {data:profile,error:pe}=await sb.from("usuarios_tsysoptics").select("rol,activo").eq("id",data.user.id).maybeSingle();
 return !pe && profile?.activo===true && profile?.rol==="administrador";
}
function cartTotal(){
 return cart.reduce((sum,item)=>{
  const p=products.find(x=>x.id===item.producto_id);
  return sum+(Number(p?.precio_venta)||0)*item.cantidad;
 },0);
}
function renderCart(){
 cartRoot.replaceChildren();
 for(const item of cart){
  const p=products.find(x=>x.id===item.producto_id);
  const row=element("div",undefined,"item");
  const info=element("div");
  info.append(element("strong",(p?.codigo||"Referencia")+" × "+item.cantidad),
   element("small",(p?.nombre||"Referencia")+" · "+money((p?.precio_venta||0)*item.cantidad)));
  const rm=element("button","Quitar","btn alt");
  rm.type="button";
  rm.addEventListener("click",()=>{cart=cart.filter(x=>x.producto_id!==item.producto_id);renderCart()});
  row.append(info,rm);cartRoot.append(row);
 }
 if(!cart.length)cartRoot.append(element("p","Carrito vacío. Selecciona una referencia y agrégala.","muted"));
 const total=cartTotal();
 const paid=window.tsysParseCOP(form.elements.abono.value||"0");
 $("total-preview").textContent=money(total);
 $("saldo-preview").textContent=money(Math.max(0,total-(Number.isFinite(paid)?paid:0)));
 window.dispatchEvent(new CustomEvent("tsys:ventas-carrito",{
  detail:{unidades:cart.reduce((sum,item)=>sum+item.cantidad,0),total}
 }));
}
function normalizeProductSearch(text){
 return String(text||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("es-CO");
}
function updateProductButton(){
 const product=products.find(p=>p.id===productSelect.value);
 const kind=product?.tipo==="Lente oftálmico"?"lente":
   product?.tipo==="Accesorio"?"accesorio":"montura";
 $("venta-agregar-producto").textContent="Agregar "+kind+" al carrito";
}
productSelect.addEventListener("change",updateProductButton);
function fillOptions(){
 const previously=productSelect.value;
 const query=window.matchMedia("(max-width: 850px)").matches
  ?normalizeProductSearch(mobileProductFilter.trim()):"";
 const available=products.filter(p=>p.activo&&p.cantidad>0&&
  (!query||normalizeProductSearch(p.codigo+" "+p.nombre).includes(query)));
 productSelect.replaceChildren(new Option("Seleccionar referencia",""));
 for(const p of available){
  const opt=new Option(p.codigo+" · "+p.nombre+" · "+money(p.precio_venta)+" ("+p.cantidad+" uds)",p.id);
  productSelect.append(opt);
 }
 if(Array.from(productSelect.options).some(o=>o.value===previously))productSelect.value=previously;
 updateProductButton();
 window.dispatchEvent(new CustomEvent("tsys:ventas-busqueda",{detail:{cantidad:available.length}}));
 const current=patientSelect.value;
 patientSelect.replaceChildren(new Option("Consumidor final",""));
 for(const p of patients)patientSelect.append(new Option(p.nombre_completo+" · "+p.tipo_documento+" "+p.documento,p.id));
 if(Array.from(patientSelect.options).some(o=>o.value===current))patientSelect.value=current;
}
for(const [label,price] of LENS_CATALOG){
 const option=new Option(label+" · "+money(price),label);
 option.dataset.price=String(price);lensCatalog.append(option);
}
lensCatalog.addEventListener("change",()=>{
 const choice=lensCatalog.selectedOptions[0];
 if(!choice?.value)return;
 lensName.value=choice.value;
 lensPrice.value=choice.dataset.price||"";
 window.tsysFormatCOPInput?.(lensPrice);
 displayStatus("venta-lente-status","Precio cargado del catálogo. Puedes editar tanto la descripción como el precio antes de agregar.");
});
// El lente personalizado se registra como referencia de Inventario antes de venderlo.
// No se inventan líneas de venta sin existencias ni se cambian precios sólo en el navegador.
$("venta-agregar-lente").addEventListener("click",async()=>{
 if(creatingLens)return;
 if(!isActive||!cajaAbierta){
  displayStatus("venta-lente-status","Abre o verifica Caja antes de preparar la venta.");return;
 }
 const nombre=lensName.value.trim().toLocaleUpperCase("es-CO");
 const precio=window.tsysParseCOP(lensPrice.value);
 const cantidad=Number(lensQuantity.value);
 if(nombre.length<3||nombre.length>120||!Number.isFinite(precio)||precio<=0||
    precio>999999999999||!Number.isSafeInteger(cantidad)||cantidad<1||cantidad>20){
  displayStatus("venta-lente-status","Escribe un lente de 3 a 120 caracteres, precio positivo y cantidad entre 1 y 20.");
  return;
 }
 if(cart.length>=20){
  displayStatus("venta-lente-status","El carrito admite como máximo 20 referencias.");return;
 }
 if(!window.confirm("¿Registrar una nueva referencia de lente en Inventario por "+money(precio)+
    " y agregar "+cantidad+" unidad(es) a esta venta? La referencia permanecerá en Inventario aunque canceles el carrito."))return;
 creatingLens=true;
 const button=$("venta-agregar-lente");button.disabled=true;
 displayStatus("venta-lente-status","Registrando lente en Supabase…");
 try{
  if(!(await authorized())){displayStatus("venta-lente-status","La sesión ya no autoriza registrar referencias.");return;}
  const codigo="LEN-"+crypto.randomUUID().slice(0,12).toUpperCase();
  const {data,error}=await sb.from("productos_tsysoptics").insert({
   codigo,nombre,tipo:"Lente oftálmico",precio_venta:precio,costo_compra:null,
   cantidad,stock_minimo:0,activo:true
  }).select("id,codigo,nombre,tipo,precio_venta,cantidad,activo").single();
  if(error||!data){
   displayStatus("venta-lente-status","No se pudo registrar el lente. Verifica permisos, precio y conexión.");
   return;
  }
  products.push(data);
  cart.push({producto_id:data.id,cantidad});
  fillOptions();renderCart();
  lensCatalog.value="";lensName.value="";lensPrice.value="";lensQuantity.value="1";
  window.dispatchEvent(new Event("tsys:inventario-refrescar"));
  displayStatus("venta-lente-status","Lente registrado con código "+codigo+
   " y agregado al carrito. Al confirmar la venta se descontarán sus existencias.");
 }catch{
  displayStatus("venta-lente-status","No se pudo confirmar el registro. Consulta Inventario antes de volver a intentar.");
 }finally{creatingLens=false;button.disabled=false}
});
window.tsysVentasMobileFiltrar=value=>{
 mobileProductFilter=String(value||"").slice(0,100);
 fillOptions();
};
async function refreshCatalog(){
 if(!isActive)return;
 const [r,p]=await Promise.all([
  sb.from("productos_tsysoptics").select("id,codigo,nombre,tipo,precio_venta,cantidad,activo")
   .eq("activo",true).order("nombre",{ascending:true}).limit(300),
  sb.from("pacientes_tsysoptics").select("id,nombre_completo,tipo_documento,documento")
   .order("nombre_completo",{ascending:true}).limit(300)
 ]);
 if(!isActive)return;
 if(r.error||p.error){
  displayStatus("venta-form-status","No se pudieron consultar productos o pacientes de Supabase.");
  return;
 }
 products=r.data||[]; patients=p.data||[];
 // El servidor valida otra vez el stock y el precio en el momento del cobro.
 cart=cart.filter(x=>products.some(p=>p.id===x.producto_id&&p.activo));
 fillOptions(); renderCart();
}
function appendCell(row,value){
 const td=element("td",value);
 row.append(td);
 return td;
}
function receiptOpen(sale){
 if(!sale)return;
 receiptSaleCurrent=sale;
 receiptContext=null;
 const mine=++receiptRequest;
 $("venta-recibo-clinico-aviso").textContent="Consultando última historia clínica finalizada…";
 $("venta-recibo-historia").replaceChildren();
 $("venta-recibo-titulo").textContent="Comprobante interno";
 $("venta-recibo-garantia").textContent="";
 $("venta-recibo-pie").textContent="";
 void loadDocumentContext(sb,sale).then(ctx=>{
  if(mine!==receiptRequest||receiptSaleCurrent?.id!==sale.id)return;
  receiptContext=ctx;
  $("venta-recibo-titulo").textContent=ctx.config.nombre_optica+" · "+ctx.config.titulo_documento;
  $("venta-recibo-garantia").textContent=ctx.config.nota_garantia;
  $("venta-recibo-pie").textContent=ctx.config.pie_documento;
  previewDocument(ctx,$("venta-recibo-historia"),$("venta-recibo-clinico-aviso"));
 }).catch(error=>{
  if(mine!==receiptRequest)return;
  $("venta-recibo-clinico-aviso").textContent=error.message+" Intenta abrir de nuevo el comprobante.";
 });
 const devuelta=sale.estado==="devuelta";
 $("venta-recibo-meta").textContent=(sale.estado==="anulada"?"ANULADA · Documento histórico · ":devuelta?"DEVUELTA · Comprobante original · ":"Comprobante ")+salesNumber(sale.numero)+" · "+new Date(sale.fecha).toLocaleString("es-CO",{timeZone:"America/Bogota"});
 $("venta-recibo-paciente").textContent="Paciente/cliente: "+(sale.paciente?.nombre_completo||"Consumidor final");
 const tbody=$("venta-recibo-lineas");tbody.replaceChildren();
 for(const line of sale.lineas||[]){
  const tr=document.createElement("tr");
  appendCell(tr,line.codigo_snapshot+" · "+line.nombre_snapshot);
  appendCell(tr,line.cantidad);
  appendCell(tr,money(line.precio_unitario));
  appendCell(tr,money(line.total_linea));
  tbody.append(tr);
 }
 $("venta-recibo-totales").textContent=(sale.estado==="anulada"?"VENTA ANULADA · Sin saldo exigible · Total histórico: ":"Total: ")+money(sale.total)+" · Abonado: "+money(sale.abonado)+" · Saldo: "+money(sale.saldo);
 const paymentText=(sale.pagos||[]).map(p=>
  new Date(p.registrado_en).toLocaleString("es-CO",{timeZone:"America/Bogota"})+" · "+money(p.monto)+" · "+(paymentLabel[p.medio]||p.medio)
 );
 $("venta-recibo-pagos").textContent=paymentText.length?"Pagos: "+paymentText.join(" | "):"Sin pagos registrados";
 const canceledInfo=$("venta-recibo-anulacion");
 canceledInfo.hidden=sale.estado!=="anulada";
 canceledInfo.textContent=sale.estado==="anulada"?
  "ANULACIÓN REGISTRADA · "+new Date(sale.anulada_en).toLocaleString("es-CO",{timeZone:"America/Bogota"})+
  " · Motivo: "+(sale.motivo_anulacion||"No disponible"):"";
 if(devuelta){
  canceledInfo.hidden=false;
  canceledInfo.textContent="DEVOLUCIÓN COMPLETA REGISTRADA · "+new Date(sale.devuelta_en).toLocaleString("es-CO",{timeZone:"America/Bogota"})+
   " · Monto devuelto: "+money(sale.abonado)+" · Motivo: "+(sale.motivo_devolucion||"No disponible")+
   ". Nota crédito interna disponible en Devoluciones. No equivale a nota crédito DIAN.";
 }
 receipt.hidden=false;
}
function receiptClose(){
 receiptRequest++;
 receiptContext=null;
 receipt.hidden=true;
 receiptSaleCurrent=null;
 document.body.classList.remove("venta-imprimiendo");
}
$("venta-cerrar-comprobante").addEventListener("click",receiptClose);
async function salePdfAction(share=false){
 const ctx=receiptContext;
 const statusEl=$("venta-recibo-clinico-aviso");
 if(!ctx){statusEl.textContent="El documento todavía no está listo o no se pudo consultar la historia. No se compartirá un documento incompleto.";return;}
 const button=$(share?"venta-whatsapp-comprobante":"venta-imprimir-comprobante");
 button.disabled=true;statusEl.textContent="Generando documento PDF…";
 try{
  const file=await createSalePdf(ctx);
  if(share){
   if(!window.confirm("¿Compartir el PDF con datos del paciente e historia clínica? Confirma que el destinatario tiene autorización para recibir información de salud."))return;
   statusEl.textContent=await shareSalePdf(ctx,file);
  }else{
   savePdf(file.blob,file.filename);
   const url=URL.createObjectURL(file.blob);
   window.open(url,"_blank","noopener,noreferrer");
   setTimeout(()=>URL.revokeObjectURL(url),60000);
   statusEl.textContent="PDF descargado y abierto para imprimir. Es el mismo archivo usado al compartir.";
  }
 }catch(error){
  if(error?.name==="AbortError")statusEl.textContent="Compartir cancelado.";
  else statusEl.textContent="No se pudo preparar el PDF. Comprueba la conexión y vuelve a intentarlo.";
 }finally{button.disabled=false}
}
$("venta-imprimir-comprobante").addEventListener("click",()=>{void salePdfAction(false)});
$("venta-whatsapp-comprobante").addEventListener("click",()=>{void salePdfAction(true)});
receipt.addEventListener("click",e=>{if(e.target===receipt)receiptClose()});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!receipt.hidden)receiptClose()});

function renderSales(){
 if(!isActive)return;
 saleList.replaceChildren();
 paymentSaleSelect.replaceChildren(new Option("Seleccionar venta con saldo",""));
 if(!sales.length){
  saleList.append(element("p","Todavía no hay ventas en Supabase.","muted"));
  return;
 }
 for(const sale of sales){
  if(sale.estado==="emitida"&&Number(sale.saldo)>0) paymentSaleSelect.append(
    new Option(salesNumber(sale.numero)+" · Saldo "+money(sale.saldo),sale.id)
  );
  const row=element("div",undefined,sale.estado==="anulada"?"item venta-anulada":sale.estado==="devuelta"?"item venta-devuelta":"item");
  const info=element("div");
  const labels=(sale.lineas||[]).map(x=>x.codigo_snapshot+" × "+x.cantidad).join(", ");
  info.append(element("strong",salesNumber(sale.numero)+" · "+money(sale.total)+(sale.estado==="anulada"?" · ANULADA":sale.estado==="devuelta"?" · DEVUELTA":"")),
   element("small",new Date(sale.fecha).toLocaleString("es-CO",{timeZone:"America/Bogota"})+" · "+(sale.paciente?.nombre_completo||"Consumidor final")),
   element("small",labels),
   element("small","Pagos registrados: "+(sale.pagos||[]).length+" · Total cobrado: "+money((sale.pagos||[]).reduce((n,p)=>n+Number(p.monto||0),0))),
   element("small",sale.estado==="anulada"
    ?"Sin saldo exigible · Motivo: "+(sale.motivo_anulacion||"Auditoría registrada")
    :sale.estado==="devuelta"
    ?"Reembolsado "+money(sale.abonado)+" · Saldo cancelado · "+(sale.motivo_devolucion||"Devolución registrada")
    :"Abonado "+money(sale.abonado)+" · Saldo "+money(sale.saldo)));
  const actions=element("div",undefined,"venta-fila-controles");
  const receiptBtn=element("button","Comprobante");
  receiptBtn.type="button";
  receiptBtn.addEventListener("click",()=>receiptOpen(sale));
  actions.append(receiptBtn);
  if(sale.estado==="emitida"&&Number(sale.saldo)>0){
   const payBtn=element("button","Abonar");
   payBtn.type="button";
   payBtn.addEventListener("click",()=>{
    paymentSaleSelect.value=sale.id;
    $("ventas-abono-monto").value=String(sale.saldo);
    window.tsysFormatCOPInput($("ventas-abono-monto"));
    window.tsysVentasMobileTab?.("abonos");
    paymentsForm.scrollIntoView({behavior:"smooth",block:"start"});
   });
   actions.append(payBtn);
  }
  if(canVoid(sale)){
   const voidBtn=element("button","Anular venta");voidBtn.type="button";
   voidBtn.className="anular-venta-btn";voidBtn.addEventListener("click",()=>openVoid(sale));
   actions.append(voidBtn);
  }else if(sale.estado==="emitida"&&Number(sale.abonado)>0){
   actions.append(element("span","Requiere devolución financiera","venta-fila-info"));
  }
  if(sale.estado==="devuelta"){
   const note=element("a","Nota interna");note.href="./devoluciones.html";
   note.className="btn alt";actions.append(note);
  }
  row.append(info,actions);saleList.append(row);
 }
}
async function refreshSummary(){
 if(!isActive)return;
 const {data,error}=await sb.rpc("resumen_ventas_tsysoptics");
 if(!isActive)return;
 if(error||!Array.isArray(data)||!data[0]){
  displayStatus("ventas-list-status","No se pudo consultar el resumen de ventas.");
  return;
 }
 const r=data[0];
 $("ventas-cantidad").textContent=String(r.cantidad);
 $("ventas-total").textContent=money(r.total);
 $("ventas-abonado").textContent=money(r.recibido);
 $("ventas-pendiente").textContent=money(r.pendiente);
 if(typeof window.tsysVentasSetTotal==="function")window.tsysVentasSetTotal(Number(r.total)||0);
}
async function refreshSales(){
 if(!isActive)return;
 const mine=++generation;
 displayStatus("ventas-list-status","Consultando ventas…");
 const {data,error,count}=await sb.from("ventas_tsysoptics")
  .select("id,numero,solicitud_id,fecha,paciente_id,total,abonado,saldo,estado,motivo_anulacion,anulada_en,devuelta_en,motivo_devolucion,paciente:pacientes_tsysoptics(nombre_completo),lineas:detalle_ventas_tsysoptics(codigo_snapshot,nombre_snapshot,cantidad,precio_unitario,total_linea),pagos:pagos_ventas_tsysoptics(monto,medio,registrado_en)",{count:"exact"})
  .order("fecha",{ascending:false}).limit(100);
 if(!isActive||mine!==generation)return;
 if(error){displayStatus("ventas-list-status","No se pudieron cargar las ventas. Verifica la conexión y los permisos.");return}
 sales=data||[];
 const pagos=sales.reduce((n,v)=>n+(v.pagos||[]).length,0);
 const saldoPendiente=sales.filter(v=>v.estado==="emitida"&&Number(v.saldo)>0).length;
 displayStatus("ventas-conciliacion","En las ventas cargadas hay "+pagos+
   " pago(s) registrado(s). "+(saldoPendiente
   ?saldoPendiente+" venta(s) con saldo pendiente: usa Registrar abono."
   :"No hay saldos pendientes entre estas ventas. Los cobros anteriores aparecen en el comprobante de cada venta."));
 const selected=paymentSaleSelect.value;
 renderSales();
 window.dispatchEvent(new CustomEvent("tsys:ventas-lista"));
 if(Array.from(paymentSaleSelect.options).some(o=>o.value===selected))paymentSaleSelect.value=selected;
 const anuladas=sales.filter(s=>s.estado==="anulada").length;
 const devueltas=sales.filter(s=>s.estado==="devuelta").length;
 displayStatus("ventas-list-status",sales.length+" ventas mostradas: "+(sales.length-anuladas-devueltas)+
  " vigentes, "+anuladas+" anuladas y "+devueltas+" devueltas"+
  (Number(count)>100?" (máximo 100 recientes)":"")+".");
 await refreshSummary();
}
async function refresh(){
 await Promise.all([refreshCatalog(),refreshSales()]);
}
$("ventas-actualizar").addEventListener("click",refresh);
$("venta-agregar-producto").addEventListener("click",()=>{
 if(!isActive){displayStatus("venta-form-status","Inicia sesión como administrador.");return}
 const id=productSelect.value;
 const qty=Number(form.elements.cantidad.value);
 const p=products.find(x=>x.id===id);
 if(!p||!Number.isSafeInteger(qty)||qty<1){
  displayStatus("venta-form-status","Selecciona una referencia y una cantidad entera válida.");
  return;
 }
 const existing=cart.find(x=>x.producto_id===id);
 const sum=qty+(existing?.cantidad||0);
 if(sum>p.cantidad){
  displayStatus("venta-form-status","No hay unidades suficientes para esa cantidad.");
  return;
 }
 if(existing)existing.cantidad=sum;
 else cart.push({producto_id:id,cantidad:qty});
 displayStatus("venta-form-status",p.codigo+" agregado al carrito.");
 renderCart();
});
$("venta-abono").addEventListener("input",renderCart);
form.addEventListener("submit",async e=>{
 e.preventDefault();
 if(!isActive){displayStatus("venta-form-status","Inicia sesión para registrar una venta.");return}
 if(registering)return;
 if(!(await refreshCaja())){displayStatus("venta-form-status","Abre Caja antes de registrar la venta.");return}
 const total=cartTotal();
 const abono=window.tsysParseCOP(form.elements.abono.value);
 const metodo=String(form.elements.medio.value||"");
 const paciente=patientSelect.value;
 if(!cart.length){displayStatus("venta-form-status","Primero agrega productos al carrito.");return}
 if(!Number.isFinite(abono)||abono<0||abono>total){
  displayStatus("venta-form-status","El abono inicial debe estar entre cero y el total.");
  return;
 }
 if(abono>0&&!metodo){displayStatus("venta-form-status","Selecciona el medio del pago inicial.");return}
 if(abono===0&&metodo){displayStatus("venta-form-status","Sin pago inicial, el medio debe quedar vacío.");return}
 if(!window.confirm("¿Registrar esta venta de prueba y descontar existencias en Supabase?"))return;
 registering=true;$("venta-guardar").disabled=true;
 displayStatus("venta-form-status","Registrando venta…");
 try{
  if(!(await authorized())){displayStatus("venta-form-status","Tu sesión ya no autoriza registrar ventas.");return;}
  const {data,error}=await sb.rpc("crear_venta_tsysoptics",{
   p_items:cart.map(x=>({producto_id:x.producto_id,cantidad:x.cantidad})),
   p_paciente_id:paciente||null,
   p_abono:abono,p_medio_pago:metodo||null,p_solicitud_id:saleToken
  });
  if(error||!data){displayStatus("venta-form-status",saleError(error));return}
  saleToken=crypto.randomUUID();cart=[];
  form.reset();form.elements.cantidad.value="1";form.elements.abono.value="0";
  window.tsysFormatCOPInputs(form);
  displayStatus("venta-form-status","Venta registrada y existencias descontadas en Supabase.");
  await refresh();
  window.dispatchEvent(new Event("tsys:ventas-actualizadas"));
  window.dispatchEvent(new Event("tsys:inventario-refrescar"));
  const receiptSale=sales.find(s=>s.id===data);
  if(receiptSale)receiptOpen(receiptSale);
 }catch{
  displayStatus("venta-form-status","No se pudo confirmar el registro. Actualiza el historial antes de reintentar.");
 }finally{
  registering=false;setCajaEstado(cajaAbierta);renderCart();
 }
});
paymentsForm.addEventListener("submit",async e=>{
 e.preventDefault();
 if(!isActive){displayStatus("ventas-abono-status","Inicia sesión para registrar cobros.");return}
 if(collecting)return;
 if(!(await refreshCaja())){displayStatus("ventas-abono-status","Abre Caja antes de registrar un abono.");return}
 const sale=sales.find(x=>x.id===paymentSaleSelect.value);
 const monto=window.tsysParseCOP(paymentsForm.elements.monto.value);
 const medio=String(paymentsForm.elements.medio.value||"");
 if(!sale||sale.estado!=="emitida"||!Number.isFinite(monto)||monto<=0||monto>Number(sale.saldo)||!paymentLabel[medio]){
  displayStatus("ventas-abono-status","Elige una venta y un abono válido, sin superar su saldo.");
  return;
 }
 if(!window.confirm("¿Registrar este abono de prueba?"))return;
 collecting=true;$("ventas-registrar-abono").disabled=true;
 displayStatus("ventas-abono-status","Registrando cobro…");
 try{
  if(!(await authorized())){displayStatus("ventas-abono-status","Tu sesión ya no autoriza registrar cobros.");return;}
  const {data,error}=await sb.rpc("registrar_abono_tsysoptics",{
   p_venta_id:sale.id,p_monto:monto,p_medio:medio,p_operacion_id:paymentToken
  });
  if(error||!data){displayStatus("ventas-abono-status",saleError(error));return}
  paymentToken=crypto.randomUUID();
  paymentsForm.reset();window.tsysFormatCOPInputs(paymentsForm);
  displayStatus("ventas-abono-status","Abono registrado correctamente en Supabase.");
  await refreshSales();
  window.dispatchEvent(new Event("tsys:ventas-actualizadas"));
  const updated=sales.find(s=>s.id===sale.id);
  if(updated)receiptOpen(updated);
 }catch{
  displayStatus("ventas-abono-status","No se pudo confirmar el abono. Actualiza el historial antes de repetir.");
 }finally{
  collecting=false;setCajaEstado(cajaAbierta);
 }
});
function reset(){
 isActive=false;isStarting=false;generation++;
 voiding=false;voidModal.hidden=true;saleToVoid=null;voidToken=crypto.randomUUID();voidForm.reset();
 setCajaEstado(false);
 products=[];patients=[];sales=[];cart=[];mobileProductFilter="";
 window.tsysVentasMobileReset?.();
 receiptClose();
 saleList.replaceChildren();cartRoot.replaceChildren();
 productSelect.replaceChildren(new Option("Seleccionar referencia",""));
 lensCatalog.value="";lensName.value="";lensPrice.value="";lensQuantity.value="1";
 displayStatus("venta-lente-status","");
 window.dispatchEvent(new CustomEvent("tsys:ventas-carrito",{detail:{unidades:0,total:0}}));
 window.dispatchEvent(new CustomEvent("tsys:ventas-lista"));
 patientSelect.replaceChildren(new Option("Consumidor final",""));
 paymentSaleSelect.replaceChildren(new Option("Seleccionar venta con saldo",""));
 displayStatus("venta-form-status","");
 displayStatus("ventas-list-status","");
 displayStatus("ventas-abono-status","");
 displayStatus("ventas-conciliacion","");
}
function addNotesLink(){
 const title=document.querySelector("#ventas h1");
 if(!title||document.getElementById("ventas-link-devoluciones"))return;
 const link=element("a","Notas crédito internas · Devoluciones");
 link.href="./devoluciones.html";link.id="ventas-link-devoluciones";
 link.className="btn alt";link.style.display="inline-block";link.style.margin="8px 0 14px";
 title.insertAdjacentElement("afterend",link);
}
async function activate(){
 if(isActive||isStarting)return;
 isStarting=true;
 try{
  if(!(await authorized())){
   displayStatus("ventas-list-status","No tienes permiso para consultar ventas.");
   return;
  }
  isActive=true;addNotesLink();await Promise.all([refresh(),refreshCaja()]);
 }catch{
  displayStatus("ventas-list-status","No fue posible iniciar el módulo de ventas.");
 }finally{isStarting=false}
}
window.addEventListener("tsys:role",e=>{
 if(e.detail?.role==="administrador")void activate();
 else reset();
});
window.addEventListener("tsys:locked",reset);
if($("tsys-app")?.dataset.role==="administrador")void activate();
