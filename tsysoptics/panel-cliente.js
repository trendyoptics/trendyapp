import {montarPacientesA2} from "./pacientes-integrados-a2.js?v=20261102a";
import {createClient} from "https://esm.sh/@supabase/supabase-js@2";
import {SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY} from "./supabase-config.js";
const db=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,flowType:"pkce",detectSessionInUrl:true}});
const el=id=>document.getElementById(id);let tenant=null,registros=[],pacientesA2=null;
function mensaje(t){el("estado").textContent=t;}
async function iniciar(){
 const {data:{user}}=await db.auth.getUser();
 if(!user){location.replace("./index.html");return;}
 const {data,error}=await db.rpc("mi_perfil_saas_tsysoptics");
 if(error){mensaje("No se pudo verificar tu acceso.");return;}
 tenant=(data||[]).find(x=>x.estado==="activa"&&x.rol==="administrador");
 if(!tenant){mensaje("Tu óptica aún no tiene habilitado este panel. Entra a Mi óptica para personalizarla.");return;}
 el("marca").textContent=tenant.nombre;
 pacientesA2=montarPacientesA2({db,opticaId:tenant.optica_id});
 el("operativo").hidden=false;
 await cargar();
 const fromHash=location.hash==="#pacientes-integrados"?"pacientes":location.hash==="#registros"?"registros":"inicio";
 await mostrarPagina(fromHash);

}
async function cargar(){
 mensaje("Cargando datos de tu óptica…");
 const {data,error}=await db.from("registros_saas_tsysoptics").select("id,tipo,contenido,creado_en").eq("optica_id",tenant.optica_id).order("creado_en",{ascending:false}).limit(500);
 if(error){mensaje("No se pudo consultar el directorio: "+error.message);return;}
 registros=data||[];const tbody=el("filas");tbody.replaceChildren();
 for(const r of registros){const tr=document.createElement("tr");for(const value of [new Date(r.creado_en).toLocaleDateString("es-CO"),r.tipo,r.contenido?.nombre||"",r.contenido?.descripcion||""]){const td=document.createElement("td");td.textContent=value;tr.append(td);}tbody.append(tr);}
 mensaje(registros.length+" registros disponibles.");
}
el("registro").addEventListener("submit",async e=>{
 e.preventDefault();const nombre=el("nombre").value.trim();
 if(nombre.length<2){mensaje("Escribe un nombre válido.");return;}
 const tipo=el("tipo").value;
 const {error}=await db.from("registros_saas_tsysoptics").insert({optica_id:tenant.optica_id,tipo,contenido:{nombre,descripcion:el("descripcion").value.trim()}});
 if(error){mensaje("No se pudo guardar: "+error.message);return;}
 el("registro").reset();await cargar();mensaje("Registro guardado en tu óptica.");
});
async function mostrarPagina(page){
 const sections={inicio:el("inicio"),pacientes:el("pacientes-integrados"),registros:el("registros")};
 const chosen=Object.hasOwn(sections,page)?page:"inicio";
 for(const [id,section] of Object.entries(sections))section.hidden=id!==chosen;
 document.querySelectorAll(".side a").forEach(link=>{
  link.classList.toggle("active",link.dataset.pageA2===chosen);
 });
 if(chosen==="pacientes"&&pacientesA2)await pacientesA2.activar();
 else if(pacientesA2)pacientesA2.desactivar();
}
for(const link of document.querySelectorAll('[data-page-a2]')){
 link.addEventListener("click",event=>{
  event.preventDefault();
  const page=link.dataset.pageA2;
  history.replaceState(null,"","#"+(page==="pacientes"?"pacientes-integrados":page));
  void mostrarPagina(page);
 });
}
for(const link of document.querySelectorAll(".side [data-filter]")){
 link.addEventListener("click",()=>{
  const tipo=link.dataset.filter;
  void mostrarPagina("registros");
  el("tipo").value=tipo;
  document.querySelectorAll(".side a").forEach(x=>x.classList.remove("active"));
  link.classList.add("active");
  mensaje("Módulo "+link.textContent.trim()+": registros de tu óptica. Completa los datos y pulsa Guardar registro.");
  el("nombre").focus({preventScroll:true});
 });
}
for(const link of document.querySelectorAll(".side [data-action='exportar']")){
 link.addEventListener("click",()=>el("exportar").click());
}
el("actualizar").addEventListener("click",()=>void cargar());
el("salir").addEventListener("click",async()=>{await db.auth.signOut();location.replace("./index.html")});
el("exportar").addEventListener("click",()=>{
 const escape=v=>'"'+String(v??"").replaceAll('"','""').replace(/^[\s]*[=+@-]/,"'$&")+'"';
 const lines=[["fecha","tipo","nombre","descripcion"].map(escape).join(",")];
 for(const r of registros)lines.push([r.creado_en,r.tipo,r.contenido?.nombre,r.contenido?.descripcion].map(escape).join(","));
 const blob=new Blob(["\uFEFF",lines.join("\r\n")],{type:"text/csv;charset=utf-8"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="TsysOptics_Registros_"+new Date().toISOString().slice(0,10)+".csv";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
await iniciar();