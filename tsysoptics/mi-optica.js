import {createClient} from "https://esm.sh/@supabase/supabase-js@2";
import {SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY} from "./supabase-config.js";
const db=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{flowType:"pkce",persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
const el=id=>document.getElementById(id);
const estado=m=>el("estado").textContent=m;
let optica=null;
function mostrar(seccion){
 for(const id of ["login","password-setup","panel"])el(id).hidden=id!==seccion;
}
async function cargar(){
 const {data:{user},error:authError}=await db.auth.getUser();
 if(authError||!user){mostrar("login");estado("Inicia sesión con el correo que recibió la invitación.");return;}
 const {data,error}=await db.rpc("mi_perfil_saas_tsysoptics");
 if(error){mostrar("login");estado("No se pudo verificar tu óptica: "+error.message);return;}
 const admin=(data||[]).find(o=>o.rol==="administrador"&&["preparacion","activa"].includes(o.estado));
 if(!admin){mostrar("login");estado("Esta cuenta no tiene una óptica asignada. Verifica que utilizas el correo invitado.");return;}
 optica=admin;el("nombre").value=admin.nombre;el("optica-nombre").textContent=admin.nombre;
 el("licencia-notice").textContent=admin.estado==="preparacion"?
 "Puedes personalizar tu óptica. El acceso a historias clínicas, ventas e inventario se habilitará cuando se certifique el aislamiento de datos.":
 "Tu óptica está activa. Las funciones operativas requieren los permisos correspondientes.";
 const out=await db.rpc("mi_identidad_optica_saas_tsysoptics");
 if(out.error){mostrar("login");estado("Error al cargar identidad: "+out.error.message);return;}
 const identidad=(out.data||[]).find(x=>x.optica_id===admin.optica_id);
 if(identidad){
  el("nit").value=identidad.nit||"";
  const c=identidad.configuracion||{};
  for(const k of ["telefono","direccion","whatsapp","correo","eslogan"]){el(k).value=c[k]||"";}
  if(/^#[0-9a-f]{6}$/i.test(c.color_primario||""))el("color").value=c.color_primario;
 }
 if(admin.estado==="activa" && new URLSearchParams(location.search).get("configurar")!=="1"){
   location.replace("./panel-a2.html");return;
 }
 mostrar("panel");estado("Acceso confirmado a "+admin.nombre+".");
}
async function comenzar(){
 const query=new URLSearchParams(location.search);
 const hash=new URLSearchParams(location.hash.slice(1));
 const type=query.get("type")||hash.get("type");
 const access=hash.get("access_token");
 const refresh=hash.get("refresh_token");
 const token=query.get("token_hash")||hash.get("token_hash");
 const code=query.get("code");
 const esEnlace=Boolean(access||token||code||type==="invite"||type==="recovery");
 if(esEnlace){
   estado("Verificando enlace seguro...");
   let error=null;
   if(access&&refresh){
     ({error}=await db.auth.setSession({access_token:access,refresh_token:refresh}));
   }else if(token&&["invite","recovery"].includes(type)){
     ({error}=await db.auth.verifyOtp({token_hash:token,type}));
   }else if(code){
     ({error}=await db.auth.exchangeCodeForSession(code));
   }else{
     error=new Error("Enlace incompleto: falta el código de acceso.");
   }
   if(error){
     mostrar("login");
     estado("No se pudo validar el enlace: "+error.message+". Genera uno nuevo desde Ópticas conectadas.");
     return;
   }
   const {data:{user},error:userError}=await db.auth.getUser();
   if(userError||!user){mostrar("login");estado("No se pudo confirmar la cuenta del enlace.");return;}
   // No dejar tokens en el historial o capturas del navegador.
   history.replaceState(null,"",location.pathname);
   mostrar("password-setup");
   estado("Enlace validado para "+user.email+". Establece tu contraseña.");
   return;
 }
 const {data:{session}}=await db.auth.getSession();
 if(session)await cargar();
 else{mostrar("login");estado("Ingresa con el correo de la óptica.");}
}

el("login-form").addEventListener("submit",async e=>{
 e.preventDefault();estado("Verificando credenciales...");
 const {error}=await db.auth.signInWithPassword({email:el("login-correo").value.trim(),password:el("login-clave").value});
 el("login-clave").value="";
 if(error){estado("Correo o contraseña incorrectos. Puedes restablecer tu contraseña desde esta pantalla.");return;}
 await cargar();
});
el("password-form").addEventListener("submit",async e=>{
 e.preventDefault();
 const clave=el("new-password").value;
 if(clave.length<8){estado("La contraseña debe tener al menos 8 caracteres.");return;}
 const {data:{user}}=await db.auth.getUser();
 if(!user){mostrar("login");estado("La invitación expiró. Abre el enlace nuevamente.");return;}
 const boton=el("password-form").querySelector("button");boton.disabled=true;estado("Guardando contraseña...");
 const {error}=await db.auth.updateUser({password:clave});
 boton.disabled=false;
 if(error){estado("Supabase rechazó la contraseña: "+error.message);return;}
 el("new-password").value="";
 // Confirmar nueva contraseña mediante sesión fresca antes de dar acceso.
 const fresh=await db.auth.getSession();
 if(!fresh.data.session){mostrar("login");estado("La contraseña se cambió, pero la sesión terminó. Ingresa con tu nueva contraseña.");return;}
 await cargar();
});
el("marca-form").addEventListener("submit",async e=>{
 e.preventDefault();if(!optica)return;
 const config={nit:el("nit").value.trim(),telefono:el("telefono").value.trim(),direccion:el("direccion").value.trim(),whatsapp:el("whatsapp").value.trim(),correo:el("correo").value.trim(),eslogan:el("eslogan").value.trim(),color_primario:el("color").value};
 const {error}=await db.rpc("actualizar_marca_mi_optica_tsysoptics",{p_optica:optica.optica_id,p_nombre:el("nombre").value.trim(),p_config:config});
 estado(error?"No se pudo guardar: "+error.message:"Identidad guardada correctamente.");
 if(!error)el("optica-nombre").textContent=el("nombre").value.trim();
});
el("reset-password").addEventListener("click",async()=>{
 const email=el("login-correo").value.trim();
 if(!email){estado("Escribe primero tu correo en el campo de acceso.");return;}
 const {error}=await db.auth.resetPasswordForEmail(email,{redirectTo:new URL("./mi-optica.html",location.href).href});
 if(error){
  const limitada=error.status===429 || /rate limit|too many requests/i.test(error.message||"");
  estado(limitada?"Supabase alcanzó el límite temporal de correos. No sigas pulsando recuperar: espera a que se restablezca el envío o utiliza una sesión ya abierta.":"No se pudo solicitar recuperación: "+error.message);
  return;
 }
 estado("Si la cuenta existe, recibirás un enlace. Revisa tu bandeja y spam.");
});
el("logout").addEventListener("click",async()=>{await db.auth.signOut();optica=null;mostrar("login");estado("Sesión cerrada.");});
await comenzar();