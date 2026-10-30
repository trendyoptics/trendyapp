
import {createClient} from "https://esm.sh/@supabase/supabase-js@2";
import {SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY} from "./supabase-config.js";
const sb=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{flowType:"pkce",persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const $=id=>document.getElementById(id);
const status=t=>{$("status").textContent=t;};
const form=$("patient-form"), save=$("save");
let selectedId=null,busy=false,dirty=false,historyRequest=0,searchRequest=0,authorized=false;
function resetForm(){
 form.reset();selectedId=null;dirty=false;historyRequest++;
 $("history-link").hidden=true;
 $("patient-profile").hidden=true;
 $("patient-history-list").replaceChildren();
 form.elements.tipo_documento.disabled=false;form.elements.documento.disabled=false;
 $("form-title").textContent="Nuevo paciente";
 save.textContent="Guardar paciente";$("cancel").hidden=true;
 document.querySelectorAll("#patient-tabs [data-view=ficha]").forEach(b=>b.disabled=true);
 document.querySelectorAll("#results .item").forEach(b=>b.classList.remove("is-current"));
}
function rowField(key){return String(form.elements[key].value||"").trim();}
function item(text,cls){const n=document.createElement("span");n.textContent=text;if(cls)n.className=cls;return n}

const mobile=window.matchMedia("(max-width: 820px)");
const navButtons=[...document.querySelectorAll("#patient-tabs [data-view]")];
function showPatientView(view,scroll=false){
 const name=view==="ficha"&&!selectedId?"buscar":view;
 if(!["buscar","registrar","ficha"].includes(name))return;
 $("panel").dataset.patientView=name;
 for(const button of navButtons){
  const active=button.dataset.view===name;
  button.classList.toggle("is-active",active);
  button.setAttribute("aria-selected",String(active));
  button.tabIndex=active?0:-1;
 }
 if(scroll&&mobile.matches){
  $("patient-tabs").scrollIntoView({behavior:"smooth",block:"start"});
 }
}
for(const button of navButtons){
 button.addEventListener("click",()=>{
  if(button.dataset.view==="registrar"&&selectedId){
   if(dirty&&!window.confirm("Hay cambios sin guardar. ¿Quieres iniciar otro registro?"))return;
   resetForm();
  }
  showPatientView(button.dataset.view);
 });
}
$("patient-tabs").addEventListener("keydown",event=>{
 if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;
 const available=navButtons.filter(b=>!b.disabled);
 const index=available.findIndex(b=>b.dataset.view===$("panel").dataset.patientView);
 const next=event.key==="Home"?0:event.key==="End"?available.length-1:
  (index+(event.key==="ArrowLeft"?available.length-1:1))%available.length;
 const target=available[next];
 if(target.dataset.view==="registrar"&&selectedId){
  if(dirty&&!window.confirm("Hay cambios sin guardar. ¿Quieres iniciar otro registro?"))return;
  resetForm();
 }
 showPatientView(target.dataset.view);
 target.focus();
 event.preventDefault();
});
showPatientView("buscar");
function formatDate(value){
 if(!value)return "Sin registrar";
 const d=new Date(value);
 return Number.isNaN(d.getTime())?"Sin registrar":
  new Intl.DateTimeFormat("es-CO",{dateStyle:"medium",timeZone:"America/Bogota"}).format(d);
}
function setText(id,value){
 $(id).textContent=String(value||"Sin registrar");
}
async function loadPatientHistories(patientId,offset=0){
 const generation=++historyRequest;
 $("patient-history-status").textContent="Consultando fechas de atención…";
 const place=$("patient-history-list");
 if(offset===0)place.replaceChildren();
 else place.querySelector(".patient-history-more")?.remove();
 try{
  const {data,error,count}=await sb.from("historias_clinicas_tsysoptics")
   .select("id,fecha_consulta,estado,optometra_nombre",{count:"exact"})
   .eq("paciente_id",patientId)
   .order("fecha_consulta",{ascending:false})
   .range(offset,offset+24);
  if(!authorized||selectedId!==patientId||generation!==historyRequest)return;
  if(error){
   $("patient-history-status").textContent="No fue posible consultar las historias clínicas. Revisa los permisos.";
   return;
  }
  const rows=data||[];
  const total=count==null?rows.length:count;
  $("patient-history-status").textContent=total
   ?total+" consulta(s) registradas. Mostrando "+Math.min(offset+rows.length,total)+" de "+total+"."
   :"Todavía no hay historias clínicas asociadas a este paciente.";
  for(const row of rows){
   const div=document.createElement("div");div.className="patient-history-entry";
   const date=document.createElement("strong");
   date.textContent="Consulta: "+formatDate(row.fecha_consulta);
   const state=document.createElement("span");
   state.className="patient-history-state"+(row.estado==="finalizada"?" finalizada":"");
   state.textContent=row.estado==="finalizada"?"Finalizada":row.estado==="borrador"?"Borrador":String(row.estado||"Sin estado");
   const professional=document.createElement("small");
   professional.textContent="Profesional: "+(row.optometra_nombre||"No registrado");
   const open=document.createElement("a");
   open.className="patient-link-clinical";
   open.target="_blank";open.rel="noopener noreferrer";
   open.textContent="Ver consulta";
   open.href="../index.html?paciente="+encodeURIComponent(patientId)+"&historia="+encodeURIComponent(row.id);
   open.setAttribute("aria-label","Ver consulta del "+formatDate(row.fecha_consulta));
   div.append(date,state,professional,open);place.append(div);
  }
  if(offset+rows.length<total){
   const more=document.createElement("button");
   more.type="button";more.className="patient-history-more";
   more.textContent="Cargar 25 consultas más";
   more.addEventListener("click",()=>loadPatientHistories(patientId,offset+rows.length));
   place.append(more);
  }
 }catch{
  if(generation===historyRequest&&selectedId===patientId)
   $("patient-history-status").textContent="No se pudo consultar el historial en este momento.";
 }
}
function choosePatient(p){
 if(dirty&&!window.confirm("Hay cambios sin guardar en el formulario. ¿Quieres descartarlos?"))return;
 selectedId=p.id;dirty=false;
 for(const key of ["nombre_completo","fecha_nacimiento","telefono","direccion","eps"])
  form.elements[key].value=p[key]||"";
 form.elements.tipo_documento.value=p.tipo_documento;
 form.elements.documento.value=p.documento;
 form.elements.tipo_documento.disabled=true;form.elements.documento.disabled=true;
 $("form-title").textContent="Editar paciente";
 save.textContent="Guardar cambios";$("cancel").hidden=false;
 const href="../index.html?paciente="+encodeURIComponent(p.id);
 $("history-link").href=href;$("history-link").hidden=false;
 $("profile-clinical").href=href;
 $("profile-new-clinical").href=href+"&nueva=1";
 setText("patient-profile-name",p.nombre_completo);
 setText("patient-profile-document",p.tipo_documento+" · "+p.documento);
 setText("profile-phone",p.telefono);
 setText("profile-birth",p.fecha_nacimiento?formatDate(p.fecha_nacimiento+"T12:00:00-05:00"):null);
 setText("profile-eps",p.eps);
 setText("profile-address",p.direccion);
 $("patient-profile").hidden=false;
 document.querySelectorAll("#patient-tabs [data-view=ficha]").forEach(b=>b.disabled=false);
 document.querySelectorAll("#results .item").forEach(b=>b.classList.toggle("is-current",b.dataset.patientId===p.id));
 showPatientView("ficha",true);
 if(!mobile.matches)$("patient-profile").scrollIntoView({behavior:"smooth",block:"nearest"});
 void loadPatientHistories(p.id);
}
$("profile-edit").addEventListener("click",()=>{
 showPatientView("registrar",true);
 if(!mobile.matches)form.scrollIntoView({behavior:"smooth",block:"start"});
 form.elements.nombre_completo.focus();
});
$("profile-back").addEventListener("click",()=>showPatientView("buscar",true));
$("profile-new").addEventListener("click",()=>{
 resetForm();showPatientView("registrar",true);
 form.elements.documento.focus();
});
form.addEventListener("input",()=>{dirty=true});

async function requireAdmin(){
 const {data,error}=await sb.auth.getUser();if(error||!data?.user)return false;
 const {data:profile,error:pError}=await sb.from("usuarios_tsysoptics").select("rol,activo").eq("id",data.user.id).maybeSingle();
 return !pError && profile?.activo===true && profile?.rol==="administrador";
}
function showDenied(text){
 authorized=false;searchRequest++;historyRequest++;
 $("results").replaceChildren();$("patient-history-list").replaceChildren();
 $("patient-profile").hidden=true;
 $("loading").textContent=text;$("loading").hidden=false;$("panel").hidden=true
}
async function searchPatients(){
 if(busy||!authorized)return;
 const request=++searchRequest;
 const query=$("search").value.trim();
 if(query.length>70){status("La búsqueda es demasiado larga.");return;}
 status("Buscando pacientes…");
 const projection="id,tipo_documento,documento,nombre_completo,fecha_nacimiento,telefono,direccion,eps,creado_en";
 const current=()=>request===searchRequest&&authorized;
 try{
  let rows=[];
  if(query){
   const needle="%"+query.replaceAll("%","\\%").replaceAll("_","\\_")+"%";
   const [a,b]=await Promise.all([
    sb.from("pacientes_tsysoptics").select(projection)
     .ilike("documento",needle).order("creado_en",{ascending:false}).limit(30),
    sb.from("pacientes_tsysoptics").select(projection)
     .ilike("nombre_completo",needle).order("creado_en",{ascending:false}).limit(30)
   ]);
   if(!current())return;
   if(a.error||b.error){status("No se pudo consultar. Revisa la conexión y los permisos.");return;}
   rows=[...new Map([...(a.data||[]),...(b.data||[])].map(x=>[x.id,x])).values()];
  }else{
   const {data,error}=await sb.from("pacientes_tsysoptics").select(projection)
    .order("creado_en",{ascending:false}).limit(30);
   if(!current())return;
   if(error){status("No se pudo consultar. Comprueba la conexión y los permisos.");return;}
   rows=data||[];
  }
  if(current())renderPatients(rows,Boolean(query));
 }catch{
  if(current())status("No se pudo buscar pacientes. Revisa la conexión.");
 }
}
function renderPatients(rows,searched){
 const area=$("results");area.replaceChildren();
 status(rows.length+" paciente(s) encontrados. "+
  (searched?"Se muestran hasta 60 coincidencias.":"Se muestran los 30 registros más recientes."));
 if(!rows.length){area.append(item("No hay pacientes para mostrar.","small"));return}
 for(const p of rows){
  const btn=document.createElement("button");
  btn.type="button";btn.className="item";
  btn.dataset.patientId=p.id;
  if(p.id===selectedId)btn.classList.add("is-current");
  const name=document.createElement("b");name.textContent=p.nombre_completo;
  const details=document.createElement("small");
  details.textContent=p.tipo_documento+" · "+p.documento+" · "+(p.telefono||"Sin teléfono");
  btn.append(name,details);
  btn.setAttribute("aria-label","Consultar ficha clínica de "+p.nombre_completo);
  btn.addEventListener("click",()=>choosePatient(p));
  area.append(btn);
 }
}
form.addEventListener("submit",async e=>{
 e.preventDefault();if(busy)return;
 const nombre=rowField("nombre_completo"),tipo=rowField("tipo_documento"),doc=rowField("documento").toUpperCase();
 if(doc.length<3||doc.length>30||!nombre){status("Ingresa un documento válido y el nombre completo del paciente.");return}
 if(nombre.length<3||nombre.length>150){status("El nombre debe tener entre 3 y 150 caracteres.");return}
 const birth=rowField("fecha_nacimiento");
 if(birth){
  const parsed=new Date(birth+"T12:00:00");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(birth)||Number.isNaN(parsed.getTime())||
     parsed.toISOString().slice(0,10)!==birth||birth>new Date().toLocaleDateString("en-CA",{timeZone:"America/Bogota"})){
   status("Verifica la fecha de nacimiento. No puede ser inválida ni futura.");return;
  }
 }
 const data={nombre_completo:nombre,fecha_nacimiento:rowField("fecha_nacimiento")||null,telefono:rowField("telefono")||null,direccion:rowField("direccion")||null,eps:rowField("eps")||null};
 let savedConfirmed=false;
 busy=true;save.disabled=true;status("Guardando…");
 try {
  const result=selectedId
   ? await sb.from("pacientes_tsysoptics").update(data).eq("id",selectedId).select("id,tipo_documento,documento,nombre_completo,fecha_nacimiento,telefono,direccion,eps").single()
   : await sb.from("pacientes_tsysoptics").insert({...data,documento:doc,tipo_documento:tipo}).select("id,tipo_documento,documento,nombre_completo,fecha_nacimiento,telefono,direccion,eps").single();
  if(result.error){status(result.error.code==="23505"?"Ese documento ya está registrado.":"No se pudo guardar. Verifica los datos y permisos.");return;}
  savedConfirmed=true;
  // El registro devuelto por Supabase es el mismo que acaba de guardarse.
  // No se realiza otra escritura ni se repite la operación.
  const saved=result.data;
  resetForm();busy=false;
  choosePatient(saved);
  await searchPatients();
  status("Paciente guardado correctamente. La ficha y la historia clínica están disponibles.");
 }catch{
  status(savedConfirmed
   ?"El paciente se guardó, pero no fue posible actualizar la pantalla. Busca su documento antes de intentar registrarlo de nuevo."
   :"No se pudo confirmar el guardado. Revisa la conexión y busca el documento antes de volver a intentar.");
 }
 finally{busy=false;save.disabled=false}
});
$("cancel").addEventListener("click",()=>{
 resetForm();showPatientView("buscar",true);
});
$("find").addEventListener("click",searchPatients);
$("search").addEventListener("keydown",e=>{
 if(e.key==="Enter"){e.preventDefault();clearTimeout(searchTimer);void searchPatients()}
});
let searchTimer=null;
$("search").addEventListener("input",()=>{
 // Una búsqueda previa no puede sobreescribir el resultado de la entrada nueva.
 searchRequest++;
 clearTimeout(searchTimer);
 searchTimer=setTimeout(()=>{if(authorized&&!busy)void searchPatients()},380);
});
let recoveryBusy=false;
async function restorePatients(){
 if(recoveryBusy)return;
 recoveryBusy=true;
 $("loading").hidden=false;
 $("loading").textContent="Verificando acceso a Pacientes…";
 try{
  // La restauración de sesión puede tardar al volver desde la pantalla clínica.
  let ok=false;
  for(let i=0;i<3;i++){
   try{ok=await requireAdmin()}catch{ok=false}
   if(ok)break;
   if(i<2)await new Promise(resolve=>setTimeout(resolve,350*(i+1)));
  }
  if(!ok){showDenied("No se pudo verificar el acceso a Pacientes. Regresa a Inicio y comprueba la sesión.");return;}
  authorized=true;$("loading").hidden=true;$("panel").hidden=false;
  await searchPatients();
  const requestedId=new URLSearchParams(location.search).get("paciente");
  if(requestedId && /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(requestedId)){
   const {data:p,error}=await sb.from("pacientes_tsysoptics")
    .select("id,tipo_documento,documento,nombre_completo,fecha_nacimiento,telefono,direccion,eps")
    .eq("id",requestedId).maybeSingle();
   if(!error&&p){
    choosePatient(p);
    const url=new URL(location.href);url.searchParams.delete("paciente");url.searchParams.delete("modulo");
    history.replaceState(null,"",url.pathname+url.search+url.hash);
   }else status("No fue posible recuperar la ficha solicitada. Puedes buscarla manualmente.");
  }
 }catch(err){
  if(!authorized)showDenied("No se pudo cargar Pacientes. Comprueba la conexión y vuelve a entrar.");
  console.error("Error al recuperar Pacientes",err);
 }finally{recoveryBusy=false}
}
void restorePatients();
window.addEventListener("tsys:role",e=>{
 if(e.detail?.role!=="administrador"){showDenied("Acceso reservado al administrador.");return;}
 if(!authorized)void restorePatients();
});
window.addEventListener("tsys:locked",()=>showDenied("Sesión cerrada."));
document.addEventListener("visibilitychange",()=>{
 if(!document.hidden&&!authorized)void restorePatients();
});
window.addEventListener("pageshow",()=>{
 if(!authorized)void restorePatients();
 else void searchPatients();
});
