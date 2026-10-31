import {createClient} from "https://esm.sh/@supabase/supabase-js@2";
import {SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY} from "./supabase-config.js";
const db=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{flowType:"pkce",persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const el=id=>document.getElementById(id);
let optica=null;
const estado=s=>el("estado").textContent=s;
function vista(autorizado){el("login").hidden=autorizado;el("panel").hidden=!autorizado;}
async function cargar(){
 const {data,error}=await db.rpc("mi_perfil_saas_tsysoptics");
 if(error){vista(false);estado("No se pudo comprobar el permiso: "+error.message);return;}
 const admin=(data||[]).find(o=>o.rol==="administrador"&&o.estado==="activa");
 if(!admin){optica=null;vista(false);estado("Esta cuenta aún no dispone de una óptica activa como administrador.");return;}
 optica=admin;
 el("nombre").value=admin.nombre;
 el("optica-nombre").textContent=admin.nombre;
 vista(true);estado("Sesión autorizada.");
}
el("login-form").addEventListener("submit",async e=>{
 e.preventDefault();estado("Comprobando credenciales...");
 const {error}=await db.auth.signInWithPassword({email:el("login-correo").value.trim(),password:el("login-clave").value});
 el("login-clave").value="";
 if(error){estado("Error al acceder: "+error.message);return;}
 await cargar();
});
el("marca-form").addEventListener("submit",async e=>{
 e.preventDefault();
 if(!optica)return;
 const config={telefono:el("telefono").value.trim(),direccion:el("direccion").value.trim(),whatsapp:el("whatsapp").value.trim(),correo:el("correo").value.trim(),eslogan:el("eslogan").value.trim(),color_primario:el("color").value};
 estado("Guardando configuración...");
 const {error}=await db.rpc("actualizar_marca_mi_optica_tsysoptics",{p_optica:optica.optica_id,p_nombre:el("nombre").value.trim(),p_config:config});
 if(error){estado("No se pudo guardar: "+error.message);return;}
 el("optica-nombre").textContent=el("nombre").value.trim();estado("Identidad guardada en tu óptica.");
});
el("logout").addEventListener("click",async()=>{await db.auth.signOut();optica=null;vista(false);estado("Sesión cerrada.");});
const {data:{session}}=await db.auth.getSession();
if(session)await cargar();else vista(false);
