import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./supabase-config.js";

const root = document.getElementById("auth-root");
const app = document.getElementById("tsys-app");
const notice = document.getElementById("auth-message");
const form = document.getElementById("auth-form");
const passwordField = document.getElementById("auth-password");
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
function message(text) { notice.textContent = text; }
function locked(text = "") {
  app.hidden = true;
  root.hidden = false;
  logout.hidden = true;
  if (text) message(text);
}
function showApp() {
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
  message(next === "reset" ? "Define una nueva contraseña de al menos 12 caracteres." : "");
}
async function verifyUser() {
  if (mode === "reset") return;
  if (!client) {
    locked("Configuración pendiente: falta establecer la clave publicable de Supabase.");
    submit.disabled = true;
    return;
  }
  locked("Comprobando sesión…");
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
  if (!profile?.activo || profile.rol !== "administrador") {
    locked("La cuenta existe, pero aún no tiene permiso para este panel piloto.");
    return;
  }
  showApp();
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
      const { error } = await client.auth.signInWithPassword({ email: emailField.value.trim(), password });
      if (error) throw error;
      passwordField.value = "";
      await verifyUser();
    }
  } catch (e) { message("No se pudo completar la operación. Verifica tus credenciales y prueba de nuevo."); }
  finally { processing = false; submit.disabled = !client; }
});
recover.addEventListener("click", async () => {
  if (!client || processing) return;
  const email = emailField.value.trim();
  if (!email) { message("Escribe tu correo primero."); return; }
  processing = true; recover.disabled = true;
  try {
    const { error } = await client.auth.resetPasswordForEmail(email, {
      redirectTo: location.origin + location.pathname
    });
    if (error) {
      if (error.status === 429 || error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit") {
        message("Supabase limitó temporalmente las solicitudes. Revisa primero tu correo: posiblemente ya se envió un enlace. No hagas solicitudes repetidas.");
      } else {
        message("No se pudo enviar el enlace. Comprueba tu conexión y revisa la configuración de correo en Supabase. Código: " + (error.status || "desconocido"));
      }
    } else {
      message("Solicitud aceptada. Revisa el correo y Spam. Utiliza el enlace de recuperación más reciente.");
    }
  } catch {
    message("No se pudo conectar con Supabase. Revisa la conexión a internet.");
  } finally {
    processing = false;
    recover.disabled = false;
  }
});
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
