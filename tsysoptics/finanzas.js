import {createClient} from "https://esm.sh/@supabase/supabase-js@2";
import {SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY} from "./supabase-config.js";
const db=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{flowType:"pkce",persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const $=id=>document.getElementById(id);
const money=v=>new Intl.NumberFormat("es-CO",{style:"currency",currency:"COP",maximumFractionDigits:2}).format(Number(v)||0);
const fmt=v=>v?new Date(v).toLocaleString("es-CO",{timeZone:"America/Bogota"}):"";
let admin=false,busy=false,epoch=0;
const msg=(id,value)=>{$(id).textContent=value};
function escape(value){const span=document.createElement("span");span.textContent=String(value??"");return span}
function adminFlag(v){
 admin=!!v;
 $("gasto-guardar").disabled=!admin;
 $("cierre-ejecutar").disabled=!admin;
 $("finanzas-actualizar").disabled=!admin;
 if(!admin){$("gastos-lista").replaceChildren();$("cierres-lista").replaceChildren();msg("finanzas-status","Módulo reservado al administrador.")}
}
async function verify(){
 const {data:user,error}=await db.auth.getUser();
 if(error||!user?.user)return false;
 const {data:profile,error:e}=await db.from("usuarios_tsysoptics").select("rol,activo").eq("id",user.user.id).maybeSingle();
 return !e&&profile?.activo===true&&profile?.rol==="administrador";
}
function bogotaToday(){
 return new Intl.DateTimeFormat("sv-SE",{timeZone:"America/Bogota",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
}
function selectedMonth(){return $("informe-mes").value}
function maxPeriod(){return bogotaToday().slice(0,7)}
function renderList(id,rows,kind){
 const root=$(id);root.replaceChildren();
 if(!rows.length){const p=document.createElement("p");p.className="muted";p.textContent=kind==="gasto"?"No hay gastos registrados en el periodo.":"Todavía no existen cierres guardados.";root.append(p);return}
 for(const x of rows){
  const row=document.createElement("div");row.className="item fin-item";
  const a=document.createElement("div"),title=document.createElement("strong"),meta=document.createElement("small"),right=document.createElement("strong");
  if(kind==="gasto"){
   title.textContent=x.categoria+" · "+x.descripcion;
   meta.textContent=x.fecha+" · "+x.medio.toUpperCase("es-CO")+(x.referencia?" · "+x.referencia:"");
   right.textContent=money(x.monto);
  }else{
   title.textContent="Cierre "+x.periodo;
   meta.textContent="Registrado: "+fmt(x.cerrado_en)+" · inventario capturado: "+fmt(x.datos?.inventario_fecha_captura);
   right.textContent="Ventas "+money(x.datos?.ventas_total)+" · Gastos "+money(x.datos?.gastos_total);
   const detail=document.createElement("p");detail.className="muted";
   const cost=Number(x.datos?.costo_ventas_estimado)||0;
   detail.textContent="Resultado estimado: "+money((Number(x.datos?.ventas_total)||0)-cost-(Number(x.datos?.gastos_total)||0))+
    " · Stock "+(Number(x.datos?.inventario_unidades)||0)+" uds. · Diferencia arqueos "+money(x.datos?.arqueo_diferencia);
   a.append(detail);
  }
  a.prepend(title,meta);row.append(a,right);root.append(row);
 }
}
async function refresh(){
 if(!admin)return;
 const seq=++epoch;
 msg("finanzas-status","Consultando gastos y cierres...");
 try{
  const month=selectedMonth();
  const [g,c]=await Promise.all([
   db.from("gastos_tsysoptics").select("id,fecha,categoria,descripcion,monto,medio,referencia")
    .gte("fecha",month+"-01").lt("fecha",nextMonth(month)+"-01").order("fecha",{ascending:false}).limit(1000),
   db.from("cierres_mensuales_tsysoptics").select("id,periodo,datos,cerrado_en")
    .order("periodo",{ascending:false}).limit(36)
  ]);
  if(g.error||c.error)throw Error(g.error?.message||c.error?.message);
  if(seq!==epoch)return;
  renderList("gastos-lista",g.data||[],"gasto");
  renderList("cierres-lista",c.data||[],"cierre");
  const total=(g.data||[]).reduce((sum,x)=>sum+Number(x.monto||0),0);
  msg("gastos-total","Gastos registrados del periodo: "+money(total));
  const stored=(c.data||[]).find(x=>x.periodo===month);
  msg("finanzas-status",stored?"Mes "+month+" cerrado. El cierre histórico es inmutable.":"Mes "+month+" sin cierre guardado.");
  $("cierre-ejecutar").disabled=!admin||!!stored||month>=maxPeriod();
  $("cierre-confirmacion").disabled=!admin||!!stored||month>=maxPeriod();
  $("cierre-advertencia").textContent=month>=maxPeriod()
   ?"Solo puedes cerrar meses que ya terminaron."
   :stored?"Cierre existente desde "+fmt(stored.cerrado_en)+". No se permite repetirlo."
   :"El cierre registra una fotografía del inventario AL MOMENTO de confirmar, incluso si el periodo terminó antes.";
 }catch(e){msg("finanzas-status","Error: "+(e?.message||e))}
}
function nextMonth(month){const [y,m]=month.split("-").map(Number);return m===12?(y+1)+"-01":y+"-"+String(m+1).padStart(2,"0")}
async function addExpense(e){
 e.preventDefault();if(busy||!admin)return;
 busy=true;const submit=$("gasto-guardar");submit.disabled=true;
 try{
  if(!(await verify())){adminFlag(false);return}
  const amount=Number($("gasto-monto").value),description=$("gasto-descripcion").value.trim();
  if(!Number.isFinite(amount)||amount<=0||amount>99999999999)throw Error("El monto debe ser positivo y válido.");
  if(description.length<3||description.length>300)throw Error("Describe el gasto en 3 a 300 caracteres.");
  const data={fecha:$("gasto-fecha").value,categoria:$("gasto-categoria").value,
   descripcion,monto:amount,medio:$("gasto-medio").value,referencia:$("gasto-referencia").value.trim()||null};
  const {error}=await db.from("gastos_tsysoptics").insert(data);
  if(error)throw Error(error.message);
  $("gasto-form").reset();$("gasto-fecha").value=bogotaToday();
  msg("gasto-status","Gasto registrado. Es un asiento operativo no editable; verifica los valores antes de guardar.");
  await refresh();
 }catch(e){msg("gasto-status","No se registró el gasto: "+(e?.message||e))}
 finally{busy=false;submit.disabled=!admin}
}
async function closeMonth(){
 if(busy||!admin)return;
 const month=selectedMonth();
 if($("cierre-confirmacion").value.trim().toUpperCase()!=="CERRAR "+month){
  msg("cierre-status","Escribe exactamente CERRAR "+month+" para confirmar.");return;
 }
 if(month>=maxPeriod()){msg("cierre-status","No se puede cerrar el mes actual ni uno futuro.");return}
 busy=true;$("cierre-ejecutar").disabled=true;
 msg("cierre-status","Guardando cierre histórico...");
 try{
  if(!(await verify())){adminFlag(false);return}
  const {data,error}=await db.rpc("cerrar_mes_tsysoptics",{p_periodo:month});
  if(error)throw Error(error.message);
  msg("cierre-status","Cierre "+data.periodo+" guardado. Inventario: "+(data.datos?.inventario_unidades||0)+" unidades; gastos: "+money(data.datos?.gastos_total)+".");
  $("cierre-confirmacion").value="";
  await refresh();
 }catch(e){msg("cierre-status","No se realizó el cierre: "+(e?.message||e))}
 finally{busy=false}
}
$("gasto-fecha").value=bogotaToday();
$("gasto-form").addEventListener("submit",e=>void addExpense(e));
$("finanzas-actualizar").addEventListener("click",()=>void refresh());
$("cierre-ejecutar").addEventListener("click",()=>void closeMonth());
$("informe-mes").addEventListener("change",()=>void refresh());
window.addEventListener("tsys:locked",()=>{epoch++;adminFlag(false)});
window.addEventListener("tsys:role",async event=>{
 const enabled=event.detail?.role==="administrador"&&await verify();
 adminFlag(enabled);if(enabled)void refresh();
});
adminFlag(false);
if($("tsys-app")?.dataset.role==="administrador")void verify().then(ok=>{adminFlag(ok);if(ok)void refresh()});
