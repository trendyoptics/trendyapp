import {createClient} from "https://esm.sh/@supabase/supabase-js@2";
import {SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY} from "./supabase-config.js";
import "./movil.js?v=20261030-devoluciones-menu";

const db=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{
 auth:{flowType:"pkce",persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
});
const $=id=>document.getElementById(id);
const money=n=>new Intl.NumberFormat("es-CO",{style:"currency",currency:"COP",maximumFractionDigits:2}).format(Number(n)||0);
const date=n=>new Date(n).toLocaleString("es-CO",{timeZone:"America/Bogota"});
const labels={efectivo:"Efectivo",nequi:"Nequi",daviplata:"Daviplata",transferencia:"Transferencia",tarjeta:"Tarjeta",otro:"Otros"};
let admin=false,initializing=false,loading=false;
let snapshot=null,requestGeneration=0,doing=null,stateKnown=false;
let movementToken=crypto.randomUUID();
function status(id,msg){
 const field=$(id);
 if(field)field.textContent=msg;
}
function ensureRefundLabel(){
 if($("caja-devoluciones-resumen"))return;
 const target=$("caja-manuales-resumen");
 if(!target)return;
 const note=document.createElement("p");
 note.id="caja-devoluciones-resumen";
 note.className="muted";
 target.before(note);
}
ensureRefundLabel();
function el(tag,value,cls){
 const node=document.createElement(tag);
 if(value!==undefined&&value!==null)node.textContent=String(value);
 if(cls)node.className=cls;
 return node;
}
function setControls(){
 const open=Boolean(admin&&stateKnown&&snapshot?.estado==="abierta");
 const canOpen=Boolean(admin&&stateKnown&&!open);
 $("caja-abrir-btn").disabled=!canOpen||doing!==null;
 $("caja-movimiento-btn").disabled=!open||doing!==null;
 $("caja-cierre-btn").disabled=!open||doing!==null;
 // Las acciones siempre son visibles en PC, tablet y móvil.
 // Un turno ya abierto no permite abrir un segundo: se habilita movimiento/cierre.
 $("caja-abrir-form").hidden=false;
 $("caja-movimiento-form").hidden=false;
 $("caja-cierre-form").hidden=false;
 $("caja-abrir-form").dataset.available=String(canOpen);
 $("caja-movimiento-form").dataset.available=String(open);
 $("caja-cierre-form").dataset.available=String(open);
 status("caja-accion-disponible",!admin
  ?"Acciones bloqueadas: se requiere una cuenta administradora activa."
  :!stateKnown
  ?"No se ha podido verificar el turno. Pulsa Actualizar estado de caja."
  :open
  ?"TURNO ABIERTO: usa Registrar movimiento o Cerrar y registrar arqueo. No es posible abrir otro turno."
  :"TURNO CERRADO: registra el fondo inicial y pulsa Abrir caja.");
}
async function verify(){
 const {data,error}=await db.auth.getUser();
 if(error||!data?.user)return false;
 const {data:p,error:pe}=await db.from("usuarios_tsysoptics").select("rol,activo").eq("id",data.user.id).maybeSingle();
 return !pe&&p?.rol==="administrador"&&p?.activo===true;
}
function notify(){
 // Otros módulos no pueden impedir que se visualice Caja.
 try{
  window.dispatchEvent(new CustomEvent("tsys:caja",{
   detail:{abierta:admin&&snapshot?.estado==="abierta",turno_id:snapshot?.turno_id||null}
  }));
 }catch(error){console.warn("Aviso de Caja a otros módulos",error)}
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
 const state=(text)=>status("caja-estado-mensaje",text);
 try{
  // El resumen principal debe funcionar aunque falle el historial o los detalles.
  const [r,turnos]=await Promise.all([
   db.rpc("resumen_turno_caja_tsysoptics"),
   db.from("turnos_caja_tsysoptics")
    .select("id,estado,abierta_en,cerrada_en,fondo_inicial,efectivo_esperado,efectivo_contado,diferencia")
    .order("abierta_en",{ascending:false}).limit(12)
  ]);
  if(!admin||mine!==requestGeneration)return;
  if(r.error){
   console.warn("Caja: consulta del resumen",r.error.code||"RPC",r.error.message);
   snapshot=null;stateKnown=false;setControls();notify();
   state("Caja no pudo consultar los valores del turno. Pulsa Actualizar. (Consulta C1)");
   return;
  }
  snapshot=Array.isArray(r.data)&&r.data.length?r.data[0]:null;
  stateKnown=true;
  setControls();
  try{
   renderSummary();
  }catch(error){
   // Un fallo al pintar indicadores no debe bloquear movimientos ni el cierre
   // si Supabase ya confirmó el estado del turno.
   console.error("Caja: fallo al presentar el resumen",error);
   state(snapshot?.estado==="abierta"
    ?"Caja ABIERTA. Hubo un problema al mostrar indicadores, pero el turno está verificado. Puedes usar Movimientos y Cierre. (Vista C2)"
    :"No se pudieron mostrar algunos indicadores. El estado del turno sí fue verificado. (Vista C2)");
   setControls();
   notify();
  }

  // Fallar al mostrar el historial NO debe borrar ni inutilizar el turno válido.
  const turnoRows=$("caja-turnos");
  try{
   if(!turnos.error){
    const fragment=document.createDocumentFragment();
    if(!(turnos.data||[]).length)fragment.append(el("p","Todavía no hay turnos registrados.","muted"));
    for(const t of turnos.data||[]){
     const li=el("div",undefined,"item"),info=el("div");
     info.append(el("strong",(t.estado==="abierta"?"Abierta":"Cerrada")+" · "+date(t.abierta_en)));
     info.append(el("small","Fondo: "+money(t.fondo_inicial)+
      (t.estado==="cerrada"?" · Efectivo: "+money(t.efectivo_contado)+" · Diferencia: "+money(t.diferencia):"")));
     li.append(info);fragment.append(li);
    }
    turnoRows?.replaceChildren(fragment);
   }else{
    console.warn("Caja: historial",turnos.error.code||"QUERY");
    turnoRows?.replaceChildren(el("p","No se pudo cargar el historial. El resumen del turno sigue disponible.","muted"));
   }
  }catch(error){
   console.warn("Caja: presentación del historial",error);
   turnoRows?.replaceChildren(el("p","Historial temporalmente no disponible.","muted"));
  }

  const moves=$("caja-movimientos");
  if(!moves)return;
  try{
   if(snapshot?.turno_id){
    const result=await db.from("movimientos_caja_tsysoptics")
     .select("id,tipo,monto,motivo,fecha").eq("turno_id",snapshot.turno_id)
     .order("fecha",{ascending:false}).limit(40);
    if(!admin||mine!==requestGeneration)return;
    if(result.error){
     console.warn("Caja: movimientos",result.error.code||"QUERY");
     moves.replaceChildren(el("p","No se pudieron consultar los movimientos manuales.","muted"));
    }else{
     const fragment=document.createDocumentFragment();
     if(!result.data?.length)fragment.append(el("p","No hay movimientos manuales en este turno.","muted"));
     for(const m of result.data||[]){
      const li=el("div",undefined,"item"),info=el("div");
      info.append(el("strong",(m.tipo==="ingreso"?"Ingreso +":"Egreso −")+money(m.monto)));
      info.append(el("small",m.motivo+" · "+date(m.fecha)));
      li.append(info);fragment.append(li);
     }
     moves.replaceChildren(fragment);
    }
   }else moves.replaceChildren(el("p","Sin movimientos todavía.","muted"));
  }catch(error){
   console.warn("Caja: presentación de movimientos",error);
   moves.replaceChildren(el("p","Movimientos temporalmente no disponibles.","muted"));
  }
 }catch(error){
  // Únicamente los problemas del resumen hacen que la caja deje de ser operable.
  console.error("Caja: problema de conexión o carga inicial",error);
  snapshot=null;stateKnown=false;setControls();notify();
  state("No se pudo consultar Caja. Revisa la conexión e intenta actualizar. (Consulta C3)");
 }finally{loading=false}
}
async function operation(name,work,statusId,success){
 if(!admin||doing!==null)return;
 doing=name;setControls();status(statusId,"Comprobando permisos y estado de Caja…");
 try{
  if(!(await verify())){
   reset();
   status(statusId,"Tu sesión ya no está autorizada para operar Caja. Inicia sesión nuevamente.");
   return;
  }
  status(statusId,"Procesando…");
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
for(const [buttonId,formId] of [
 ["caja-ir-apertura","caja-abrir-form"],
 ["caja-ir-movimientos","caja-movimiento-form"],
 ["caja-ir-cierre","caja-cierre-form"]
]){
 $(buttonId).addEventListener("click",()=>{
  $(formId).scrollIntoView({behavior:"smooth",block:"start"});
  if(!stateKnown)void refresh();
 });
}
document.querySelectorAll('[data-page="caja"],[data-go="caja"]').forEach(button=>{
 button.addEventListener("click",()=>{if(admin&&!loading&&doing===null)void refresh();});
});

$("caja-abrir-form").addEventListener("submit",async e=>{
 e.preventDefault();
 if(!admin){status("caja-abrir-status","Tu cuenta no tiene autorización para abrir Caja.");return;}
 if(!stateKnown||snapshot?.estado==="abierta"){status("caja-abrir-status","Ya hay un turno abierto o todavía no se pudo verificar el estado. Actualiza Caja.");return;}
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
 e.preventDefault();if(!admin||!stateKnown||snapshot?.estado!=="abierta"){status("caja-movimiento-status","No se puede registrar: primero verifica que el turno esté abierto.");return;}
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
 e.preventDefault();if(!admin||!stateKnown||snapshot?.estado!=="abierta"){status("caja-cierre-status","No se puede cerrar: verifica primero el turno abierto.");return;}
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
 snapshot=null;doing=null;stateKnown=false;
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
window.addEventListener("tsys:ventas-actualizadas",()=>{if(admin&&!loading)void refresh();});
if($("tsys-app")?.dataset.role==="administrador")void activate();
