import {createClient} from "https://esm.sh/@supabase/supabase-js@2";
import {SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY} from "./supabase-config.js";
import "./inventario-movil.js?v=20261029a";

// Módulo centralizado: el navegador nunca guarda ni modifica inventario local.
// La base de datos valida permisos, cantidades y registra movimientos en un trigger.
const db=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{
 auth:{flowType:"pkce",autoRefreshToken:true,persistSession:true,detectSessionInUrl:true}
});
const $=id=>document.getElementById(id);
const form=$("form-producto");
const adjustForm=$("inventario-ajuste-form");
const list=$("lista-productos");
const movements=$("inventario-movimientos");
const select=$("inventario-ajuste-producto");
let products=[];
let serverCount=0,mobileStockFilter="todos";
let adminReady=false,initializing=false,busy=false,adjusting=false;
let generation=0,loadingMore=false;
const pageSize=250;
const money=value=>new Intl.NumberFormat("es-CO",{style:"currency",currency:"COP",maximumFractionDigits:0}).format(Number(value)||0);
function status(id,msg){$(id).textContent=msg}
function element(tag,value,css){
 const out=document.createElement(tag);
 if(value!==undefined)out.textContent=String(value);
 if(css)out.className=css;
 return out;
}
function errorText(error,which){
 if(error?.code==="23505")return "Ya existe una referencia con ese código. Elige otro.";
 if(error?.code==="23514")return "Revisa el código, precio o las cantidades.";
 return which==="stock" ? "No se pudo ajustar el inventario. Verifica los permisos y la conexión."
  : "No se pudo guardar la referencia. Verifica los permisos y la conexión.";
}
async function isAdmin(){
 const {data,error}=await db.auth.getUser();
 if(error||!data?.user)return false;
 const {data:p,error:pe}=await db.from("usuarios_tsysoptics").select("rol,activo").eq("id",data.user.id).maybeSingle();
 return !pe && p?.rol==="administrador" && p?.activo===true;
}
function clearEdit(){
 form.reset();window.tsysFormatCOPInputs(form);
 $("inventario-editar-id").value="";
 $("inventario-form-title").textContent="Nueva referencia";
 $("inventario-guardar").textContent="Agregar referencia";
 $("inventario-cantidad-inicial").disabled=false;
 $("inventario-aviso-edicion").hidden=true;
 $("inventario-cancelar-edicion").hidden=true;
}
function beginEdit(product){
 form.elements.editar_id.value=product.id;
 form.elements.codigo.value=product.codigo;
 form.elements.nombre.value=product.nombre;
 form.elements.tipo.value=product.tipo;
 form.elements.precio.value=product.precio_venta;
 form.elements.costo.value=product.costo_compra==null?"":product.costo_compra;
 window.tsysFormatCOPInputs(form);
 form.elements.cantidad.value=product.cantidad;
 form.elements.stock_minimo.value=product.stock_minimo;
 $("inventario-form-title").textContent="Editar referencia";
 $("inventario-guardar").textContent="Guardar cambios";
 $("inventario-cantidad-inicial").disabled=true;
 $("inventario-aviso-edicion").hidden=false;
 $("inventario-cancelar-edicion").hidden=false;
 status("inventario-form-status","Edición de ficha: las existencias se ajustan por separado.");
 window.tsysInventarioMobileTab?.("nuevo");
 form.scrollIntoView({behavior:"smooth",block:"start"});
}
$("inventario-cancelar-edicion").addEventListener("click",()=>{
 clearEdit();status("inventario-form-status","");
});
function normalizeFilter(text){
 return String(text||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"")
  .toLocaleUpperCase("es-CO");
}
function matchingStock(p,which){
 switch(which){
  case "alerta":return p.activo&&p.cantidad<=p.stock_minimo;
  case "agotadas":return p.activo&&p.cantidad===0;
  case "inactivas":return !p.activo;
  default:return true;
 }
}
function notifyInventoryMetrics(){
 const active=products.filter(p=>p.activo);
 window.dispatchEvent(new CustomEvent("tsys:inventario-resumen",{
  detail:{
   total:products.length,
   alert:active.filter(p=>p.cantidad<=p.stock_minimo).length,
   empty:active.filter(p=>p.cantidad===0).length,
   inactive:products.length-active.length
  }
 }));
}
function render(){
 if(!adminReady)return;
 const query=normalizeFilter($("inventario-buscar").value.trim());
 const mobile=window.matchMedia("(max-width: 850px)").matches;
 const filter=mobile?mobileStockFilter:$("inventario-filtro-stock").value;
 const visible=products.filter(p=>
  (!query||normalizeFilter(p.codigo+" "+p.nombre).includes(query))
  &&matchingStock(p,filter)
 );
 list.replaceChildren();
 if(!visible.length){
  list.append(element("p","No hay referencias que coincidan con estos filtros.","muted"));
 }else{
  for(const p of visible){
   const row=element("div",undefined,"item");
   const info=document.createElement("div");
   const low=p.activo&&p.cantidad<=p.stock_minimo;
   const empty=p.activo&&p.cantidad===0;
   if(!p.activo)row.classList.add("tsys-inv-row-inactive");
   else if(empty)row.classList.add("tsys-inv-row-empty");
   else if(low)row.classList.add("tsys-inv-row-low");
   info.append(
    element("strong",p.codigo+" · "+p.nombre),
    element("small",p.tipo+" · Precio "+money(p.precio_venta)+
     " · Existencias: "+p.cantidad+" · Mínimo: "+p.stock_minimo)
   );
   const label= !p.activo?"Inactiva":empty?"Sin existencias":
    low?"Stock mínimo alcanzado":"Stock disponible";
   info.append(element("small",label,low?"stock-danger":"stock-ok"));
   const tag=element("span","Stock: "+p.cantidad+
    " · Mínimo: "+p.stock_minimo,"tsys-inv-stock-label");
   tag.setAttribute("aria-label","Existencias: "+p.cantidad+
    ". Nivel mínimo configurado: "+p.stock_minimo);
   info.append(tag);
   row.append(info);
   const actions=element("div",undefined,"inv-actions");
   const edit=element("button","Editar");edit.type="button";
   edit.addEventListener("click",()=>beginEdit(p));
   const adjust=element("button","Ajustar stock");adjust.type="button";
   adjust.addEventListener("click",()=>{
    select.value=p.id;
    $("inventario-ajuste-cantidad").value=String(p.cantidad);
    status("inventario-ajuste-status",
     "Existencias actuales: "+p.cantidad+". Indica la cantidad real y justifica el ajuste.");
    window.tsysInventarioMobileTab?.("ajustar");
    adjustForm.scrollIntoView({behavior:"smooth",block:"start"});
   });
   const active=element("button",p.activo?"Desactivar":"Reactivar");active.type="button";
   active.addEventListener("click",()=>toggleActive(p,active));
   actions.append(edit,adjust,active);
   row.append(actions);
   list.append(row);
  }
 }
 const limit=serverCount>products.length
  ?" Mostrando "+products.length+" de "+serverCount+" referencias; pulsa Cargar más para ver el resto." : "";
 $("inventario-mas").hidden=serverCount<=products.length;
 status("inventario-list-status",visible.length+" de "+products.length+
  " referencias cargadas mostradas."+limit);
 notifyInventoryMetrics();
 window.dispatchEvent(new CustomEvent("tsys:inventario-buscar",{
  detail:{visible:visible.length,total:products.length,filter}
 }));
}
window.tsysInventarioMobileFilter=filter=>{
 if(!["todos","alerta","agotadas","inactivas"].includes(filter))return;
 mobileStockFilter=filter;
 render();
};
function fillAdjustList(){
 const previous=select.value;
 select.replaceChildren(new Option("Seleccionar referencia",""));
 for(const p of products){
  const o=new Option(p.codigo+" · "+p.nombre+" ("+p.cantidad+" uds)",p.id);
  select.append(o);
 }
 if(products.some(p=>p.id===previous))select.value=previous;
}
async function loadProducts(more=false){
 if(!adminReady||loadingMore)return;
 const mine=more?generation:++generation;
 const offset=more?products.length:0;
 if(more)loadingMore=true;
 const button=$("inventario-mas");
 button.disabled=true;
 status("inventario-list-status",more?"Cargando más referencias…":"Consultando inventario…");
 try{
  const {data,error,count}=await db.from("productos_tsysoptics")
   .select("id,codigo,nombre,tipo,precio_venta,costo_compra,cantidad,stock_minimo,activo",{count:"exact"})
   .order("nombre",{ascending:true}).order("id",{ascending:true})
   .range(offset,offset+pageSize-1);
  if(!adminReady||mine!==generation)return;
  if(error){
   status("inventario-list-status","No se pudo consultar el inventario en Supabase.");
   return;
  }
  const rows=data||[];
  products=more?[...new Map([...products,...rows].map(p=>[p.id,p])).values()]:rows;
  serverCount=count??products.length;
  if(typeof window.tsysInventarioSetCount==="function")window.tsysInventarioSetCount(serverCount);
  fillAdjustList();
  render();
 }catch{
  if(adminReady&&mine===generation)
   status("inventario-list-status","No se pudo cargar el inventario. Comprueba la conexión.");
 }finally{
  loadingMore=false;
  button.disabled=false;
 }
}
async function loadMovements(){
 if(!adminReady)return;
 const {data,error}=await db.from("movimientos_inventario_tsysoptics")
  .select("id,producto_id,cantidad_anterior,cantidad_nueva,diferencia,motivo,creado_en,producto:productos_tsysoptics(codigo,nombre)")
  .order("creado_en",{ascending:false}).limit(25);
 movements.replaceChildren();
 if(error){movements.append(element("p","No se pudo consultar el historial de movimientos."));return}
 if(!data?.length){movements.append(element("p","Todavía no hay movimientos de existencias."));return}
 for(const item of data){
  const row=element("div",undefined,"item");
  const info=document.createElement("div");
  const code=item.producto?.codigo||"Referencia";
  info.append(
   element("strong",code+" · "+(item.diferencia>=0?"+":"")+item.diferencia+" unidades"),
   element("small",item.cantidad_anterior+" → "+item.cantidad_nueva+" · "+item.motivo),
   element("small",new Date(item.creado_en).toLocaleString("es-CO"))
  );
  row.append(info);movements.append(row);
 }
}
async function refresh(){
 await loadProducts();
 await loadMovements();
}
form.addEventListener("submit",async e=>{
 e.preventDefault();
 if(!adminReady){status("inventario-form-status","El inventario requiere una sesión de administrador validada.");return;}
 if(busy)return;
 const values=new FormData(form);
 const id=String(values.get("editar_id")||"");
 const codigo=String(values.get("codigo")||"").trim().toUpperCase();
 const nombre=String(values.get("nombre")||"").trim().toLocaleUpperCase("es-CO");
 const tipo=String(values.get("tipo")||"");
 const precio=window.tsysParseCOP(values.get("precio"));
 const rawCost=String(values.get("costo")||"").trim();
 const cost=rawCost===""?null:window.tsysParseCOP(rawCost);
 const inicial=Number(values.get("cantidad"));
 const minimo=Number(values.get("stock_minimo"));
 if(codigo.length<3||codigo.length>40||nombre.length<2||nombre.length>120||!Number.isFinite(precio)||precio<0||
   (cost!==null&&(!Number.isFinite(cost)||cost<0))||!Number.isSafeInteger(minimo)||minimo<0||
   (!id&&(!Number.isSafeInteger(inicial)||inicial<0))){
  status("inventario-form-status","Revisa el código, la descripción, los precios y las cantidades.");
  return;
 }
 const payload={codigo,nombre,tipo,precio_venta:precio,costo_compra:cost,stock_minimo:minimo};
 if(!id)payload.cantidad=inicial;
 busy=true;$("inventario-guardar").disabled=true;
 status("inventario-form-status","Guardando referencia…");
 try{
  if(!(await isAdmin())){reset();status("inventario-form-status","La sesión ya no permite modificar inventario.");return;}
  const result=id?
   await db.from("productos_tsysoptics").update(payload).eq("id",id).select("id").maybeSingle():
   await db.from("productos_tsysoptics").insert(payload).select("id").maybeSingle();
  if(result.error||!result.data){status("inventario-form-status",errorText(result.error,"producto"));return}
  clearEdit();
  status("inventario-form-status",id?"Referencia actualizada en Supabase.":"Referencia registrada en Supabase.");
  await refresh();
 }catch{status("inventario-form-status","Falló la conexión. Intenta nuevamente.");}
 finally{busy=false;$("inventario-guardar").disabled=false}
});
select.addEventListener("change",()=>{
 const p=products.find(x=>x.id===select.value);
 if(p){
  $("inventario-ajuste-cantidad").value=String(p.cantidad);
  status("inventario-ajuste-status","Existencias actuales: "+p.cantidad+
   ". Ingresa la cantidad real y explica el ajuste.");
 }
});
adjustForm.addEventListener("submit",async e=>{
 e.preventDefault();
 if(!adminReady){status("inventario-ajuste-status","Debes iniciar sesión antes de ajustar existencias.");return;}
 if(adjusting)return;
 const v=new FormData(adjustForm);
 const id=String(v.get("producto_id")||"");
 const quantity=Number(v.get("nueva_cantidad"));
 const motivo=String(v.get("motivo")||"").trim();
 if(!products.some(p=>p.id===id)||!Number.isSafeInteger(quantity)||quantity<0||motivo.length<3||motivo.length>160){
  status("inventario-ajuste-status","Selecciona una referencia y escribe un ajuste y un motivo válidos.");
  return;
 }
 adjusting=true;$("inventario-ajuste-guardar").disabled=true;
 status("inventario-ajuste-status","Registrando ajuste…");
 try{
  if(!(await isAdmin())){reset();status("inventario-ajuste-status","La sesión ya no permite ajustar existencias.");return;}
  const {error}=await db.rpc("ajustar_existencias_tsysoptics",{
   p_producto_id:id,p_nueva_cantidad:quantity,p_motivo:motivo
  });
  if(error){status("inventario-ajuste-status",errorText(error,"stock"));return}
  adjustForm.reset();
  status("inventario-ajuste-status","Existencias actualizadas y movimiento registrado en Supabase.");
  await refresh();
 }catch{status("inventario-ajuste-status","No se pudo guardar el ajuste. Verifica la conexión.");}
 finally{adjusting=false;$("inventario-ajuste-guardar").disabled=false}
});
async function toggleActive(p,button){
 if(!adminReady)return;
 const action=p.activo?"desactivar":"reactivar";
 if(!window.confirm("¿Quieres "+action+" esta referencia? No se borrará su historial."))return;
 button.disabled=true;
 try{
  if(!(await isAdmin())){reset();status("inventario-list-status","La sesión ya no permite cambiar referencias.");return;}
  const {data,error}=await db.from("productos_tsysoptics")
   .update({activo:!p.activo}).eq("id",p.id).eq("activo",p.activo).select("id").maybeSingle();
  if(error||!data){status("inventario-list-status","No se pudo cambiar el estado.");return}
  await refresh();
 }catch{status("inventario-list-status","No se pudo actualizar el estado.")}
 finally{button.disabled=false}
}
$("inventario-actualizar").addEventListener("click",refresh);
$("inventario-buscar").addEventListener("input",render);
$("inventario-filtro-stock").addEventListener("change",render);
$("inventario-mas").addEventListener("click",()=>loadProducts(true));
window.matchMedia("(max-width: 850px)").addEventListener("change",()=>{
 if(adminReady)render();
});
async function activate(){
 if(adminReady||initializing)return;
 initializing=true;
 try{
  if(!(await isAdmin())){status("inventario-list-status","No tienes permiso para consultar el inventario.");return}
  adminReady=true;
  await refresh();
 }catch{
  status("inventario-list-status","No se pudo iniciar el inventario.");
 }finally{initializing=false}
}
function reset(){
 adminReady=false;initializing=false;generation++;loadingMore=false;
 products=[];serverCount=0;mobileStockFilter="todos";
 $("inventario-filtro-stock").value="todos";$("inventario-mas").hidden=true;
 list.replaceChildren();movements.replaceChildren();
 window.tsysInventarioMobileReset?.();
 notifyInventoryMetrics();
 clearEdit();adjustForm.reset();
 status("inventario-list-status","");status("inventario-form-status","");status("inventario-ajuste-status","");
}
window.addEventListener("tsys:role",e=>{
 if(e.detail?.role==="administrador")void activate();else reset();
});
window.addEventListener("tsys:locked",reset);
// Una venta confirmada por Supabase actualiza la existencia visible sin recargar la página.
window.addEventListener("tsys:inventario-refrescar",()=>{if(adminReady)void refresh();});
if($("tsys-app")?.dataset.role==="administrador")void activate();
