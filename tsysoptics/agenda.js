import {createClient} from "https://esm.sh/@supabase/supabase-js@2";
import {SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY} from "./supabase-config.js";

// Agenda administrativa de TsysOptics. Calendario táctil en desarrollo. Los datos reales NO se almacenan
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
let editingId=null,editingState=null,editingDate=null,editingHour=null;

function bogotaNow(){
 const fields=new Intl.DateTimeFormat("en-GB",{
  timeZone:"America/Bogota",year:"numeric",month:"2-digit",day:"2-digit",
  hour:"2-digit",minute:"2-digit",hourCycle:"h23"
 }).formatToParts(new Date());
 const v=Object.fromEntries(fields.filter(p=>p.type!=="literal").map(p=>[p.type,p.value]));
 return v.year+"-"+v.month+"-"+v.day+"T"+v.hour+":"+v.minute;
}
const todayBogota=()=>bogotaNow().slice(0,10);
function validDate(d){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(d))return false;
 const v=new Date(d+"T00:00:00Z");
 return !Number.isNaN(v.getTime())&&v.toISOString().slice(0,10)===d;
}
function resetEditor(){
 editingId=null;editingState=null;editingDate=null;editingHour=null;
 form.reset();
 $("agenda-form-title").textContent="Nueva cita";
 saveButton.textContent="Guardar cita";
 $("agenda-cancel-edit").hidden=true;
}
function openEditor(item){
 if(!adminReady||!["programada","confirmada"].includes(item.estado))return;
 editingId=item.id;editingState=item.estado;editingDate=item.fecha;editingHour=String(item.hora).slice(0,5);
 form.elements.referencia.value=item.referencia;
 form.elements.fecha.value=item.fecha;
 form.elements.hora.value=String(item.hora).slice(0,5);
 form.elements.tipo.value=item.tipo;
 if(item.paciente_id&&!Array.from(patientSelect.options).some(o=>o.value===item.paciente_id)){
  const o=new Option((item.paciente?.nombre_completo||"Paciente registrado")+" · asociado a esta cita",item.paciente_id);
  patientSelect.append(o);
 }
 patientSelect.value=item.paciente_id||"";
 $("agenda-form-title").textContent="Reprogramar cita";
 saveButton.textContent="Guardar nueva fecha";
 $("agenda-cancel-edit").hidden=false;
 status("agenda-save-status","Ajusta la fecha u hora y guarda. No se creará otra cita.");
 window.tsysAgendaMobileGoToForm?.();
 form.elements.fecha.focus({preventScroll:true});
}


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
 window.tsysAgendaMobileReset?.();
 $("agenda-filtro-estado").value="";
 $("agenda-filtro-vista").value="proximas";
 patientLookupSeq++;clearTimeout(patientSearchTimer);
 patientSearch.value="";status("agenda-paciente-status","");
 patientSelect.replaceChildren(new Option("Sin paciente registrado",""));
 list.replaceChildren();
 resetEditor();
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
let patientLookupSeq=0,patientSearchTimer=null;
const patientSearch=$("agenda-paciente-busqueda");
async function loadPatients(term=patientSearch.value.trim()){
 if(!adminReady)return;
 const request=++patientLookupSeq;
 const query=term.slice(0,70);
 const selected=patientSelect.value;
 const previous=patientSelect.selectedOptions[0];
 const keep=selected?{text:previous?.textContent||"Paciente seleccionado",name:previous?.dataset.name||""}:null;
 status("agenda-paciente-status",query?"Buscando pacientes…":"Cargando pacientes recientes…");
 let result;
 if(query){
  const needle="%"+query.replaceAll("\\","\\\\").replaceAll("%","\\%").replaceAll("_","\\_")+"%";
  const [byName,byDocument]=await Promise.all([
   sb.from("pacientes_tsysoptics").select("id,nombre_completo,tipo_documento,documento")
    .ilike("nombre_completo",needle).order("nombre_completo").limit(40),
   sb.from("pacientes_tsysoptics").select("id,nombre_completo,tipo_documento,documento")
    .ilike("documento",needle).order("nombre_completo").limit(40)
  ]);
  result={error:byName.error||byDocument.error,
    data:[...new Map([...(byName.data||[]),...(byDocument.data||[])].map(p=>[p.id,p])).values()]};
 }else{
  result=await sb.from("pacientes_tsysoptics")
   .select("id,nombre_completo,tipo_documento,documento")
   .order("creado_en",{ascending:false}).limit(40);
 }
 if(!adminReady||request!==patientLookupSeq)return;
 if(result.error){
  status("agenda-paciente-status","No fue posible buscar pacientes. Verifica la conexión y los permisos.");
  return;
 }
 patientSelect.replaceChildren(new Option("Sin paciente registrado",""));
 for(const p of result.data||[]){
  const option=new Option(p.nombre_completo+" · "+p.tipo_documento+" "+p.documento,p.id);
  option.dataset.name=p.nombre_completo;
  patientSelect.append(option);
 }
 if(selected&&!Array.from(patientSelect.options).some(o=>o.value===selected)&&keep){
  const option=new Option(keep.text,selected);
  option.dataset.name=keep.name;
  patientSelect.append(option);
 }
 if(selected)patientSelect.value=selected;
 status("agenda-paciente-status",(result.data||[]).length+" paciente(s) encontrados."+
   (query?" Selecciona el paciente de la lista.":" Escribe para buscar por nombre o documento."));
}
patientSearch.addEventListener("input",()=>{
 clearTimeout(patientSearchTimer);
 patientLookupSeq++;
 patientSearchTimer=setTimeout(()=>{if(adminReady)void loadPatients().catch(()=>status("agenda-paciente-status","No fue posible consultar pacientes. Revisa la conexión."));},350);
});
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
  .order("fecha",{ascending:$("agenda-filtro-vista").value!=="todas"})
  .order("hora",{ascending:$("agenda-filtro-vista").value!=="todas"}).limit(150);
 const selectedDate=$("agenda-filtro-fecha").value;
 if(selectedDate)query=query.eq("fecha",selectedDate);
 else if($("agenda-filtro-vista").value!=="todas")query=query.gte("fecha",todayBogota());
 if($("agenda-filtro-estado").value)query=query.eq("estado",$("agenda-filtro-estado").value);
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
 window.tsysAgendaMobileSync?.(items);
 status("agenda-list-status",items.length+" citas mostradas"+(items.length===150?" (límite de 150; usa los filtros para buscar otras fechas)":"")+".");
 if(!items.length){list.append(textNode("p","Sin citas para los filtros seleccionados."));return}
 for(const item of items){
  const row=textNode("div","","item");
  row.classList.add("agenda-mobile-state-"+item.estado);
  const info=document.createElement("div");
  info.append(
    textNode("strong",item.referencia),
    textNode("small",item.fecha+" · "+String(item.hora).slice(0,5)+" · "+item.tipo),
    textNode("span",STATE_LABELS[item.estado]||item.estado,"agenda-mobile-chip"),
  );
  if(item.paciente?.nombre_completo){
    info.append(textNode("small","Paciente asociado: "+item.paciente.nombre_completo));
    const clinical=document.createElement("a");
    clinical.href="../index.html?paciente="+encodeURIComponent(item.paciente_id);
    clinical.target="_blank";clinical.rel="noopener noreferrer";
    clinical.className="agenda-clinical-link";
    clinical.textContent="Abrir historia clínica ↗";
    info.append(clinical);
  }
  row.append(info);
  const actions=document.createElement("div");
  actions.className="agenda-actions";
  if(["programada","confirmada"].includes(item.estado)){
   const edit=textNode("button","Reprogramar");
   edit.type="button";edit.className="agenda-action";
   edit.addEventListener("click",()=>openEditor(item));
   actions.append(edit);
  }
  const choices=item.estado==="programada"
   ? [["confirmada","Confirmar"],["atendida","Atendida"],["cancelada","Cancelar"]]
   : item.estado==="confirmada"
   ? [["atendida","Atendida"],["cancelada","Cancelar"],["no_asistio","No asistió"]]
   : [];
  for(const [state,label] of choices){
   const button=textNode("button",label);
   button.type="button";
   button.className=state==="cancelada"?"agenda-action-cancel":"agenda-action";
   button.addEventListener("click",()=>changeState(item,state,button));
   actions.append(button);
  }
  row.append(actions);
  list.append(row);
 }
}
async function changeState(item,newState,button){
 if(!adminReady)return;
 if(["cancelada","no_asistio","atendida"].includes(newState)){
  if(!window.confirm("¿Confirmas cambiar el estado de esta cita?"))return;
 }
 button.disabled=true;
 try{
  if(!(await verifyAdmin())){resetAdministrativeView();status("agenda-list-status","Tu sesión ya no tiene permiso para actualizar citas.");return;}
  const {data,error}=await sb.from("citas_tsysoptics")
   .update({estado:newState}).eq("id",item.id).eq("estado",item.estado).select("id").maybeSingle();
  if(error||!data){
   status("agenda-list-status",showError(error,"actualizar"));
   return;
  }
  if(editingId===item.id)resetEditor();
  await loadCitas();
 }catch{
  status("agenda-list-status","No se pudo actualizar la cita. Revisa la conexión.");
 }finally{button.disabled=false}
}

