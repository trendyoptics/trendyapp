import {createClient} from "https://esm.sh/@supabase/supabase-js@2";
import {SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY} from "./supabase-config.js";
const db=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{flowType:"pkce",persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const $=id=>document.getElementById(id);
const COP=x=>new Intl.NumberFormat("es-CO",{style:"currency",currency:"COP",maximumFractionDigits:0}).format(Number(x)||0);
const today=()=>new Intl.DateTimeFormat("sv-SE",{timeZone:"America/Bogota",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const date=x=>x?new Date(x).toLocaleDateString("es-CO",{timeZone:"America/Bogota"}):"";
const html=(tag,text,cls)=>{const n=document.createElement(tag);n.textContent=String(text??"");if(cls)n.className=cls;return n};
const status=(id,t)=>{$(id).textContent=t};
let allowed=false,seq=0,busy=false,patients=[],sales=[],orders=[],notes=[];
const active=new Set(["pendiente","en_proceso"]);
const named={pendiente:"Pendiente",en_proceso:"En proceso",resuelto:"Resuelto",cancelado:"Cancelado"};
async function auth(){
 const {data,error}=await db.auth.getUser();if(error||!data?.user)return false;
 const {data:role,error:re}=await db.from("usuarios_tsysoptics").select("rol,activo").eq("id",data.user.id).maybeSingle();
 return !re&&role?.activo===true&&role.rol==="administrador";
}
function disable(value){
 for(const id of ["posventa-guardar","posventa-refrescar"]){$(id).disabled=value}
}
function logout(){
 allowed=false;seq++;patients=[];sales=[];orders=[];notes=[];disable(true);
 for(const id of ["posventa-lista","posventa-historial","posventa-entregas"]){$(id).replaceChildren()}
 status("posventa-status","Acceso reservado al administrador.");
}
function selectOptions(id,values,placeholder){
 const n=$(id),prior=n.value;n.replaceChildren(new Option(placeholder,""));
 for(const [value,label] of values)n.add(new Option(label,value));
 if(values.some(v=>v[0]===prior))n.value=prior;
}
function patientName(id){return patients.find(p=>p.id===id)?.nombre_completo||"Paciente no disponible"}
function salePatient(s){return s.paciente_id||null}
function saleLabel(s){return "V-"+String(s.numero).padStart(6,"0")+" · "+COP(s.total)+" · "+date(s.fecha)}
function renderRelations(){
 const id=$("posventa-paciente").value;
 const related=sales.filter(s=>s.paciente_id===id&&s.estado==="emitida");
 selectOptions("posventa-venta",related.map(s=>[s.id,saleLabel(s)]),"Sin venta asociada");
 const sale=$("posventa-venta").value;
 const relatedOrders=orders.filter(o=>related.some(s=>s.id===o.venta_id)&&(!sale||o.venta_id===sale));
 selectOptions("posventa-orden",relatedOrders.map(o=>[o.id,"Orden · "+o.laboratorio+" · "+(named[o.estado]||o.estado)+" · "+o.fecha_entrega_estimada]),"Sin orden asociada");
}
function whatsapp(patient,msg){
 const number=String(patient?.telefono||"").replace(/\D/g,"");
 if(number.length<7||number.length>15){status("posventa-status","Este paciente no tiene un teléfono válido registrado.");return}
 const phone=number.length===10?"57"+number:number;
 if(!window.confirm("¿Abrir WhatsApp con un mensaje dirigido a "+patient.nombre_completo+"? Verifica el número y el destinatario. El envío NO es automático."))return;
 const url="https://wa.me/"+phone+"?text="+encodeURIComponent(msg);
 window.open(url,"_blank","noopener,noreferrer");
}
function contactButton(patient,kind,context){
 const b=html("button","WhatsApp","btn alt");b.type="button";
 b.addEventListener("click",()=>{
  const message=kind==="entrega"
   ?"Hola, "+patient.nombre_completo+". Te contactamos desde la óptica para informarte que tu pedido está listo para recoger. Por favor confirma cuándo puedes acercarte."
   :"Hola, "+patient.nombre_completo+". Te escribimos desde la óptica para hacer seguimiento a tu "+(context||"control visual")+". Puedes respondernos para coordinar la atención.";
  whatsapp(patient,message);
 });
 return b;
}
function renderOverview(){
 const pending=notes.filter(x=>active.has(x.estado));
 const due=pending.filter(x=>x.fecha_programada&&x.fecha_programada<=today());
 const ready=orders.filter(o=>o.estado==="listo_para_entrega");
 const late=orders.filter(o=>!["entregado","cancelado"].includes(o.estado)&&o.fecha_entrega_estimada<today());
 const counts=[["Pendientes posventa",pending.length],["Seguimientos vencidos/hoy",due.length],["Listos para recoger",ready.length],["Laboratorio retrasado",late.length]];
 const root=$("posventa-resumen");root.replaceChildren();
 for(const [label,value] of counts){const card=html("div","","tile");card.append(html("span",label),html("strong",value));root.append(card)}
 const deliveries=$("posventa-entregas");deliveries.replaceChildren();
 if(!ready.length)deliveries.append(html("p","No hay pedidos listos para recoger.","muted"));
 for(const o of ready){
  const sale=sales.find(s=>s.id===o.venta_id);
  const patient=patients.find(p=>p.id===sale?.paciente_id);
  const row=html("div","","item posventa-item"),info=html("div",""),actions=html("div","","posventa-actions");
  info.append(html("strong",patient?.nombre_completo||"Venta "+(sale?.numero||"sin paciente")));
  info.append(html("small","Venta "+(sale?.numero||"—")+" · "+o.laboratorio+" · Entrega estimada "+o.fecha_entrega_estimada));
  if(patient)actions.append(contactButton(patient,"entrega"));
  const add=html("button","Crear seguimiento","btn alt");add.type="button";
  add.addEventListener("click",()=>{if(patient){$("posventa-paciente").value=patient.id;renderRelations();$("posventa-venta").value=sale?.id||"";renderRelations();$("posventa-orden").value=o.id;$("posventa-tipo").value="recordatorio";$("posventa-descripcion").value="Contactar al paciente para recoger el pedido listo.";$("posventa-form").scrollIntoView({behavior:"smooth",block:"start"})}});
  if(patient)actions.append(add);
  row.append(info,actions);deliveries.append(row);
 }
 const container=$("posventa-lista");container.replaceChildren();
 const filter=$("posventa-filtro").value;
 const visible=notes.filter(n=>!filter||n.estado===filter).sort((a,b)=>(a.fecha_programada||"9999").localeCompare(b.fecha_programada||"9999"));
 if(!visible.length)container.append(html("p","No existen seguimientos para ese filtro.","muted"));
 for(const n of visible){
  const patient=patients.find(x=>x.id===n.paciente_id),row=html("div","","item posventa-item");
  const info=html("div",""),actions=html("div","","posventa-actions");
  info.append(html("strong",(patient?.nombre_completo||"Paciente")+" · "+n.tipo.toUpperCase("es-CO")));
  info.append(html("small",(named[n.estado]||n.estado)+" · "+(n.fecha_programada?"Programado "+n.fecha_programada:"Sin fecha programada")));
  info.append(html("p",n.descripcion,"muted"));
  if(n.solucion)info.append(html("small","Solución: "+n.solucion));
  if(active.has(n.estado)){
   const progress=html("button","En proceso","btn alt"),resolve=html("button","Resolver","btn");
   progress.type="button";resolve.type="button";progress.disabled=n.estado==="en_proceso";
   progress.addEventListener("click",()=>void update(n,"en_proceso",null,progress));
   resolve.addEventListener("click",()=>{
    const solution=window.prompt("Describe la solución o atención realizada (obligatorio):");
    if(solution===null)return;
    if(solution.trim().length<3){status("posventa-status","Escribe una solución de al menos tres caracteres.");return}
    void update(n,"resuelto",solution.trim(),resolve);
   });
   actions.append(progress,resolve);
  }
  if(patient)actions.append(contactButton(patient,"seguimiento",n.tipo));
  row.append(info,actions);container.append(row);
 }
}
function renderHistory(){
 const patientId=$("posventa-consulta-paciente").value;
 const root=$("posventa-historial");root.replaceChildren();
 if(!patientId){root.append(html("p","Selecciona un paciente para ver sus compras y seguimientos.","muted"));return}
 const patient=patients.find(p=>p.id===patientId);
 const salesPatient=sales.filter(s=>s.paciente_id===patientId);
 const notesPatient=notes.filter(n=>n.paciente_id===patientId);
 root.append(html("h3",patient?.nombre_completo||"Paciente"));
 if(!salesPatient.length&&!notesPatient.length)root.append(html("p","No hay ventas ni seguimientos en los registros consultados.","muted"));
 for(const v of salesPatient){
  const row=html("div","","item posventa-item"),group=html("div","");
  group.append(html("strong",saleLabel(v)));
  group.append(html("small","Estado "+v.estado+" · Abonado "+COP(v.abonado)+" · Saldo "+COP(v.saldo)));
  const labs=orders.filter(o=>o.venta_id===v.id);
  for(const o of labs){
   group.append(html("small","Laboratorio "+o.laboratorio+" · "+(named[o.estado]||o.estado)));
   if(o.fecha_entrega_estimada)group.append(html("small","Entrega prevista: "+date(o.fecha_entrega_estimada)));
   if(o.estado==="entregado"&&o.fecha_entrega_paciente)group.append(html("small","Entregado al paciente: "+date(o.fecha_entrega_paciente)));
  }
  row.append(group);root.append(row);
 }
 for(const n of notesPatient){
  const row=html("div","","item posventa-item"),group=html("div","");
  group.append(html("strong",n.tipo+" · "+(named[n.estado]||n.estado)));
  group.append(html("small",date(n.creado_en)+" · "+n.descripcion));
  if(n.solucion)group.append(html("small","Resultado: "+n.solucion));
  row.append(group);root.append(row);
 }
}
async function load(){
 if(!allowed)return;
 const token=++seq;status("posventa-status","Consultando pacientes, ventas, laboratorio y seguimientos…");
 try{
  const [p,s,o,n]=await Promise.all([
   db.from("pacientes_tsysoptics").select("id,nombre_completo,tipo_documento,documento,telefono").order("nombre_completo").limit(2000),
   db.from("ventas_tsysoptics").select("id,numero,paciente_id,total,abonado,saldo,fecha,estado").order("fecha",{ascending:false}).limit(2000),
   db.from("ordenes_laboratorio_tsysoptics").select("id,venta_id,laboratorio,estado,fecha_entrega_estimada,fecha_entrega_paciente").order("creado_en",{ascending:false}).limit(2000),
   db.from("seguimientos_posventa_tsysoptics").select("id,paciente_id,venta_id,orden_id,tipo,estado,descripcion,solucion,fecha_programada,fecha_resolucion,creado_en").order("creado_en",{ascending:false}).limit(2000)
  ]);
  if(p.error||s.error||o.error||n.error)throw Error([p.error,s.error,o.error,n.error].filter(Boolean).map(x=>x.message).join("; "));
  if(token!==seq||!allowed)return;
  patients=p.data||[];sales=s.data||[];orders=o.data||[];notes=n.data||[];
  const previous=$("posventa-paciente").value,history=$("posventa-consulta-paciente").value;
  const values=patients.map(x=>[x.id,x.nombre_completo+" · "+x.documento]);
  selectOptions("posventa-paciente",values,"Seleccionar paciente");
  selectOptions("posventa-consulta-paciente",values,"Consultar paciente");
  if(patients.some(p=>p.id===previous))$("posventa-paciente").value=previous;
  if(patients.some(p=>p.id===history))$("posventa-consulta-paciente").value=history;
  renderRelations();renderOverview();renderHistory();
  status("posventa-status","Datos actualizados. "+notes.length+" seguimiento(s) consultados.");
 }catch(e){status("posventa-status","Error al consultar posventa: "+(e?.message||e))}
}
async function update(n,state,solution,button){
 if(busy||!allowed)return;
 busy=true;button.disabled=true;
 try{
  if(!(await auth())){logout();return}
  const changes={estado:state};
  if(state==="resuelto")changes.solucion=solution;
  const {error}=await db.from("seguimientos_posventa_tsysoptics").update(changes).eq("id",n.id);
  if(error)throw Error(error.message);
  await load();status("posventa-status","Seguimiento actualizado correctamente.");
 }catch(e){status("posventa-status","No se actualizó: "+(e?.message||e))}
 finally{busy=false;button.disabled=false}
}
async function save(event){
 event.preventDefault();if(busy||!allowed)return;
 const patientId=$("posventa-paciente").value;
 if(!patientId){status("posventa-form-estado","Selecciona un paciente.");return}
 const payload={paciente_id:patientId,venta_id:$("posventa-venta").value||null,orden_id:$("posventa-orden").value||null,
  tipo:$("posventa-tipo").value,descripcion:$("posventa-descripcion").value.trim(),fecha_programada:$("posventa-fecha").value||null};
 if(payload.descripcion.length<3){status("posventa-form-estado","Describe el motivo en al menos tres caracteres.");return}
 busy=true;$("posventa-guardar").disabled=true;
 try{
  if(!(await auth())){logout();return}
  const {error}=await db.from("seguimientos_posventa_tsysoptics").insert(payload);
  if(error)throw Error(error.message);
  $("posventa-form").reset();renderRelations();
  status("posventa-form-estado","Seguimiento guardado correctamente.");
  await load();
 }catch(e){status("posventa-form-estado","No se pudo guardar: "+(e?.message||e))}
 finally{busy=false;$("posventa-guardar").disabled=!allowed}
}
$("posventa-paciente").addEventListener("change",renderRelations);
$("posventa-venta").addEventListener("change",renderRelations);
$("posventa-consulta-paciente").addEventListener("change",renderHistory);
$("posventa-filtro").addEventListener("change",renderOverview);
$("posventa-refrescar").addEventListener("click",()=>void load());
window.addEventListener("tsys:laboratorio-actualizado",()=>{if(allowed)void load();});
// La navegación SPA conserva el módulo montado; al regresar, consultar de nuevo
// para reflejar también cambios de Laboratorio realizados en otra sesión.
document.addEventListener("click",event=>{
 const button=event.target.closest('[data-page="posventa"]');
 if(!button)return;
 queueMicrotask(()=>{if(allowed&&document.getElementById("posventa")?.classList.contains("active"))void load();});
});
document.addEventListener("visibilitychange",()=>{if(!document.hidden&&allowed&&document.getElementById("posventa")?.classList.contains("active"))void load();});
$("posventa-form").addEventListener("submit",e=>void save(e));
window.addEventListener("tsys:locked",logout);
window.addEventListener("tsys:role",async e=>{const ok=e.detail?.role==="administrador"&&await auth();allowed=ok;disable(!ok);if(ok)void load();else logout()});
logout();
if($("tsys-app")?.dataset.role==="administrador")void auth().then(ok=>{allowed=ok;disable(!ok);if(ok)void load()});
