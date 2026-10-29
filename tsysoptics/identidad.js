/* TsysOptics · identidad de la instalación.
   La marca de software "TsysOptics · by TrendyOptics" no es editable. */
import {createClient} from "https://esm.sh/@supabase/supabase-js@2";
import {SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY} from "./supabase-config.js";

const db=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{
 auth:{flowType:"pkce",autoRefreshToken:true,persistSession:true,detectSessionInUrl:true}
});
const defaultLogo=new URL("./logo.svg",import.meta.url).href;
const defaults={nombre_optica:"Trendy Optics",logo_data_url:null};
const $=id=>document.getElementById(id);
const allowedTypes=new Set(["image/png","image/jpeg","image/webp"]);
let current={...defaults},pendingLogo=null,canEdit=false,saving=false,processingImage=false;
const form=$("identidad-form");
const fieldset=$("identidad-editor");
const nameInput=$("identidad-nombre");
const fileInput=$("identidad-archivo");
const saveButton=$("identidad-guardar");
const preview=$("identidad-preview-logo");
const status=$("identidad-status");

function imageUrl(value){
 // Nunca aceptar SVG ni URLs arbitrarias provenientes de la base.
 return typeof value==="string" &&
 /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value) &&
 value.length<=210000 ? value : defaultLogo;
}
function renderBrand(){
 const name=current.nombre_optica;
 const src=imageUrl(current.logo_data_url);
 for(const img of document.querySelectorAll("[data-tsys-logo]")){
  img.src=src;
  img.alt="Logo de "+name;
 }
 for(const nameNode of document.querySelectorAll("[data-tsys-business]")){
  nameNode.textContent=name;
 }
 for(const node of document.querySelectorAll("[data-tsys-page-title]")){
  node.textContent="TsysOptics | "+name;
 }
 const patientHeader=$("identidad-pacientes-header");
 if(patientHeader)patientHeader.textContent="TsysOptics · "+name+" · by TrendyOptics";
 document.title="TsysOptics · "+name;
 window.dispatchEvent(new CustomEvent("tsys:identidad",{
  detail:{nombre_optica:name,logo_data_url:src}
 }));
}
function renderPreview(){
 if(!form)return;
 preview.src=imageUrl(pendingLogo);
 $("identidad-preview-nombre").textContent=nameInput.value.trim()||current.nombre_optica;
 $("identidad-preview-firma").textContent="TsysOptics · by TrendyOptics";
 $("identidad-archivo-actual").textContent=
  pendingLogo===null?"Logo de TsysOptics / Trendy Optics (predeterminado).":
  "Logo personalizado seleccionado.";
}
function resetEditor(){
 if(!form)return;
 nameInput.value=current.nombre_optica;
 pendingLogo=current.logo_data_url;
 fileInput.value="";
 renderPreview();
}
function togglePermissions(){
 if(fieldset)fieldset.disabled=!canEdit||saving||processingImage;
 if(saveButton)saveButton.disabled=!canEdit||saving||processingImage;
 const message=$("identidad-permisos");
 if(message)message.textContent=canEdit
  ?"Solo el administrador puede guardar cambios. El nombre y logo se comparten en esta instalación."
  :"Visualización disponible. Solo el administrador puede modificar la identidad.";
}
async function loadIdentity(){
 const {data,error}=await db.from("identidad_optica_tsysoptics")
  .select("nombre_optica,logo_data_url").eq("id",1).maybeSingle();
 if(error||!data){
  if(status)status.textContent="No se pudo consultar la identidad en Supabase. Se conserva el logo predeterminado.";
  return;
 }
 const name=String(data.nombre_optica||"").trim();
 current={
  nombre_optica:name.length>=2&&name.length<=80?name:defaults.nombre_optica,
  logo_data_url:imageUrl(data.logo_data_url)===defaultLogo?null:data.logo_data_url
 };
 renderBrand();
 resetEditor();
}
async function imageData(file){
 if(!allowedTypes.has(file.type))throw Error("El logo debe ser PNG, JPG o WebP.");
 if(file.size>3*1024*1024)throw Error("La imagen debe pesar menos de 3 MB.");
 const bmp=await createImageBitmap(file);
 try{
  const max=Math.max(bmp.width,bmp.height);
  if(max<1)throw Error("Imagen vacía.");
  for(const maxSide of [440,360,300,240,180]){
   const scale=Math.min(1,maxSide/max);
   const canvas=document.createElement("canvas");
   canvas.width=Math.max(1,Math.round(bmp.width*scale));
   canvas.height=Math.max(1,Math.round(bmp.height*scale));
   const context=canvas.getContext("2d");
   if(!context)throw Error("No se pudo procesar la imagen.");
   context.clearRect(0,0,canvas.width,canvas.height);
   context.drawImage(bmp,0,0,canvas.width,canvas.height);
   let result=canvas.toDataURL("image/webp",0.76);
   if(!result.startsWith("data:image/webp;"))result=canvas.toDataURL("image/png");
   if(result.length<=195000)return result;
  }
  throw Error("Este logo contiene demasiados detalles. Usa una imagen más sencilla.");
 }finally{bmp.close()}
}
if(form){
 togglePermissions();
 fileInput.addEventListener("change",async()=>{
  const file=fileInput.files?.[0];
  if(!file)return;
  processingImage=true;togglePermissions();
  status.textContent="Preparando imagen…";
  try{
   pendingLogo=await imageData(file);
   renderPreview();
   status.textContent="Logo listo para guardar. Todavía no se ha publicado.";
  }catch(e){
   fileInput.value="";
   status.textContent=e?.message||"No se pudo procesar el logo.";
  }finally{processingImage=false;togglePermissions()}
 });
 nameInput.addEventListener("input",renderPreview);
 $("identidad-quitar-logo").addEventListener("click",()=>{
  pendingLogo=null;fileInput.value="";renderPreview();
  status.textContent="Se mostrará el logo predeterminado cuando guardes.";
 });
 $("identidad-cancelar").addEventListener("click",()=>{
  resetEditor();status.textContent="Cambios sin guardar descartados.";
 });
 form.addEventListener("submit",async event=>{
  event.preventDefault();
  if(!canEdit||saving||processingImage)return;
  const nombre=nameInput.value.trim().replace(/\s+/g," ");
  if(nombre.length<2||nombre.length>80){
   status.textContent="El nombre debe tener entre 2 y 80 caracteres.";
   return;
  }
  saving=true;togglePermissions();status.textContent="Guardando identidad en Supabase…";
  try{
   const {data,error}=await db.from("identidad_optica_tsysoptics")
    .update({nombre_optica:nombre,logo_data_url:pendingLogo})
    .eq("id",1)
    .select("nombre_optica,logo_data_url").maybeSingle();
   if(error||!data){
    status.textContent="No se pudo guardar. Comprueba permisos y conexión.";
    return;
   }
   current={
    nombre_optica:data.nombre_optica,
    logo_data_url:imageUrl(data.logo_data_url)===defaultLogo?null:data.logo_data_url
   };
   renderBrand();resetEditor();
   status.textContent="Identidad guardada en Supabase. El cambio aparecerá en los siguientes accesos.";
  }catch{status.textContent="No fue posible guardar la identidad. Verifica la conexión."}
  finally{saving=false;togglePermissions()}
 });
}
window.addEventListener("tsys:role",e=>{
 canEdit=e.detail?.role==="administrador";togglePermissions();
});
window.addEventListener("tsys:locked",()=>{canEdit=false;togglePermissions();resetEditor()});
if($("tsys-app")?.dataset.role==="administrador"){canEdit=true;togglePermissions()}
void loadIdentity();
