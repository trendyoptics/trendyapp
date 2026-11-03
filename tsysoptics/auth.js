import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./supabase-config.js";

const root = document.getElementById("auth-root");
const loading = document.getElementById("tsys-auth-loading");
function finishLoading(){ if(loading) loading.hidden=true; }
const app = document.getElementById("tsys-app");
const notice = document.getElementById("auth-message");
const form = document.getElementById("auth-form");
const passwordField = document.getElementById("auth-password");
const passwordToggle = document.getElementById("auth-toggle-password");
const passwordStrike = document.getElementById("auth-password-strike");
function setPasswordVisibility(visible) {
  passwordField.type = visible ? "text" : "password";
  passwordToggle.setAttribute("aria-pressed", String(visible));
  passwordToggle.setAttribute("aria-label", visible ? "Ocultar contraseña" : "Mostrar contraseña");
  passwordToggle.title = visible ? "Ocultar contraseña" : "Mostrar contraseña";
  if (passwordStrike) passwordStrike.hidden = !visible;
}
passwordToggle.addEventListener("click", () => {
  setPasswordVisibility(passwordField.type === "password");
  passwordField.focus({ preventScroll: true });
});
const emailField = document.getElementById("auth-email");
const submit = document.getElementById("auth-submit");
const recover = document.getElementById("auth-recover");
const change = document.getElementById("auth-change");
const logout = document.getElementById("auth-logout");

const configured = SUPABASE_PUBLISHABLE_KEY.startsWith("sb_publishable_") ||
  (SUPABASE_PUBLISHABLE_KEY.startsWith("eyJ") && SUPABASE_PUBLISHABLE_KEY.length > 100);
const client = configured
  ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { flowType: "pkce", autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
    })
  : null;
let mode = "login";
let currentUserId = null;
let processing = false;

// Alias de acceso del doctor externo. Supabase mantiene autenticación por email.
const EXTERNAL_ALIAS = "externo";
const EXTERNAL_EMAIL = "trendyoptics1+externo@gmail.com";
const ALLOWED_ROLES = new Set(["administrador", "externo"]);

function applyRole(role) {
  const restricted = role !== "administrador";
  app.dataset.role = role;
  const roleLabel = document.getElementById("access-role");
  if (roleLabel) roleLabel.textContent = restricted ? "Doctor externo · demostración" : "Administrador";

  for (const element of app.querySelectorAll("[data-page], [data-go]")) {
    const section = element.dataset.page || element.dataset.go;
    const isLocked = restricted && ["ventas", "inventario", "caja", "laboratorio", "posventa", "devoluciones", "cotizaciones", "informes"].includes(section);
    if ("disabled" in element) element.disabled = isLocked;
    element.classList.toggle("role-locked", isLocked);
    if (section === "cotizaciones") element.hidden = isLocked;
    element.setAttribute("aria-disabled", String(isLocked));
    if (isLocked) element.title = "Acceso exclusivo del administrador";
    else element.removeAttribute("title");
  }

  // Nunca dirigir al personal externo a la historia clínica antigua (pública
  // e independiente de TsysOptics). El doctor usa el piloto clínico DEMO.
  for (const link of app.querySelectorAll("[data-access-target]")) {
    const target = link.dataset.accessTarget;
    link.href = restricted
      ? (target === "pacientes" ? "./doctor.html" : "./clinica-completa-demo.html")
      : (target === "pacientes" ? "./pacientes.html" : "../index.html");
  }

  window.dispatchEvent(new CustomEvent("tsys:role", { detail: { role } }));
}