form.addEventListener("submit",async event=>{
 if(!adminReady)return; // Otros perfiles mantienen la interfaz de demostración.
 event.preventDefault();
 if(saving)return;
 const values=new FormData(form);
 const referencia=String(values.get("referencia")||"").trim();
 const fecha=String(values.get("fecha")||"");
 const hora=String(values.get("hora")||"");
 const tipo=String(values.get("tipo")||"");
 const paciente=String(values.get("paciente_id")||"");
 if(referencia.length<2||referencia.length>100||!validDate(fecha)||
    !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(hora)||
    !["Optometría","Entrega de lentes","Control"].includes(tipo)){
  status("agenda-save-status","Verifica la referencia, la fecha, la hora y el tipo de atención.");
  return;
 }
 if(fecha+"T"+hora<bogotaNow()){
  status("agenda-save-status","No es posible programar ni reprogramar una cita a una fecha u hora pasada.");
  return;
 }
 saving=true;saveButton.disabled=true;
 const editing=Boolean(editingId),id=editingId,originalState=editingState,oldDate=editingDate,oldHour=editingHour;
 status("agenda-save-status",editing?"Reprogramando cita…":"Guardando cita…");
 try{
  if(!(await verifyAdmin())){
   resetAdministrativeView();
   status("agenda-save-status","Tu sesión ya no tiene autorización para guardar citas.");
   return;
  }
  const changes={referencia,fecha,hora,tipo,paciente_id:paciente||null};
  const {data,error}=editing
   ?await sb.from("citas_tsysoptics").update(changes)
      .eq("id",id).eq("estado",originalState).eq("fecha",oldDate).eq("hora",oldHour).select("id").maybeSingle()
   :await sb.from("citas_tsysoptics").insert({...changes,estado:"programada"})
      .select("id").maybeSingle();
  if(error||!data){
   status("agenda-save-status",error?showError(error,"guardar"):
    "No se pudo confirmar la cita. Actualiza la agenda antes de volver a intentarlo.");
   return;
  }
  resetEditor();
  window.tsysAgendaMobileAfterCreate?.(fecha);
  status("agenda-save-status",editing
   ?"Cita reprogramada correctamente. Se conservó su registro."
   :"Cita guardada correctamente en Supabase.");
  await loadCitas();
 }catch{
  status("agenda-save-status","No se pudo confirmar el guardado. Actualiza la agenda antes de repetir la operación.");
 }finally{saving=false;saveButton.disabled=false}
});
$("agenda-cancel-edit").addEventListener("click",()=>{
 resetEditor();
 status("agenda-save-status","Edición cancelada. No se cambiaron citas.");
});
$("agenda-refresh").addEventListener("click",loadCitas);
$("agenda-filtro-fecha").addEventListener("change",loadCitas);
$("agenda-filtro-estado").addEventListener("change",loadCitas);
$("agenda-filtro-vista").addEventListener("change",loadCitas);

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

