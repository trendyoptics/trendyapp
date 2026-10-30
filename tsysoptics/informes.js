import {createClient} from "https://esm.sh/@supabase/supabase-js@2";
import {SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY} from "./supabase-config.js";
import {exportMonthlyXlsx} from "./informes-excel.js?v=20261030v1";
import {createMonthlyPdf} from "./informes-pdf.js?v=20261030v1";

// Informes de solo lectura. RLS de Supabase restringe las tablas al administrador.
const db=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{
 auth:{flowType:"pkce",persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
});
const $=id=>document.getElementById(id);
const money=n=>new Intl.NumberFormat("es-CO",{style:"currency",currency:"COP",maximumFractionDigits:0}).format(Number(n)||0);
const number=n=>new Intl.NumberFormat("es-CO").format(Number(n)||0);
const fmtDate=s=>s?new Date(s).toLocaleDateString("es-CO",{timeZone:"America/Bogota"}):"";
const sum=(arr,fn)=>arr.reduce((n,x)=>n+(Number(fn(x))||0),0);
const normalize=s=>String(s||"").trim();
let authorized=false,loading=false,report=null,requestSeq=0;
const activeStates=new Set(["pendiente","en_fabricacion","recibido","listo_para_entrega"]);
const monthInput=$("informe-mes");
const status=t=>{$("informe-status").textContent=t};
function bogotaDay(){
 const x=Object.fromEntries(new Intl.DateTimeFormat("en-US",{timeZone:"America/Bogota",year:"numeric",month:"2-digit",day:"2-digit"})
  .formatToParts(new Date()).filter(p=>["year","month","day"].includes(p.type)).map(p=>[p.type,p.value]));
 return x.year+"-"+x.month+"-"+x.day;
}
function localMonth(){
 const values=Object.fromEntries(new Intl.DateTimeFormat("en-US",{timeZone:"America/Bogota",year:"numeric",month:"2-digit"})
  .formatToParts(new Date()).filter(x=>x.type==="year"||x.type==="month").map(x=>[x.type,x.value]));
 // Por defecto, el último mes COMPLETO. Puede consultarse el mes actual como provisional.
 const y=Number(values.year),m=Number(values.month);
 return m===1?(y-1)+"-12":y+"-"+String(m-1).padStart(2,"0");
}
monthInput.value=localMonth();
monthInput.max=bogotaDay().slice(0,7);
function monthBounds(month){
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error("Selecciona un mes válido.");
 const [y,m]=month.split("-").map(Number);
 const after=m===12?(y+1)+"-01":y+"-"+String(m+1).padStart(2,"0");
 return {start:new Date(month+"-01T00:00:00-05:00").toISOString(),
  end:new Date(after+"-01T00:00:00-05:00").toISOString(),next:after};
}
async function checkAdmin(){
 const {data,error}=await db.auth.getUser();
 if(error||!data?.user)return false;
 const {data:user,error:profileError}=await db.from("usuarios_tsysoptics")
  .select("rol,activo").eq("id",data.user.id).maybeSingle();
 return !profileError&&user?.rol==="administrador"&&user.activo===true;
}
function setReady(ok){
 $("informe-pdf").disabled=!ok;$("informe-csv").disabled=!ok;$("informe-xlsx").disabled=!ok;
}
function clear(){
 authorized=false;report=null;requestSeq++;
 $("informe-generar").disabled=true;
 setReady(false);$("informe-resultado").hidden=true;
 status("Acceso reservado al administrador. Inicia sesión para consultar los informes.");
}
// Paginación explícita; nunca calcular cifras con los 100/1.000 primeros registros.
async function fetchAll(table,columns,setup=q=>q,sort="id"){
 const result=[],pageSize=600,limit=18000;
 for(let offset=0;offset<limit;offset+=pageSize){
  let q=db.from(table).select(columns).order(sort,{ascending:true}).range(offset,offset+pageSize-1);
  q=setup(q);
  const {data,error}=await q;
  if(error)throw Error("No se pudo consultar "+table+". "+error.message);
  result.push(...(data||[]));
  if(!data||data.length<pageSize)return result;
 }
 throw Error("El periodo tiene más registros de los que este informe puede procesar con seguridad. No se exportarán cifras parciales.");
}
async function fetchBySaleIds(ids){
 if(!ids.length)return [];
 const parts=[];
 for(let i=0;i<ids.length;i+=60){
  const slice=ids.slice(i,i+60);
  parts.push(fetchAll("detalle_ventas_tsysoptics",
   "id,venta_id,codigo_snapshot,nombre_snapshot,cantidad,costo_unitario,total_linea",
   q=>q.in("venta_id",slice)));
 }
 return (await Promise.all(parts)).flat();
}
async function collect(month){
 const {start,end,next}=monthBounds(month);
 const during=(col)=>q=>q.gte(col,start).lt(col,end);
 const [sales,payments,stock,stockMoves,cashMoves,shifts,orders,expenses,storedClose]=await Promise.all([
  fetchAll("ventas_tsysoptics","id,numero,fecha,total,abonado,saldo,estado",during("fecha"),"fecha"),
  fetchAll("pagos_ventas_tsysoptics","id,venta_id,monto,medio,registrado_en",during("registrado_en"),"id"),
  fetchAll("productos_tsysoptics","id,codigo,nombre,tipo,cantidad,stock_minimo,costo_compra,precio_venta,activo",q=>q,"codigo"),
  fetchAll("movimientos_inventario_tsysoptics","id,producto_id,diferencia,motivo,creado_en",during("creado_en"),"id"),
  fetchAll("movimientos_caja_tsysoptics","id,tipo,monto,motivo,fecha",during("fecha"),"id"),
  fetchAll("turnos_caja_tsysoptics","id,estado,cerrada_en,diferencia",during("cerrada_en"),"cerrada_en"),
  fetchAll("ordenes_laboratorio_tsysoptics","id,venta_id,laboratorio,estado,creado_en,fecha_entrega_estimada,fecha_entrega_paciente",q=>q,"creado_en"),
  fetchAll("gastos_tsysoptics","id,fecha,categoria,descripcion,monto,medio,referencia",q=>q.gte("fecha",month+"-01").lt("fecha",next+"-01"),"fecha"),
  db.from("cierres_mensuales_tsysoptics").select("periodo,datos,cerrado_en").eq("periodo",month).maybeSingle().then(({data,error})=>{if(error)throw Error("No se pudo consultar cierre histórico. "+error.message);return data})
 ]);
 const valid=sales.filter(x=>x.estado==="emitida");
 const lines=await fetchBySaleIds(valid.map(x=>x.id));
 const totals=new Map(),methodTotals=new Map(),labStatus=new Map();
 for(const item of lines){
  const key=normalize(item.codigo_snapshot)+"|"+normalize(item.nombre_snapshot);
  if(!totals.has(key))totals.set(key,{codigo:normalize(item.codigo_snapshot),nombre:normalize(item.nombre_snapshot),unidades:0,valor:0,costo:0});
  const a=totals.get(key);
  a.unidades+=Number(item.cantidad)||0;
  a.valor+=Number(item.total_linea)||0;
  a.costo+=(Number(item.costo_unitario)||0)*(Number(item.cantidad)||0);
 }
 for(const p of payments){
  const key=normalize(p.medio)||"no especificado";
  methodTotals.set(key,(methodTotals.get(key)||0)+(Number(p.monto)||0));
 }
 const orderMonth=orders.filter(o=>o.creado_en>=start&&o.creado_en<end);
 for(const o of orderMonth)labStatus.set(o.estado,(labStatus.get(o.estado)||0)+1);
 const stockActive=stock.filter(p=>p.activo);
 const lowStock=stockActive.filter(p=>Number(p.cantidad)<=Number(p.stock_minimo));
 const nowLocal=bogotaDay();
 const overdue=orders.filter(o=>activeStates.has(o.estado)&&o.fecha_entrega_estimada<nowLocal);
 const computed={
  salesTotal:sum(valid,x=>x.total),salesCount:valid.length,
  voidCount:sales.filter(x=>x.estado==="anulada").length,
  returnedCount:sales.filter(x=>x.estado==="devuelta").length,
  paymentsTotal:sum(payments,x=>x.monto),
  balanceNow:sum(valid,x=>x.saldo),
  unitsSold:sum(lines,x=>x.cantidad),
  estimatedCost:sum(lines,x=>(Number(x.costo_unitario)||0)*(Number(x.cantidad)||0)),
  stockUnits:sum(stockActive,x=>x.cantidad),
  stockCost:sum(stockActive,x=>(Number(x.cantidad)||0)*(Number(x.costo_compra)||0)),
  stockRetail:sum(stockActive,x=>(Number(x.cantidad)||0)*(Number(x.precio_venta)||0)),
  stockRefs:stockActive.length,stockLow:lowStock.length,
  stockIn:sum(stockMoves.filter(x=>Number(x.diferencia)>0),x=>x.diferencia),
  stockOut:-sum(stockMoves.filter(x=>Number(x.diferencia)<0),x=>x.diferencia),
  cashIn:sum(cashMoves.filter(x=>x.tipo==="ingreso"),x=>x.monto),
  cashOut:sum(cashMoves.filter(x=>x.tipo==="egreso"),x=>x.monto),
  expensesTotal:sum(expenses,x=>x.monto),
  operatingResult:sum(valid,x=>x.total)-sum(lines,x=>(Number(x.costo_unitario)||0)*(Number(x.cantidad)||0))-sum(expenses,x=>x.monto),
  shiftsClosed:shifts.length,shiftsDifference:sum(shifts,x=>x.diferencia),
  labCreated:orderMonth.length,labOpenNow:orders.filter(o=>activeStates.has(o.estado)).length,
  labOverdueNow:overdue.length
 };
 return {month,after:next,generatedAt:new Date().toISOString(),sales,payments,stock,stockMoves,cashMoves,expenses,storedClose,
  shifts,orders,orderMonth,valid,lines,lowStock,methods:[...methodTotals.entries()].sort((a,b)=>b[1]-a[1]),
  top:[...totals.values()].sort((a,b)=>b.valor-a.valor),labStatus:[...labStatus.entries()],totals:computed};
}
function create(tag,text,klass){
 const e=document.createElement(tag);if(text!==undefined)e.textContent=String(text);
 if(klass)e.className=klass;return e;
}
function list(container,rows,empty="Sin movimientos en el mes seleccionado."){
 container.replaceChildren();const root=create("div",undefined,"report-list");
 if(!rows.length)root.append(create("p",empty,"muted"));
 for(const entry of rows){
  const el=create("div",undefined,"item"),d=create("div");
  d.append(create("strong",entry[0]));
  if(entry[2])d.append(create("small",entry[2]));
  el.append(d,create("strong",entry[1]));root.append(el);
 }
 container.append(root);
}
function metric(label,value,note){
 const div=create("div",undefined,"report-metric");
 div.append(create("span",label),create("strong",value),create("small",note));return div;
}
function render(r){
 const t=r.totals,box=$("informe-indicadores");box.replaceChildren();
 const metrics=[
  ["Ventas vigentes del mes",money(t.salesTotal),number(t.salesCount)+" operaciones"],
  ["Recaudos registrados",money(t.paymentsTotal),"Pagos recibidos durante el mes"],
  ["Saldos pendientes",money(t.balanceNow),"Saldo actual de ventas del mes"],
  ["Unidades vendidas",number(t.unitsSold),"Referencias de ventas vigentes"],
  ["Existencias actuales",number(t.stockUnits),"Al consultar, NO al cierre histórico"],
  ["Inventario a costo",money(t.stockCost),"Valoración actual estimada"],
  ["Órdenes del mes",number(t.labCreated),number(t.labOpenNow)+" órdenes abiertas actualmente"],
  ["Gastos registrados",money(t.expensesTotal),"Gastos operativos del mes"],
  ["Resultado estimado",money(t.operatingResult),"Ventas menos costo vendido y gastos; no es utilidad neta"],
  ["Caja: cierres",number(t.shiftsClosed),"Diferencia acumulada: "+money(t.shiftsDifference)]
 ];
 for(const m of metrics)box.append(metric(...m));
 list($("informe-medios"),r.methods.map(([k,v])=>[k.toLocaleUpperCase("es-CO"),money(v)]));
 list($("informe-productos"),[
  ["Ventas anuladas",number(t.voidCount)],["Ventas devueltas",number(t.returnedCount)],
  ["Costo productos vendidos",money(t.estimatedCost),"Estimación por costos históricos registrados"],
  ["Margen bruto estimado",money(t.salesTotal-t.estimatedCost),"Sin gastos, impuestos ni ajustes contables"],
  ...r.top.slice(0,12).map(x=>[x.nombre||x.codigo,money(x.valor),number(x.unidades)+" unidad(es)"])
 ]);
 list($("informe-stock"),[
  ["Referencias activas",number(t.stockRefs)],
  ["Unidades actuales",number(t.stockUnits)],
  ["Valor actual a precio público",money(t.stockRetail)],
  ["Referencias en alerta",number(t.stockLow)],
  ["Entradas registradas en el mes",number(t.stockIn)],
  ["Salidas registradas en el mes",number(t.stockOut)],
  ...r.lowStock.slice(0,8).map(x=>[x.codigo+" · "+x.nombre,number(x.cantidad)+" uds.","Mínimo "+number(x.stock_minimo)])
 ]);
 list($("informe-laboratorio"),[
  ["Pedidos creados en el mes",number(t.labCreated)],
  ["Pedidos abiertos hoy",number(t.labOpenNow)],
  ["Pedidos atrasados hoy",number(t.labOverdueNow)],
  ...r.labStatus.map(([state,n])=>["Mes · "+state.replaceAll("_"," "),number(n)]),
  ["Ingresos manuales de caja",money(t.cashIn)],
  ["Egresos manuales de caja",money(t.cashOut)],
  ["Turnos cerrados",number(t.shiftsClosed)],
  ["Diferencia en arqueos",money(t.shiftsDifference)]
 ]);
 const isCurrent=r.month===bogotaDay().slice(0,7);
 $("informe-nota").textContent="Periodo de ventas y recaudos: "+r.month+
  ". Cifras de ventas calculadas con el estado vigente al consultar; devoluciones y anulaciones se excluyen del total vigente. Recaudos incluyen pagos registrados durante el mes, incluso de ventas anteriores: no equivalen necesariamente a las ventas del mes ni descuentan posibles devoluciones externas. Stock, saldos y pedidos abiertos reflejan el momento de consulta ("+
  new Date(r.generatedAt).toLocaleString("es-CO")+
  "). Costo y margen son estimaciones, no utilidad contable. "+(isCurrent?"El mes está en curso: informe provisional.":"Mes seleccionado.");
 $("informe-resultado").hidden=false;
}
async function generate(){
 if(loading||!authorized)return;
 const month=monthInput.value;loading=true;requestSeq++;const seq=requestSeq;
 report=null;setReady(false);$("informe-resultado").hidden=true;$("informe-generar").disabled=true;
 status("Consultando datos completos en Supabase. No se mostrarán totales parciales…");
 try{
  if(!(await checkAdmin())){clear();return}
  const result=await collect(month);
  if(seq!==requestSeq||!authorized)return;
  report=result;render(result);setReady(true);
  status("Informe "+month+" generado correctamente. Puedes descargar Excel (.xlsx), PDF o CSV adicional.");
 }catch(e){if(seq===requestSeq)status("No se generó el informe: "+(e?.message||"Error de consulta."))}
 finally{loading=false;$("informe-generar").disabled=!authorized}
}
function download(blob,filename){
 const url=URL.createObjectURL(blob);
 const a=document.createElement("a");a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function sections(r){
 const t=r.totals;
 return [
  {title:"RESUMEN",rows:[
   ["Mes",r.month],["Generado",r.generatedAt],
   ["Ventas vigentes (COP)",t.salesTotal],["Ventas vigentes (cantidad)",t.salesCount],
   ["Anuladas (cantidad)",t.voidCount],["Devueltas (cantidad)",t.returnedCount],
   ["Recaudos registrados en el periodo (COP)",t.paymentsTotal],
   ["Saldos actuales de ventas del periodo (COP)",t.balanceNow],
   ["Unidades vendidas en ventas vigentes",t.unitsSold],
   ["Costo estimado de unidades vendidas (COP)",t.estimatedCost],
   ["Margen bruto estimado (COP)",t.salesTotal-t.estimatedCost],
   ["Gastos registrados del periodo (COP)",t.expensesTotal],
   ["Resultado operativo estimado (COP)",t.operatingResult],
   ["Cierre histórico guardado",r.storedClose?"SI":"NO"],
   ["Unidades inventario ACTUAL",t.stockUnits],
   ["Costo inventario ACTUAL (COP)",t.stockCost],
   ["Valor de venta inventario ACTUAL (COP)",t.stockRetail],
   ["Referencias activas",t.stockRefs],["Referencias bajo mínimo",t.stockLow],
   ["Entradas inventario en el mes",t.stockIn],["Salidas inventario en el mes",t.stockOut],
   ["Pedidos creados en el mes",t.labCreated],
   ["Pedidos abiertos ACTUALES",t.labOpenNow],["Pedidos vencidos ACTUALES",t.labOverdueNow],
   ["Turnos de caja cerrados en el mes",t.shiftsClosed],
   ["Diferencia acumulada de arqueos (COP)",t.shiftsDifference],
   ["Ingresos manuales en caja (COP)",t.cashIn],
   ["Egresos manuales en caja (COP)",t.cashOut]
  ]},
  {title:"PAGOS POR MEDIO",rows:[["Medio","Monto COP"],...r.methods.map(([m,v])=>[m,v])]},
  {title:"PRODUCTOS VENDIDOS EN EL MES",rows:[["Código","Referencia","Unidades","Ventas COP","Costo COP"],
   ...r.top.map(x=>[x.codigo,x.nombre,x.unidades,x.valor,x.costo])]},
  {title:"VENTAS REGISTRADAS EN EL MES",rows:[["Número","Fecha","Estado actual","Total COP","Abonado actual COP","Saldo actual COP"],
   ...r.sales.map(v=>[v.numero,fmtDate(v.fecha),v.estado,v.total,v.abonado,v.saldo])]},
  {title:"INVENTARIO ACTUAL NO HISTÓRICO",rows:[["Código","Referencia","Tipo","Unidades actuales","Stock mínimo","Costo unitario COP","Precio venta COP","Activo"],
   ...r.stock.map(p=>[p.codigo,p.nombre,p.tipo,p.cantidad,p.stock_minimo,p.costo_compra,p.precio_venta,p.activo?"SI":"NO"])]},
  {title:"LABORATORIO PEDIDOS CREADOS EN EL MES",rows:[["Estado actual","Entrega estimada","Entrega paciente"],
   ...r.orderMonth.map(o=>[o.estado,o.fecha_entrega_estimada,o.fecha_entrega_paciente||""])]},
  {title:"MOVIMIENTOS DE INVENTARIO DEL MES",rows:[["Producto ID","Diferencia de unidades","Motivo","Fecha"],
   ...r.stockMoves.map(x=>[x.producto_id,x.diferencia,x.motivo,fmtDate(x.creado_en)])]},
  {title:"GASTOS DEL MES",rows:[["Fecha","Categoría","Descripción","Monto COP","Medio","Referencia"],
   ...r.expenses.map(x=>[x.fecha,x.categoria,x.descripcion,x.monto,x.medio,x.referencia||""])]},
  {title:"CIERRE HISTORICO",rows:[["Indicador","Valor"],
   ["Cierre guardado",r.storedClose?"SI":"NO"],["Fecha cierre",r.storedClose?.cerrado_en||""],
   ["Inventario unidades al ejecutar cierre",r.storedClose?.datos?.inventario_unidades??""],
   ["Inventario valor a costo al ejecutar cierre",r.storedClose?.datos?.inventario_costo??""]]},
  {title:"MOVIMIENTOS MANUALES DE CAJA DEL MES",rows:[["Tipo","Monto COP","Motivo","Fecha"],
   ...r.cashMoves.map(x=>[x.tipo,x.monto,x.motivo,fmtDate(x.fecha)])]},
  {title:"NOTAS DE INTERPRETACIÓN",rows:[
   ["Ventas","Se muestran las ventas creadas en el mes. Totales vigentes excluyen anuladas y devueltas según su estado a la fecha de consulta."],
   ["Recaudos","Pagos registrados en el mes, incluyendo abonos de ventas anteriores. No son necesariamente cobros netos de devoluciones."],
   ["Inventario","Existencias y valoración ACTUALES en la fecha de generación. No se presentan como foto histórica del último día del mes."],
   ["Saldos","Saldo ACTUAL de ventas originadas en el periodo."],
   ["Margen","El resultado operativo estimado resta gastos registrados, sin impuestos, conciliación, ajustes, ni deduplicación con caja."],
   ["Cierre histórico","Las cifras del cierre histórico se congelan una sola vez. El inventario se captura en la fecha de EJECUCIÓN del cierre."],
   ["Alcance","Informe operativo de TsysOptics. No equivale a cierre contable ni declaración tributaria."]
  ]}
 ];
}
function csvField(value){
 if(typeof value==="number")return String(value);
 let text=String(value??"");
 if(/^[\t\r\n ]*[=+@-]/.test(text))text="'"+text;
 return '"'+text.replaceAll('"','""')+'"';
}
function exportCsv(){
 if(!report||!authorized)return;
 const lines=["sep=;"];
 for(const section of sections(report)){
  lines.push("",csvField(section.title));
  for(const row of section.rows)lines.push(row.map(csvField).join(";"));
 }
 const blob=new Blob(["\uFEFF",lines.join("\r\n")],{type:"text/csv;charset=utf-8"});
 download(blob,"TsysOptics_Informe_Mensual_"+report.month+".csv");
}
async function readBrand(){
 try{
  const {data,error}=await db.from("identidad_optica_tsysoptics")
   .select("nombre_optica,logo_data_url").eq("id",1).maybeSingle();
  return error?{}:(data||{});
 }catch{return {}}
}
async function exportXlsx(){
 if(!report||!authorized)return;
 const btn=$("informe-xlsx"),snapshot=report;
 btn.disabled=true;status("Preparando libro Excel con hojas independientes…");
 try{
  if(!(await checkAdmin())){clear();return}
  const brand=await readBrand();
  if(!authorized||report!==snapshot)return;
  const filename=await exportMonthlyXlsx(snapshot,brand.nombre_optica);
  status("Excel generado: "+filename+". Incluye pestañas separadas para ventas, pagos, inventario, laboratorio y caja.");
 }catch(e){status("No se pudo generar el Excel: "+(e?.message||"Error inesperado.")+" Puedes descargar CSV como alternativa.")}
 finally{btn.disabled=!report||!authorized}
}
async function exportPdf(){
 if(!report||!authorized)return;
 const btn=$("informe-pdf"),snapshot=report;
 btn.disabled=true;status("Preparando informe ejecutivo en PDF…");
 try{
  if(!(await checkAdmin())){clear();return}
  const identity=await readBrand();
  if(!authorized||report!==snapshot)return;
  const file=await createMonthlyPdf(snapshot,identity);
  download(file.blob,file.filename);
  status("PDF ejecutivo generado con resumen, ventas, pagos, inventario y laboratorio.");
 }catch(e){status("No se pudo exportar el PDF: "+(e?.message||"Error inesperado."))}
 finally{btn.disabled=!report||!authorized}
}
$("informe-generar").addEventListener("click",()=>void generate());
$("informe-csv").addEventListener("click",exportCsv);
$("informe-xlsx").addEventListener("click",()=>void exportXlsx());
$("informe-pdf").addEventListener("click",()=>void exportPdf());
monthInput.addEventListener("change",()=>{requestSeq++;report=null;setReady(false);$("informe-resultado").hidden=true;status("Mes modificado. Genera nuevamente el informe para exportarlo.");});
window.addEventListener("tsys:locked",clear);
window.addEventListener("tsys:role",async e=>{
 const enabled=e.detail?.role==="administrador"&&await checkAdmin();
 authorized=Boolean(enabled);$("informe-generar").disabled=!authorized;
 if(!authorized)clear();else status("Elige el mes. La generación consultará Supabase y no modificará datos.");
});
if($("tsys-app")?.dataset.role==="administrador"){
 void checkAdmin().then(ok=>{authorized=ok;$("informe-generar").disabled=!ok;if(!ok)clear()});
} else $("informe-generar").disabled=true;
