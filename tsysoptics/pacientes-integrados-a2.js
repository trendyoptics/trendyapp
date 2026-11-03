/**
 * Pacientes A2 dentro del mismo panel, sin navegación ni recarga.
 * El optica_id viene de una membresía comprobada por la RPC;
 * RLS vuelve a comprobar autorización en cada operación.
 */
export function montarPacientesA2({db,opticaId,onStatus}){
 const root=document.getElementById("pacientes-integrados");
 if(!root||!opticaId)throw Error("No hay óptica autorizada.");
 const $=id=>root.querySelector("#p2-"+id);
 let pacientes=[],editando=null,activo=false;
 const mensaje=t=>{$("estado").textContent=t;onStatus?.(t)};
 function limpiar(){
  editando=null;$("form").reset();$("titulo").textContent="Registrar paciente";$("cancelar").hidden=true;
 }
 function dibujar(){
  const term=$("buscar").value.toLocaleLowerCase("es").trim();
  const rows=pacientes.filter(p=>[p.nombre_completo,p.documento].some(v=>String(v||"").toLocaleLowerCase("es").includes(term)));
  $("cantidad").textContent=rows.length+" paciente(s)";
  const list=$("lista");list.replaceChildren();
  for(const p of rows){
   const div=document.createElement("div");div.className="p2-fila";
   const info=document.createElement("div");
   const title=document.createElement("strong");title.textContent=p.nombre_completo;
   const sub=document.createElement("small");sub.textContent=p.tipo_documento+" "+p.documento;
   info.append(title,sub);
   const edit=document.createElement("button");edit.type="button";edit.textContent="Editar";
   edit.addEventListener("click",()=>{
    editando=p.id;$("titulo").textContent="Editar paciente";
    for(const [id,key] of Object.entries({tipo:"tipo_documento",documento:"documento",nombre:"nombre_completo",nacimiento:"fecha_nacimiento",telefono:"telefono",eps:"eps",direccion:"direccion"}))$(id).value=p[key]||"";
    $("cancelar").hidden=false;
    $("form").scrollIntoView({behavior:"smooth",block:"start"});
   });
   div.append(info,edit);list.append(div);
  }
 }
 async function cargar(){
  if(!activo)return;
  mensaje("Consultando pacientes...");
  const {data,error}=await db.from("pacientes_saas_tsysoptics")
   .select("id,tipo_documento,documento,nombre_completo,fecha_nacimiento,telefono,direccion,eps")
   .eq("optica_id",opticaId).order("nombre_completo").limit(1000);
  if(error){mensaje("No se pudieron cargar pacientes: "+error.message);return}
  pacientes=data||[];dibujar();mensaje("Pacientes actualizados.");
 }
 $("buscar").addEventListener("input",dibujar);
 $("cancelar").addEventListener("click",limpiar);
 $("actualizar").addEventListener("click",()=>void cargar());
 $("form").addEventListener("submit",async event=>{
  event.preventDefault();
  if(!activo)return;
  const campos={tipo_documento:$("tipo").value,documento:$("documento").value.trim(),nombre_completo:$("nombre").value.trim(),fecha_nacimiento:$("nacimiento").value||null,telefono:$("telefono").value.trim(),eps:$("eps").value.trim(),direccion:$("direccion").value.trim(),actualizado_en:new Date().toISOString()};
  if(campos.nombre_completo.length<2||campos.documento.length<3){mensaje("Revisa el nombre y documento.");return}
  const btn=$("guardar");btn.disabled=true;mensaje("Guardando paciente...");
  const req=editando
   ? db.from("pacientes_saas_tsysoptics").update(campos).eq("id",editando).eq("optica_id",opticaId)
   : db.from("pacientes_saas_tsysoptics").insert({...campos,optica_id:opticaId});
  const {error}=await req;btn.disabled=false;
  if(error){mensaje(error.code==="23505"?"Este documento ya está registrado en tu óptica.":error.message);return}
  limpiar();await cargar();mensaje("Paciente guardado correctamente.");
 });
 return {
  async activar(){activo=true;await cargar()},
  desactivar(){activo=false}
 };
}