function setupMobileAgenda(){
 const page=$("agenda"),dateInput=$("agenda-filtro-fecha"),listCard=list.closest(".card");
 const columns=page?.querySelector(".cols");
 if(!page||!columns||!listCard)return;
 const media=window.matchMedia("(max-width: 850px)");
 const make=(tag,cls,txt)=>{
  const e=document.createElement(tag);if(cls)e.className=cls;
  if(txt!==undefined)e.textContent=txt;return e;
 };
 form.classList.add("agenda-mobile-create");
 listCard.classList.add("agenda-mobile-list");
 const tabs=make("div","agenda-mobile-tabs");
 const tabButtons=new Map();
 for(const [key,label] of [["citas","Ver citas"],["nueva","Nueva cita"]]){
  const b=make("button","agenda-mobile-tab",label);
  b.type="button";b.addEventListener("click",()=>show(key));
  tabButtons.set(key,b);tabs.append(b);
 }
 function localDate(date){
  const m=/^(\d{4})-(\d\d)-(\d\d)$/.exec(date||"");
  if(!m)return null;
  const d=new Date(Number(m[1]),Number(m[2])-1,Number(m[3]),12);
  return d.getFullYear()===Number(m[1])&&d.getMonth()+1===Number(m[2])&&d.getDate()===Number(m[3])?d:null;
 }
 const dateText=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),
  String(d.getDate()).padStart(2,"0")].join("-");
 const move=(d,n)=>new Date(d.getFullYear(),d.getMonth(),d.getDate()+n,12);
 const monday=d=>move(d,-((d.getDay()+6)%7));
 function show(tab){
  page.dataset.agendaMobileView=tab;
  for(const [key,b] of tabButtons){
   b.classList.toggle("active",key===tab);
   b.setAttribute("aria-pressed",String(key===tab));
  }
  if(tab==="nueva"&&media.matches&&!form.elements.fecha.value)
   form.elements.fecha.value=dateInput.value||todayBogota();
 }
 const calendar=make("div","agenda-mobile-calendar");
 const tools=make("div","agenda-mobile-calendar-tools");
 const prev=make("button","agenda-mobile-arrow","‹");
 const label=make("strong","agenda-mobile-week-label");
 const next=make("button","agenda-mobile-arrow","›");
 const today=make("button","agenda-mobile-shortcut","Hoy");
 const all=make("button","agenda-mobile-shortcut","Todas");
 for(const b of [prev,next,today,all])b.type="button";
 prev.setAttribute("aria-label","Semana anterior");
 next.setAttribute("aria-label","Semana siguiente");
 tools.append(prev,label,next,today,all);
 const strip=make("div","agenda-mobile-week-strip");
 calendar.append(tools,strip);
 const summary=make("div","agenda-mobile-summary","Selecciona un día para ver las citas.");
 summary.setAttribute("role","status");
 columns.before(tabs);
 tabs.after(calendar);calendar.after(summary);
 let start=monday(localDate(dateInput.value)||localDate(todayBogota()));
 function renderWeek(){
  strip.replaceChildren();
  const fmt=new Intl.DateTimeFormat("es-CO",{day:"numeric",month:"short"});
  const wd=new Intl.DateTimeFormat("es-CO",{weekday:"short"});
  label.textContent=fmt.format(start)+" – "+fmt.format(move(start,6));
  for(let n=0;n<7;n++){
   const d=move(start,n),v=dateText(d),b=make("button","agenda-mobile-day");
   b.type="button";b.setAttribute("aria-pressed",String(dateInput.value===v));
   if(dateInput.value===v)b.classList.add("selected");
   if(todayBogota()===v)b.classList.add("today");
   b.append(make("small",null,wd.format(d).replace(".","")),
    make("strong",null,String(d.getDate())));
   b.setAttribute("aria-label",v);
   b.addEventListener("click",()=>selectDate(v));
   strip.append(b);
  }
  all.classList.toggle("active",!dateInput.value);
  today.classList.toggle("active",dateInput.value===todayBogota());
 }
 function selectDate(value,refresh=true){
  dateInput.value=value;
  if(value)start=monday(localDate(value)||new Date());
  renderWeek();
  if(refresh)dateInput.dispatchEvent(new Event("change",{bubbles:true}));
 }
 prev.addEventListener("click",()=>selectDate(dateText(move(start,-7))));
 next.addEventListener("click",()=>selectDate(dateText(move(start,7))));
 today.addEventListener("click",()=>selectDate(todayBogota()));
 all.addEventListener("click",()=>selectDate(""));
 dateInput.addEventListener("change",()=>{
  if(dateInput.value)start=monday(localDate(dateInput.value)||new Date());
  renderWeek();
 });
 window.tsysAgendaMobileGoToForm=()=>{show("nueva");if(media.matches)tabs.scrollIntoView({behavior:"smooth",block:"start"});};
 show("citas");renderWeek();
 window.tsysAgendaMobileSync=items=>{
  const counts=key=>items.filter(x=>x.estado===key).length;
  summary.textContent=items.length+" "+(items.length===1?"cita":"citas")+" mostradas · "+
   counts("programada")+" programadas · "+counts("confirmada")+" confirmadas · "+
   counts("atendida")+" atendidas";
 };
 window.tsysAgendaMobileAfterCreate=fecha=>{
  if(!media.matches)return;
  if(localDate(fecha))selectDate(fecha,false);
  show("citas");tabs.scrollIntoView({behavior:"smooth",block:"start"});
 };
 window.tsysAgendaMobileReset=()=>{
  dateInput.value="";start=monday(localDate(todayBogota()));renderWeek();show("citas");
  summary.textContent="Selecciona un día para ver las citas.";
 };
 window.addEventListener("tsys:role",e=>{
  if(e.detail?.role==="administrador"&&media.matches&&!dateInput.value)
   selectDate(todayBogota(),false);
 });
 window.addEventListener("tsys:locked",()=>window.tsysAgendaMobileReset());
 media.addEventListener("change",()=>{if(!media.matches)show("citas");renderWeek()});
 if($("tsys-app")?.dataset.role==="administrador"&&media.matches&&!dateInput.value)
  selectDate(todayBogota(),false);
}

setupMobileAgenda();
window.addEventListener("tsys:role",event=>{
 if(event.detail?.role==="administrador")void activate();
 else resetAdministrativeView();
});
window.addEventListener("tsys:locked",resetAdministrativeView);
if($("tsys-app")?.dataset.role==="administrador")void activate();
