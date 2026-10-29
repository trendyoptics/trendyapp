/* Navegación inferior persistente en páginas independientes de TsysOptics.
   Disponible sólo tras validar la sesión; nunca sustituye la autorización de Supabase. */
import {createClient} from "https://esm.sh/@supabase/supabase-js@2";
import {SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY} from "./supabase-config.js";
const db=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{
 auth:{flowType:"pkce",autoRefreshToken:true,persistSession:true,detectSessionInUrl:true}
});
const currentPage=location.pathname.endsWith("/pacientes.html")?"pacientes":
 location.pathname.endsWith("/devoluciones.html")?"devoluciones":null;
if(currentPage){
 const css=document.createElement("link");
 css.rel="stylesheet";
 css.href=new URL("./movil.css?v=20261029f",import.meta.url).href;
 document.head.append(css);
 document.body.classList.add("tsys-mobile-subpage");
 const icons={
  inicio:'<path d="m3 10 9-7 9 7v11H3z"/><path d="M9 21v-7h6v7"/>',
  pacientes:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  agenda:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/>',
  ventas:'<path d="M3 5h2l2 12h12l2-9H6M8 21h.01M18 21h.01"/>',
  caja:'<rect x="2" y="6" width="20" height="15" rx="2"/><path d="M2 10h20M17 16h2"/>',
  mas:'<path d="M4 7h16M4 12h16M4 17h16"/>',
  inventario:'<path d="m12 2 9 5-9 5-9-5zM3 7v10l9 5 9-5V7M12 12v10"/>',
  simulador:'<circle cx="8" cy="12" r="4"/><circle cx="17" cy="12" r="4"/><path d="M12 12h1M3 12H2m19 0h1"/>',
  apariencia:'<path d="M12 2a10 10 0 0 0 0 20c2 0 3-2 3-4s1-3 3-3h1a3 3 0 0 0 3-3A10 10 0 0 0 12 2Z"/>',
  devoluciones:'<path d="M3 11a9 9 0 1 0 3-6M3 4v7h7"/>',
  clinica:'<path d="M12 3v18M3 12h18"/>'
 };
 const all=[
  ["inicio","Inicio"],["pacientes","Pacientes"],["ventas","Ventas"],["caja","Caja"],
  ["agenda","Agenda"],["inventario","Inventario"],["simulador","Simulador"],
  ["apariencia","Apariencia"],["devoluciones","Notas internas"],["clinica","Clínica"]
 ];
 const draw=key=>'<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">'+icons[key]+'</svg>';
 const dock=document.createElement("nav");
 dock.className="tsys-mobile-dock";dock.hidden=true;
 dock.setAttribute("aria-label","Navegación de TsysOptics");
 const shade=document.createElement("div");
 shade.className="tsys-mobile-backdrop";shade.hidden=true;
 const sheet=document.createElement("section");
 sheet.className="tsys-mobile-sheet";sheet.hidden=true;
 sheet.setAttribute("role","dialog");sheet.setAttribute("aria-label","Más módulos");
 const heading=document.createElement("h2");heading.textContent="Más módulos";
 const options=document.createElement("div");options.className="tsys-mobile-options";
 sheet.append(heading,options);
 document.body.append(dock,shade,sheet);
 let more=null,role=null;
 function close(){sheet.hidden=true;shade.hidden=true;if(more)more.setAttribute("aria-expanded","false")}
 function route(id){
  close();
  if(id===currentPage){window.scrollTo(0,0);return}
  if(id==="clinica"){
   window.location.assign("../index.html");return;
  }
  if(id==="pacientes"||id==="devoluciones"){
   window.location.assign("./"+id+".html");return;
  }
  if(role!=="administrador"&&["inventario","ventas","caja"].includes(id))return;
  window.location.assign("./?modulo="+encodeURIComponent(id));
 }
 function button(id,label){
  const b=document.createElement("button");
  b.type="button";b.setAttribute("aria-label",label);
  b.innerHTML=draw(id)+"<span>"+label+"</span>";
  if(id===currentPage){b.classList.add("active");b.setAttribute("aria-current","page")}
  if(id==="mas"){
   more=b;b.setAttribute("aria-expanded","false");
   b.addEventListener("click",()=>{
    const show=sheet.hidden;sheet.hidden=!show;shade.hidden=!show;
    b.setAttribute("aria-expanded",String(show));
   });
  }else b.addEventListener("click",()=>route(id));
  return b;
 }
 function render(){
  const list=role==="administrador"
   ?["inicio","pacientes","ventas","caja","mas"]
   :["inicio","pacientes","agenda","clinica","mas"];
  dock.replaceChildren();options.replaceChildren();
  for(const id of list){
   dock.append(button(id,id==="mas"?"Más":all.find(x=>x[0]===id)?.[1]||id));
  }
  for(const [id,label] of all){
   if(list.includes(id))continue;
   if(role!=="administrador"&&["inventario","ventas","caja","devoluciones"].includes(id))continue;
   options.append(button(id,label));
  }
  dock.hidden=false;
 }
 shade.addEventListener("click",close);
 document.addEventListener("keydown",e=>{if(e.key==="Escape")close()});
 try{history.scrollRestoration="manual"}catch{}
 // Evitar que Safari conserve el scroll alto del panel al entrar en Pacientes.
 if(!location.hash)window.requestAnimationFrame(()=>window.scrollTo(0,0));
 async function init(){
  const {data,error}=await db.auth.getUser();
  if(error||!data?.user)return;
  const {data:profile,error:profileError}=await db.from("usuarios_tsysoptics")
   .select("rol,activo").eq("id",data.user.id).maybeSingle();
  if(profileError||profile?.activo!==true)return;
  if(currentPage==="devoluciones"&&profile.rol!=="administrador")return;
  role=profile.rol;
  render();
 }
 void init();
}
