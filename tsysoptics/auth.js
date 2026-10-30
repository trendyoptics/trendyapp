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
    const isLocked = restricted && ["ventas", "inventario", "caja", "laboratorio", "informes"].includes(section);
    if ("disabled" in element) element.disabled = isLocked;
    element.classList.toggle("role-locked", isLocked);
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
  const { data: profile, error } = await client
    .from("usuarios_tsysoptics")
    .select("id,rol,activo")
    .eq("id", user.id)
    .maybeSingle();
  if (error) { locked("No se pudo validar tu perfil. Comprueba la conexión y la política de acceso."); return; }
  if (!profile?.activo || !ALLOWED_ROLES.has(profile.rol) || (profile.rol === "externo" && user.email?.toLowerCase() !== EXTERNAL_EMAIL)) {
    locked("La cuenta existe, pero aún no tiene permiso para este panel piloto.");
    return;
  }
  showApp(profile.rol);
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
  } catch (e) { message("No se pudo completar la operación. Verifica tus credenciales y prueba de nuevo."); }
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
