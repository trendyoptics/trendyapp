import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./supabase-config.js";

const db = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {auth:{flowType:"pkce",autoRefreshToken:true,persistSession:true,detectSessionInUrl:true}});
const $ = id => document.getElementById(id);
let opticas=[];
const setStatus = message => { $("status").textContent=message; };
const textNode = value => document.createTextNode(String(value ?? "—"));
function cell(row,value){const td=document.createElement("td");td.append(textNode(value));row.append(td);return td;}
function render(){
 const search=$("filter").value.trim().toLocaleLowerCase("es");
 const state=$("state-filter").value;
 const filtered=opticas.filter(o=>(state==="todas"||o.estado===state)&&[o.nombre,o.correo_contacto].some(x=>String(x||"").toLocaleLowerCase("es").includes(search)));
 $("count-total").textContent=opticas.length;
 $("count-active").textContent=opticas.filter(o=>o.estado==="activa").length;
 const now=new Date();const end=new Date(now.getTime()+30*86400000);
 $("count-expire").textContent=opticas.filter(o=>o.vence_en&&new Date(o.vence_en+"T23:59:59")>=now&&new Date(o.vence_en+"T23:59:59")<=end).length;
 $("body").replaceChildren();
 if(!filtered.length){const tr=document.createElement("tr");const td=cell(tr,"Sin ópticas para mostrar.");td.colSpan=6;$("body").append(tr);return;}
 for(const o of filtered){
  const tr=document.createElement("tr");
  cell(tr,o.nombre);cell(tr,o.correo_contacto);cell(tr,o.plan);cell(tr,o.vence_en||"Sin fecha");cell(tr,o.estado);
  const td=document.createElement("td");
  const b=document.createElement("button");
  b.type="button";b.textContent=o.estado==="suspendida"?"Volver a preparación":"Suspender";b.disabled=o.estado==="activa";
  b.title=o.estado==="activa"?"No se puede modificar una óptica activa sin migración segura.":"Cambiar estado comercial sin borrar datos";
  b.addEventListener("click",async()=>{
    const next=o.estado==="suspendida"?"preparacion":"suspendida";
    if(!confirm("¿Cambiar el estado de "+o.nombre+" a "+next+"? No se eliminarán datos."))return;
    b.disabled=true;
    const {error}=await db.rpc("cambiar_estado_optica_superadmin_tsysoptics",{p_optica:o.id,p_estado:next});
    if(error){setStatus("No se pudo cambiar el estado: "+error.message);b.disabled=false;return;}
    setStatus("Estado actualizado.");await reload();
  });
  if(o.estado==="preparacion"){
   const invite=document.createElement("button");invite.type="button";invite.textContent="Invitar administrador";invite.style.marginLeft="8px";
   invite.addEventListener("click",async()=>{
    if(!confirm("¿Enviar invitación de acceso a "+o.correo_contacto+" para "+o.nombre+"?"))return;
    invite.disabled=true;setStatus("Enviando invitación...");
    const {data:sessionData}=await db.auth.getSession();
    if(!sessionData?.session){setStatus("Debes iniciar sesión de nuevo.");invite.disabled=false;return;}
    try{
     const response=await fetch(SUPABASE_URL+"/functions/v1/tsysoptics-invitar-administrador",{
      method:"POST",headers:{"Authorization":"Bearer "+sessionData.session.access_token,"apikey":SUPABASE_PUBLISHABLE_KEY,"Content-Type":"application/json"},body:JSON.stringify({optica_id:o.id})
     });
     const data=await response.json();
     setStatus(response.ok?data.mensaje:(data.error||"No fue posible enviar la invitación."));
    }catch{setStatus("No se pudo conectar con el servicio de invitaciones.");}
    finally{invite.disabled=false;}
   });
   td.append(invite);
  }
  td.append(b);tr.append(td);$("body").append(tr);
 }
}
async function reload(){
 const {data,error}=await db.rpc("listar_opticas_superadmin_tsysoptics");
 if(error){setStatus("Acceso denegado o servicio no disponible: "+error.message);show(false);return;}
 opticas=data||[];show(true);render();setStatus("Directorio actualizado. No se muestran datos clínicos.");
}
function show(ok){
 for(const id of ["cards","directory","create-box"])$(id).hidden=!ok;
 $("login-box").hidden=ok;
 $("logout").hidden=!ok;
}
$("login-form").addEventListener("submit",async e=>{
 e.preventDefault();
 setStatus("Verificando credenciales...");
 const {error}=await db.auth.signInWithPassword({email:$("email").value.trim(),password:$("password").value});
 $("password").value="";
 if(error){setStatus("No se pudo iniciar sesión: "+error.message);return;}
 await reload();
});
$("logout").addEventListener("click",async()=>{await db.auth.signOut();opticas=[];show(false);setStatus("Sesión cerrada.");});
$("new-form").addEventListener("submit",async e=>{
 e.preventDefault();
 const nombre=$("nombre").value.trim(),correo=$("correo").value.trim(),plan=$("plan").value,vence=$("vence").value||null;
 if(!confirm("¿Registrar "+nombre+" como óptica en preparación? No se enviará invitación ni se habilitará acceso clínico."))return;
 const {error}=await db.rpc("crear_optica_superadmin_tsysoptics",{p_nombre:nombre,p_correo:correo,p_plan:plan,p_vence:vence});
 if(error){setStatus("No fue posible registrar la óptica: "+error.message);return;}
 $("new-form").reset();setStatus("Óptica registrada en preparación.");await reload();
});
$("filter").addEventListener("input",render);
$("state-filter").addEventListener("change",render);
const {data:{session}}=await db.auth.getSession();
if(session)await reload();else show(false);
