import {createClient} from "https://esm.sh/@supabase/supabase-js@2";
import {SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY} from "./supabase-config.js";
const db=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,flowType:"pkce",detectSessionInUrl:true}});
const $=id=>document.getElementById(id);
let optica=null,pacientes=[],editando=null;
function status(t){$("status").textContent=t}
function dibujar(){
 const filtro=$("buscar").value.toLocaleLowerCase("es").trim();
 const vista=pacientes.filter(p=>(p.nombre_completo+" "+p.documento).toLocaleLowerCase("es").includes(filtro));
 $("cantidad").textContent=vista.length+" pacientes";
 $("list").replaceChildren();
 for(const p of vista){
  const div=document.createElement("div");div.className="item";
  const text=document.createElement("span");
  const strong=document.createElement("strong");strong.textContent=p.nombre_completo;
  const small=document.createElement("small");small.className="muted";small.textContent=" · "+p.tipo_documento+" "+p.documento;
  text.append(strong,small);
  const edit=document.createElement("button");edit.type="button";edit.textContent="Editar";
  edit.addEventListener("click",()=>{editando=p.id;$("form-title").textContent="Editar paciente";$("tipo").value=p.tipo_documento;$("documento").value=p.documento;$("nombre").value=p.nombre_completo;$("nacimiento").value=p.fecha_nacimiento||"";$("telefono").value=p.telefono||"";$("eps").value=p.eps||"";$("direccion").value=p.direccion||"";$("cancelar").hidden=false;window.scrollTo({top:0,behavior:"smooth"});});
  div.append(text,edit);$("list").append(div);
 }
}
async function cargar(){
 const {data,error}=await db.from("pacientes_saas_tsysoptics").select("id,tipo_documento,documento,nombre_completo,fecha_nacimiento,telefono,direccion,eps").eq("optica_id",optica).order("nombre_completo").limit(1000);
 if(error){status("No se pudieron consultar los pacientes: "+error.message);return;}
 pacientes=data||[];dibujar();status("Pacientes cargados.");
}
const {data:{user}}=await db.auth.getUser();
if(!user){location.replace("./index.html");}
else{
 const {data,error}=await db.rpc("mi_perfil_saas_tsysoptics");
 const tenant=!error&&(data||[]).find(x=>x.rol==="administrador"&&x.estado==="activa");
 if(!tenant)status("Sin acceso activo a pacientes de esta óptica.");
 else{optica=tenant.optica_id;$("content").hidden=false;await cargar();}
}
$("buscar").addEventListener("input",dibujar);
function limpiar(){editando=null;$("form").reset();$("form-title").textContent="Registrar paciente";$("cancelar").hidden=true;}
$("cancelar").addEventListener("click",limpiar);
$("form").addEventListener("submit",async e=>{
 e.preventDefault();if(!optica)return;
 const data={tipo_documento:$("tipo").value,documento:$("documento").value.trim(),nombre_completo:$("nombre").value.trim(),fecha_nacimiento:$("nacimiento").value||null,telefono:$("telefono").value.trim(),eps:$("eps").value.trim(),direccion:$("direccion").value.trim(),actualizado_en:new Date().toISOString()};
 if(data.nombre_completo.length<2||data.documento.length<3){status("Revisa el nombre y documento.");return;}
 let request;
 if(editando)request=db.from("pacientes_saas_tsysoptics").update(data).eq("id",editando).eq("optica_id",optica);
 else request=db.from("pacientes_saas_tsysoptics").insert({...data,optica_id:optica});
 const {error}=await request;
 if(error){status(error.code==="23505"?"Ya existe un paciente con ese documento en tu óptica.":error.message);return;}
 limpiar();await cargar();status("Paciente guardado correctamente.");
});