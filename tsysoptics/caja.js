import {createClient} from "https://esm.sh/@supabase/supabase-js@2";
import {SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY} from "./supabase-config.js";

const db=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{
 auth:{flowType:"pkce",persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
});
const $=id=>document.getElementById(id);
const money=n=>new Intl.NumberFormat("es-CO",{style:"currency",currency:"COP",maximumFractionDigits:2}).format(Number(n)||0);
const date=n=>new Date(n).toLocaleString("es-CO",{timeZone:"America/Bogota"});
const labels={efectivo:"Efectivo",nequi:"Nequi",daviplata:"Daviplata",transferencia:"Transferencia",tarjeta:"Tarjeta",otro:"Otros"};
let admin=false,initializing=false,loading=false;
let snapshot=null,requestGeneration=0,doing=null;
let movementToken=crypto.randomUUID();
function status(id,msg){$(id).textContent=msg}
function el(tag,value,cls){
 const node=document.createElement(tag);
 if(value!==undefined&&value!==null)node.textContent=String(value);
 if(cls)node.className=cls;
 return node;
}
function setControls(){
 const open=Boolean(admin&&snapshot?.estado==="abierta");
 const canOpen=Boolean(admin&&!open);
 $("caja-abrir-btn").disabled=!canOpen||doing!==null;
 $("caja-movimiento-btn").disabled=!open||doing!==null;
 $("caja-cierre-btn").disabled=!open||doing!==null;
 $("caja-abrir-form").hidden=!canOpen;
 $("caja-movimiento-form").hidden=!open;
 $("caja-cierre-form").hidden=!open;
}
async function verify(){
 const {data,error}=await db.auth.getUser();
 if(error||!data?.user)return false;
 const {data:p,error:pe}=await db.from("usuarios_tsysoptics").select("rol,activo").eq("id",data.user.id).maybeSingle();
 return !pe&&p?.rol==="administrador"&&p?.activo===true;
}
function notify(){
 window.dispatchEvent(new CustomEvent("tsys:caja",{
  detail:{abierta:admin&&snapshot?.estado==="abierta",turno_id:snapshot?.turno_id||null}
 }));
}
function renderSummary(){
 const s=snapshot;
 const open=s?.estado==="abierta";
 const closed=s?.estado==="cerrada";
 status("caja-estado-mensaje",open?"Caja abierta: puedes registrar ventas y cobros.":closed?"Último turno cerrado. Para operar, abre uno nuevo.":"No hay un turno abierto. Debes abrir caja antes de registrar ventas o abonos.");
 status("caja-turno-fechas",!s?"Sin turnos anteriores.":"Apertura: "+date(s.fecha_apertura)+(s.fecha_cierre?" · Cierre: "+date(s.fecha_cierre):""));
 $("caja-fondo").textContent=money(s?.fondo||0);
 $("caja-efectivo").textContent=money(s?.recibido_efectivo||0);
 $("caja-esperado").textContent=money(s?.esperado||0);
 $("caja-diferencia").textContent=closed?money(s.diferencia_efectivo):"—";
 const medio=$("caja-medios");medio.replaceChildren();
 for(const [key,label] of Object.entries(labels)){
  const li=el("div",undefined,"item");
  const recibido=Number(s?.["recibido_"+key]||0);
  const devuelto=Number(s?.["devuelto_"+key]||0);
  const values=el("div");
  values.style.textAlign="right";
  values.append(el("strong","Neto "+money(recibido-devuelto)));
  const details=el("small","Cobrado "+money(recibido)+" · Devuelto "+money(devuelto));
  details.style.display="block";details.style.marginTop="4px";
  values.append(details);
  li.append(el("strong",label),values);
  medio.append(li);
 }
 status("caja-devoluciones-resumen","Devoluciones registradas en este turno: "+money(Object.keys(labels).reduce(
  (sum,key)=>sum+Number(s?.["devuelto_"+key]||0),0))+
  ". Los importes se descuentan del medio correspondiente; solo el efectivo afecta el arqueo físico.");
 status("caja-manuales-resumen","Movimientos manuales · Ingresos: "+money(s?.ingreso_manual||0)+" · Egresos: "+money(s?.egreso_manual||0));
 setControls();notify();
}
async function refresh(){
 if(!admin||loading)return;
 loading=true;
 const mine=++requestGeneration;
 try{
  const [r,turnos]=await Promise.all([
   db.rpc("resumen_turno_caja_tsysoptics"),
   db.from("turnos_caja_tsysoptics")
    .select("id,estado,abierta_en,cerrada_en,fondo_inicial,efectivo_esperado,efectivo_contado,diferencia")
    .order("abierta_en",{ascending:false}).limit(12)
  ]);
  if(!admin||mine!==requestGeneration)return;
  if(r.error||turnos.error){
   status("caja-estado-mensaje","No se pudo cargar Caja. Comprueba la conexión y los permisos.");
   return;
  }
  snapshot=Array.isArray(r.data)&&r.data.length?r.data[0]:null;
  renderSummary();
  const turnoRows=$("caja-turnos");turnoRows.replaceChildren();
  if(!(turnos.data||[]).length)turnoRows.append(el("p","Todavía no hay turnos registrados.","muted"));
  for(const t of turnos.data||[]){
   const li=el("div",undefined,"item");
   const info=el("div");
   info.append(el("strong",(t.estado==="abierta"?"Abierta":"Cerrada")+" · "+date(t.abierta_en)));
   info.append(el("small","Fondo: "+money(t.fondo_inicial)
    +(t.estado==="cerrada"?" · Efectivo: "+money(t.efectivo_contado)+" · Diferencia: "+money(t.diferencia):"")));
   li.append(info);turnoRows.append(li);
  }
  const moves=$("caja-movimientos");moves.replaceChildren();
  if(snapshot?.turno_id){
   const result=await db.from("movimientos_caja_tsysoptics")
    .select("id,tipo,monto,motivo,fecha").eq("turno_id",snapshot.turno_id)
    .order("fecha",{ascending:false}).limit(40);
   if(!admin||mine!==requestGeneration)return;
   if(result.error)moves.append(el("p","No se pudieron consultar los movimientos."));
   else if(!result.data?.length)moves.append(el("p","No hay movimientos manuales en este turno."));
   else for(const m of result.data){
    const li=el("div",undefined,"item"),info=el("div");
    info.append(el("strong",(m.tipo==="ingreso"?"Ingreso +":"Egreso −")+money(m.monto)));
    info.append(el("small",m.motivo+" · "+date(m.fecha)));
    li.append(info);moves.append(li);
   }
  }else moves.append(el("p","Sin movimientos todavía."));
 }catch{
  status("caja-estado-mensaje","No fue posible actualizar Caja.");
 }finally{loading=false}
}
async function operation(name,work,statusId,success){
 if(!admin||doing!==null)return;
 doing=name;setControls();status(statusId,"Procesando…");
 try{
  const {data,error}=await work();
  if(error||data===null||data===undefined){
   const msg=String(error?.message||"");
   if(/existe.*turno|turno.*abierto/i.test(msg))status(statusId,"Ya hay un turno abierto. Actualiza Caja antes de repetir.");
   else if(/excede el efectivo/i.test(msg))status(statusId,"El egreso es superior al efectivo disponible.");
   else status(statusId,"No fue posible completar la operación. Verifica los datos y actualiza Caja.");
   return;
  }
  status(statusId,success);
  await refresh();
 }catch{status(statusId,"No se pudo confirmar la operación. Actualiza Caja antes de repetirla.");}
 finally{doing=null;setControls()}
}
$("caja-actualizar").addEventListener("click",refresh);
$("caja-abrir-form").addEventListener("submit",async e=>{
 e.preventDefault();
 if(!admin)return;
 const fondo=window.tsysParseCOP(new FormData(e.currentTarget).get("fondo"));
 if(!Number.isFinite(fondo)||fondo<0||fondo>999999999999){
  status("caja-abrir-status","Introduce un fondo inicial válido.");return;
 }
 if(!window.confirm("¿Abrir un turno de caja de prueba con fondo "+money(fondo)+"?"))return;
 await operation("abrir",
  ()=>db.rpc("abrir_turno_caja_tsysoptics",{p_fondo:fondo}),
  "caja-abrir-status","Turno de caja abierto en Supabase.");
});
$("caja-movimiento-form").addEventListener("submit",async e=>{
 e.preventDefault();if(!admin)return;
 const fd=new FormData(e.currentTarget);
 const tipo=String(fd.get("tipo")||""),monto=window.tsysParseCOP(fd.get("monto")),motivo=String(fd.get("motivo")||"").trim();
 if(!["ingreso","egreso"].includes(tipo)||!Number.isFinite(monto)||monto<=0||motivo.length<3||motivo.length>160){
  status("caja-movimiento-status","Completa el tipo, importe y justificación.");return;
 }
 if(!window.confirm("¿Registrar "+tipo+" de "+money(monto)+" en efectivo?"))return;
 const token=movementToken;
 await operation("movimiento",async()=>{
  const response=await db.rpc("movimiento_manual_caja_tsysoptics",{
   p_tipo:tipo,p_monto:monto,p_motivo:motivo,p_operacion_id:token
  });
  if(!response.error&&response.data!==null){
   movementToken=crypto.randomUUID();
   $("caja-movimiento-form").reset();
  }
  return response;
 },"caja-movimiento-status","Movimiento de efectivo registrado.");
});
$("caja-cierre-form").addEventListener("submit",async e=>{
 e.preventDefault();if(!admin)return;
 const fd=new FormData(e.currentTarget);
 const contado=window.tsysParseCOP(fd.get("contado")),obs=String(fd.get("observaciones")||"").trim();
 if(!Number.isFinite(contado)||contado<0||obs.length>500){
  status("caja-cierre-status","Revisa el efectivo contado y las observaciones.");return;
 }
 const esperado=Number(snapshot?.esperado||0);
 const diferencia=contado-esperado;
 if(!window.confirm("¿Cerrar el turno? Efectivo esperado: "+money(esperado)+
  ". Contado: "+money(contado)+". Diferencia estimada: "+money(diferencia)+
  ". El servidor recalculará el saldo antes del cierre."))return;
 await operation("cerrar",()=>db.rpc("cerrar_turno_caja_tsysoptics",{
  p_contado:contado,p_observaciones:obs||null
 }),"caja-cierre-status","Turno cerrado y arqueo registrado.");
});
function reset(){
 admin=false;initializing=false;requestGeneration++;
 snapshot=null;doing=null;
 $("caja-turnos").replaceChildren();$("caja-movimientos").replaceChildren();
 for(const id of ["caja-abrir-status","caja-movimiento-status","caja-cierre-status"])status(id,"");
 status("caja-estado-mensaje","Caja disponible solo para administradores autorizados.");
 setControls();notify();
}
async function activate(){
 if(admin||initializing)return;
 initializing=true;
 try{
  if(!(await verify())){status("caja-estado-mensaje","No tienes permisos para gestionar Caja.");return}
  admin=true;await refresh();
 }catch{status("caja-estado-mensaje","No se pudo inicializar Caja.");}
 finally{initializing=false}
}
window.addEventListener("tsys:role",e=>{if(e.detail?.role==="administrador")void activate();else reset()});
window.addEventListener("tsys:locked",reset);
if($("tsys-app")?.dataset.role==="administrador")void activate();