function clearRole() {
  delete app.dataset.role;
  window.dispatchEvent(new Event("tsys:locked"));
}
function message(text) { notice.textContent = text; }
function locked(text = "") {
  finishLoading();
  app.hidden = true;
  root.hidden = false;
  logout.hidden = true;
  if (text) message(text);
  clearRole();
}
async function actualizarAccesosSuperadmin(role) {
  const ids=["tsys-superadmin-opticas","tsys-superadmin-alta","tsys-mobile-opticas","tsys-mobile-alta","tsys-admin-shortcuts"];
  ids.forEach(id=>{const x=document.getElementById(id);if(x)x.hidden=true;});
  if(role!=="administrador" || !client)return;
  // El servidor decide: una cuenta común recibe 42501 y no muestra las funciones de propietario SaaS.
  const {error}=await client.rpc("listar_opticas_superadmin_tsysoptics");
  if(error)return;
  ids.forEach(id=>{const x=document.getElementById(id);if(x)x.hidden=false;});
}
function showApp(role) {
  applyRole(role);
  finishLoading();
  root.hidden = true;
  app.hidden = false;
  logout.hidden = false;
  notice.textContent = "";
}
function setMode(next) {
  mode = next;
  submit.textContent = next === "reset" ? "Establecer contraseña" : "Ingresar";
  emailField.closest("label").hidden = next === "reset";
  recover.hidden = next === "reset";
  change.hidden = next !== "reset";
  passwordField.autocomplete = next === "reset" ? "new-password" : "current-password";
  passwordField.value = "";
  setPasswordVisibility(false);
  message(next === "reset" ? "Define una nueva contraseña de al menos 12 caracteres." : "");
}
async function verifyUser() {
  if (mode === "reset") return;
  if (!client) {
    locked("Configuración pendiente: falta establecer la clave publicable de Supabase.");
    submit.disabled = true;
    return;
  }
  // En una navegación entre módulos, no mostrar el formulario de login
  // mientras Supabase recupera la sesión persistida.
  const { data: userResult, error: authError } = await client.auth.getUser();
  const user = userResult?.user;
  if (authError || !user) { currentUserId = null; locked("Ingresa con el correo y la contraseña de TsysOptics."); return; }
  currentUserId = user.id;
  // Resolución central de permisos: el mismo login sirve para todos los perfiles.
  // Las RPC verifican la pertenencia en Supabase, nunca en el navegador.
  const {error:superError}=await client.rpc("listar_opticas_superadmin_tsysoptics");
  if(!superError){
    const {data:ownProfile}=await client.from("usuarios_tsysoptics").select("rol,activo").eq("id",user.id).maybeSingle();
    if(ownProfile?.activo && ownProfile.rol==="administrador"){
      showApp("administrador");
      await actualizarAccesosSuperadmin("administrador");
      return;
    }
    window.location.replace("./admin-prototipo.html");return;
  }
  const {data:members,error:tenantError}=await client.rpc("mi_perfil_saas_tsysoptics");
  if(!tenantError){
    const member=(members||[]).find(m=>m.rol==="administrador"&&["preparacion","activa"].includes(m.estado));
    if(member){
      window.location.replace(member.estado==="activa"?"./panel-cliente.html":"./mi-optica.html");
      return;
    }
  }
  const { data: profile, error } = await client
    .from("usuarios_tsysoptics")
    .select("id,rol,activo")
    .eq("id",user.id)
    .maybeSingle();
  if(error){locked("No se pudo verificar el perfil.");return;}
  if(!profile?.activo || !ALLOWED_ROLES.has(profile.rol) || (profile.rol==="externo"&&user.email?.toLowerCase()!==EXTERNAL_EMAIL)){
    locked("Esta cuenta no tiene un acceso activo asignado.");return;
  }
  showApp(profile.rol);
  if(profile.rol==="administrador" && user.email?.toLowerCase()==="jonierramos23@gmail.com"){
    // El servidor comprueba correo verificado, perfil activo y ausencia de otro superadministrador.
    // El frontend no puede conceder privilegios por sí solo.
    await client.rpc("activar_superadmin_inicial_tsysoptics");
  }
  await actualizarAccesosSuperadmin(profile.rol);
}
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!client || processing) return;
  const password = passwordField.value;
  if (mode === "reset" && password.length < 12) { message("Usa al menos 12 caracteres."); return; }
  processing = true; submit.disabled = true; message("Procesando…");
  try {
    if (mode === "reset") {
      const { error } = await client.auth.updateUser({ password });
      if (error) throw error;
      setMode("login");
      await client.auth.signOut();
      locked("Contraseña actualizada. Ingresa para continuar.");
    } else {
      const typedUser = emailField.value.trim();
      const loginEmail = typedUser.toLowerCase() === EXTERNAL_ALIAS ? EXTERNAL_EMAIL : typedUser;
      const { error } = await client.auth.signInWithPassword({ email: loginEmail, password });
      if (error) throw error;
      passwordField.value = "";
      setPasswordVisibility(false);
      await verifyUser();
    }
  } catch (e) {
    const msg=String(e?.message||"");
    if(/invalid login credentials/i.test(msg))message("Supabase rechazó el correo o la contraseña. Tu cuenta no fue eliminada. Comprueba que seleccionaste la cuenta principal y que el navegador no autocompletó una clave anterior.");
    else if(e?.status===429||/rate limit|too many requests/i.test(msg))message("Supabase ha limitado temporalmente los intentos. Espera antes de volver a probar.");
    else if(/email not confirmed/i.test(msg))message("El correo todavía no está confirmado.");
    else message("No se pudo iniciar sesión. Error de autenticación: "+(e?.status||"servicio no disponible")+".");
  }
  finally { processing = false; submit.disabled = !client; }
});
recover.addEventListener("click", () => { window.location.assign("./recuperar.html"); });
change.addEventListener("click", async () => {
  if (client) await client.auth.signOut();
  setMode("login"); locked("Ingresa con tu contraseña actualizada.");
});
logout.addEventListener("click", async () => {
  if (client) await client.auth.signOut();
  currentUserId = null; setMode("login"); locked("Sesión cerrada.");
});
if (client) {
  client.auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY") {
      setMode("reset"); locked();
    } else if (event === "SIGNED_OUT") {
      currentUserId = null; locked();
    }
  });
}
await verifyUser();
