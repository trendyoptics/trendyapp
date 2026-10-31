import {createClient} from "https://esm.sh/@supabase/supabase-js@2";
import {SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY} from "./supabase-config.js";
const db=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{flowType:"pkce",persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
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
 mostrar("panel");estado("Acceso confirmado a "+admin.nombre+".");
}
async function comenzar(){
 const query=new URLSearchParams(location.search);
 const hash=new URLSearchParams(location.hash.replace(/^#/,""));
 const type=query.get("type")||hash.get("type");
 const fromEmail=type==="recovery"||type==="invite"||query.has("code")||query.has("token_hash")||hash.has("access_token");
 // Supabase procesa automáticamente el code PKCE y los tokens URL
 // (detectSessionInUrl:true). No consumir el mismo código dos veces.
 const {data:{session},error}=await db.auth.getSession();
 if(error){mostrar("login");estado("No se pudo verificar el enlace: "+error.message);return;}
 if(!session){
  const token=query.get("token_hash")||hash.get("token_hash");
  if(token && ["invite","recovery"].includes(type)){
   const verified=await db.auth.verifyOtp({token_hash:token,type});
   if(!verified.error && verified.data.session){
    history.replaceState(null,"",location.pathname);
    mostrar("password-setup");
    estado("Enlace confirmado. Ya puedes establecer tu contraseña.");
    return;
   }
  }
  mostrar("login");
  estado(fromEmail?"El enlace no estableció una sesión válida. Solicita recuperación de contraseña para generar un enlace nuevo.":"Inicia sesión con el correo de tu óptica.");
  return;
 }
 if(fromEmail){
  const {data:{user},error:userError}=await db.auth.getUser();
  if(userError||!user){mostrar("login");estado("No se pudo verificar la identidad del enlace.");return;}
  history.replaceState(null,"",location.pathname);
  mostrar("password-setup");
  estado("Sesión verificada. Crea tu contraseña.");
 }else await cargar();
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