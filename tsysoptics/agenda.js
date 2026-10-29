import {createClient} from "https://esm.sh/@supabase/supabase-js@2";
import {SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY} from "./supabase-config.js";

// Agenda administrativa de TsysOptics. Los datos reales NO se almacenan
// en el navegador; únicamente se leen/escriben a través de Supabase con RLS.
const sb=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{
  auth:{flowType:"pkce",persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
});
const $=id=>document.getElementById(id);
const form=$("form-cita");
const list=$("lista-citas");
const saveButton=$("agenda-submit");
const patientSelect=$("agenda-paciente");
const STATE_LABELS={
 programada:"Programada",confirmada:"Confirmada",
 atendida:"Atendida",cancelada:"Cancelada",no_asistio:"No asistió"
};
let adminReady=false;
let initializing=false;
let saving=false;
let lastRequests=0;

function status(id,message){$(id).textContent=message}
function textNode(tag,content,cssClass){
 const node=document.createElement(tag);
 if(cssClass)node.className=cssClass;
 node.textContent=content;
 return node;
}
function resetAdministrativeView(){
 adminReady=false;
 initializing=false;
 lastRequests++;
 status("agenda-save-status","");
 status("agenda-list-status","");
 $("agenda-filtro-fecha").value="";
 $("agenda-filtro-estado").value="";
 patientSelect.replaceChildren(new Option("Sin paciente registrado",""));
}
function showError(error,action){
 if(error?.code==="23505")return "Ese horario ya tiene una cita activa. Selecciona otra hora.";
 return action==="guardar"
  ?"No se pudo guardar la cita. Revisa los datos, la conexión y los permisos."
  :"No se pudo actualizar la agenda. Comprueba la conexión y los permisos.";
}

async function verifyAdmin(){
 const {data,error}=await sb.auth.getUser();
 if(error||!data?.user)return false;
 const {data:profile,error:profileError}=await sb.from("usuarios_tsysoptics")
   .select("rol,activo").eq("id",data.user.id).maybeSingle();
 return !profileError&&profile?.activo===true&&profile?.rol==="administrador";
}
async function loadPatients(){
 const selected=patientSelect.value;
 const {data,error}=await sb.from("pacientes_tsysoptics")
  .select("id,nombre_completo,tipo_documento,documento")
  .order("nombre_completo",{ascending:true}).limit(300);
 if(error){
  status("agenda-save-status","No se pudo consultar el listado de pacientes.");
  return;
 }
 patientSelect.replaceChildren(new Option("Sin paciente registrado",""));
 for(const p of data||[]){
  const option=new Option(p.nombre_completo+" · "+p.tipo_documento+" "+p.documento,p.id);
  option.dataset.name=p.nombre_completo;
  patientSelect.append(option);
 }
 if(Array.from(patientSelect.options).some(o=>o.value===selected))patientSelect.value=selected;
}
patientSelect.addEventListener("change",()=>{
 if(!adminReady)return;
 const selected=patientSelect.options[patientSelect.selectedIndex];
 if(selected?.value && selected.dataset.name)form.elements.referencia.value=selected.dataset.name;
});
async function loadCitas(){
 if(!adminReady)return;
 const generation=++lastRequests;
 status("agenda-list-status","Consultando citas…");
 let query=sb.from("citas_tsysoptics")
  .select("id,paciente_id,referencia,fecha,hora,tipo,estado,paciente:pacientes_tsysoptics(nombre_completo)",{count:"exact"})
  .order("fecha",{ascending:true}).order("hora",{ascending:true}).limit(150);
 if($("agenda-filtro-fecha").value) query=query.eq("fecha",$("agenda-filtro-fecha").value);
 if($("agenda-filtro-estado").value) query=query.eq("estado",$("agenda-filtro-estado").value);
 const [rows,totals]=await Promise.all([
  query,
  sb.from("citas_tsysoptics").select("id",{count:"exact",head:true})
 ]);
 if(!adminReady||generation!==lastRequests)return;
 if(rows.error || totals.error){
  status("agenda-list-status","No se pudo consultar la agenda. Comprueba la conexión y los permisos.");
  return;
 }
 if(typeof window.tsysAgendaSetCount==="function")window.tsysAgendaSetCount(totals.count||0);
 list.replaceChildren();
 const items=rows.data||[];
 status("agenda-list-status",items.length+" citas mostradas"+(items.length===150?" (límite de 150; usa los filtros para buscar otras fechas)":"")+".");
 if(!items.length){list.append(textNode("p","Sin citas para los filtros seleccionados."));return}
 for(const item of items){
  const row=textNode("div","","item");
  const info=document.createElement("div");
  info.append(
    textNode("strong",item.referencia),
    textNode("small",item.fecha+" · "+String(item.hora).slice(0,5)+" · "+item.tipo+" · "+(STATE_LABELS[item.estado]||item.estado)),
  );
  if(item.paciente?.nombre_completo){
    info.append(textNode("small","Paciente asociado: "+item.paciente.nombre_completo));
  }
  row.append(info);
  const actions=document.createElement("div");
  actions.className="agenda-actions";
  const choices=item.estado==="programada"
   ? [["confirmada","Confirmar"],["atendida","Atendida"],["cancelada","Cancelar"]]
   : item.estado==="confirmada"
   ? [["atendida","Atendida"],["cancelada","Cancelar"],["no_asistio","No asistió"]]
   : [];
  for(const [state,label] of choices){
   const button=textNode("button",label);
   button.type="button";
   button.className=state==="cancelada"?"agenda-action-cancel":"agenda-action";
   button.addEventListener("click",()=>changeState(item.id,state,button));
   actions.append(button);
  }
  row.append(actions);
  list.append(row);
 }
}
async function changeState(id,newState,button){
 if(!adminReady)return;
 if(["cancelada","no_asistio"].includes(newState)){
  if(!window.confirm("¿Confirmas cambiar el estado de esta cita?"))return;
 }
 button.disabled=true;
 try{
  const {data,error}=await sb.from("citas_tsysoptics")
   .update({estado:newState}).eq("id",id).select("id").maybeSingle();
  if(error||!data){
   status("agenda-list-status",showError(error,"actualizar"));
   return;
  }
  await loadCitas();
 }catch{
  status("agenda-list-status","No se pudo actualizar la cita. Revisa la conexión.");
 }finally{button.disabled=false}
}

