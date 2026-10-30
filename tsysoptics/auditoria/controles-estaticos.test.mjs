/**
 * Controles de regresión ESTÁTICOS: no sustituyen pruebas de RLS ni pentest.
 * Ejecutar: node --test tsysoptics/auditoria/controles-estaticos.test.mjs
 * Sin credenciales, sin red, sin tocar bases de datos.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname,resolve} from "node:path";

const base=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const source=p=>readFileSync(resolve(base,p),"utf8");

test("La configuración web solo incorpora clave publicable y URL HTTPS",()=>{
 const conf=source("tsysoptics/supabase-config.js");
 assert.match(conf,/SUPABASE_URL\s*=\s*["']https:\/\/[a-z0-9-]+\.supabase\.co["']/);
 assert.match(conf,/SUPABASE_PUBLISHABLE_KEY\s*=\s*["']sb_publishable_[^"']+["']/);
 assert.doesNotMatch(conf,/(?:SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY)\s*=/);
 assert.doesNotMatch(conf,/(?:KEY|TOKEN|SECRET)\s*=\s*["'](?:sb_secret_|service_role)/i);
});

test("La puerta de acceso del panel valida usuario y rol en Supabase",()=>{
 const code=source("tsysoptics/auth.js");
 assert.match(code,/\.auth\.getUser\(\)/);
 assert.match(code,/\.from\("usuarios_tsysoptics"\)/);
 assert.match(code,/profile\.rol/);
 assert.match(code,/profile\?\.activo/);
 assert.match(code,/ALLOWED_ROLES\.has/);
});

test("La historia clínica principal debe tener autenticación y perfil administrador",()=>{
 const code=source("index.html");
 assert.match(code,/\.auth\.getUser\(\)/);
 assert.match(code,/\.from\("usuarios_tsysoptics"\)/);
 assert.match(code,/profile\.rol\s*!==\s*"administrador"/);
 assert.match(code,/tsys-clinica-autorizada/);
});

test("Ningún módulo comercial omite consulta de sesión o rol administrativo",()=>{
 for(const module of ["agenda.js","inventario.js","ventas.js","caja.js","laboratorio.js","informes.js"]){
  const code=source("tsysoptics/"+module);
  assert.match(code,/\.auth\.getUser\(\)/,module+" debe validar una sesión");
  assert.match(code,/administrador/,module+" debe comprobar rol");
 }
});

test("Las páginas clínicas complementarias no confían solo en ocultar botones",()=>{
 for(const page of ["pacientes.html","doctor.html","clinica-completa-demo.html"]){
  const code=source("tsysoptics/"+page);
  assert.match(code,/\.auth\.getUser\(\)/,page+" debe consultar autenticación");
  assert.match(code,/usuarios_tsysoptics/,page+" debe consultar el perfil");
 }
});

test("El navegador no incluye claves privilegiadas de Supabase",()=>{
 for(const name of [
  "index.html","tsysoptics/auth.js","tsysoptics/agenda.js","tsysoptics/inventario.js",
  "tsysoptics/ventas.js","tsysoptics/caja.js","tsysoptics/laboratorio.js",
  "tsysoptics/informes.js","tsysoptics/pacientes.html","tsysoptics/doctor.html",
  "tsysoptics/clinica-completa-demo.html"
 ]){
  const code=source(name);
  assert.doesNotMatch(code,/\bsb_secret_[A-Za-z0-9_-]{10,}\b/,name+" no debe tener clave secreta");
  assert.doesNotMatch(code,/service_role\s*[:=]\s*["'][^"']+["']/i,name+" no debe usar service_role");
 }
});

test("Los informes deben distinguir inventario actual de cifras históricas",()=>{
 const code=source("tsysoptics/informes.js");
 assert.match(code,/stockCost|stockUnits/);
 const excel=source("tsysoptics/informes-excel.js");
 assert.match(excel,/INVENTARIO ACTUAL - NO HISTÓRICO/);
 const pdf=source("tsysoptics/informes-pdf.js");
 assert.match(pdf,/fotografía ACTUAL/);
});