form.addEventListener("submit",async event=>{
 if(!adminReady)return; // El panel conserva una demo local para otros perfiles.
 event.preventDefault();
 if(saving)return;
 const values=new FormData(form);
 const referencia=String(values.get("referencia")||"").trim();
 const fecha=String(values.get("fecha")||"");
 const hora=String(values.get("hora")||"");
 const tipo=String(values.get("tipo")||"");
 const paciente=String(values.get("paciente_id")||"");
 if(referencia.length<2||referencia.length>100||!/\d{4}-\d{2}-\d{2}/.test(fecha)||!/\d{2}:\d{2}/.test(hora)){
  status("agenda-save-status","Completa el nombre o referencia, fecha y hora.");
  return;
 }
 saving=true;saveButton.disabled=true;
 status("agenda-save-status","Guardando cita…");
 try{
  const {error}=await sb.from("citas_tsysoptics").insert({
   referencia,fecha,hora,tipo,estado:"programada",
   paciente_id:paciente||null
  });
  if(error){status("agenda-save-status",showError(error,"guardar"));return}
  form.reset();
  status("agenda-save-status","Cita guardada correctamente en Supabase.");
  await loadCitas();
 }catch{
  status("agenda-save-status","No se pudo guardar la cita. Revisa la conexión.");
 }finally{saving=false;saveButton.disabled=false}
});
$("agenda-refresh").addEventListener("click",loadCitas);
$("agenda-filtro-fecha").addEventListener("change",loadCitas);
$("agenda-filtro-estado").addEventListener("change",loadCitas);

async function activate(){
 if(adminReady||initializing)return;
 initializing=true;
 try{
  if(!(await verifyAdmin())){
   status("agenda-list-status","La agenda centralizada requiere permiso de administrador.");
   return;
  }
  adminReady=true;
  await Promise.all([loadPatients(),loadCitas()]);
 }catch{
  status("agenda-list-status","No fue posible iniciar el módulo de agenda.");
 }finally{initializing=false}
}
window.addEventListener("tsys:role",event=>{
 if(event.detail?.role==="administrador")void activate();
 else resetAdministrativeView();
});
window.addEventListener("tsys:locked",resetAdministrativeView);
if($("tsys-app")?.dataset.role==="administrador")void activate();
