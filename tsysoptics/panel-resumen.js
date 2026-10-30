import {createClient} from "https://esm.sh/@supabase/supabase-js@2";
import {SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY} from "./supabase-config.js";
const db=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{flowType:"pkce",persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const $=id=>document.getElementById(id);
const cop=n=>new Intl.NumberFormat("es-CO",{style:"currency",currency:"COP",maximumFractionDigits:0}).format(Number(n)||0);
const hoy=()=>new Intl.DateTimeFormat("sv-SE",{timeZone:"America/Bogota",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
let allowed=false,seq=0;
function set(id,value){const e=$(id);if(e)e.textContent=value}
function clear(){seq++;allowed=false;set("metric-ventas-mes","—");set("metric-citas-programadas","—");const warning=$("dashboard-alerta-stock");if(warning){warning.hidden=true;warning.textContent=""}}
async function load(){
 if(!allowed)return;
 const token=++seq;
 try{
  const today=hoy();
  const [month,appointments,stock]=await Promise.all([
   db.rpc("resumen_ventas_mes_tsysoptics"),
   db.from("citas_tsysoptics").select("id",{head:true,count:"exact"}).eq("estado","programada").gte("fecha",today),
   db.from("productos_tsysoptics").select("id,nombre,codigo",{count:"exact"}).eq("activo",true).eq("tipo","Montura").lte("cantidad",0).order("nombre").limit(5)
  ]);
  if(token!==seq||!allowed)return;
  set("metric-ventas-mes",month.error||!month.data?.[0]?"Sin datos":cop(month.data[0].total));
  set("metric-citas-programadas",appointments.error?"Sin datos":String(appointments.count??0));
  const alert=$("dashboard-alerta-stock");
  if(alert){
   if(stock.error){alert.hidden=false;alert.textContent="No se pudo comprobar el inventario de monturas.";}
   else if((stock.count??0)>0){alert.hidden=false;alert.textContent="Atención: "+stock.count+" montura(s) agotada(s). "+(stock.data||[]).map(p=>p.nombre).join(", ")+((stock.count??0)>5?" y otras.":"")+". Revisa Inventario.";}
   else{alert.hidden=true;alert.textContent="";}
  }
 }catch(e){if(token!==seq||!allowed)return;set("metric-ventas-mes","Sin datos");set("metric-citas-programadas","Sin datos");const alert=$("dashboard-alerta-stock");if(alert){alert.hidden=false;alert.textContent="No se pudo actualizar el estado del inventario."}}
}
window.addEventListener("tsys:role",async e=>{
 clear();
 if(e.detail?.role!=="administrador")return;
 const {data,error}=await db.auth.getUser();
 if(error||!data?.user)return;
 const {data:profile,error:profileError}=await db.from("usuarios_tsysoptics").select("rol,activo").eq("id",data.user.id).maybeSingle();
 if(profileError||profile?.rol!=="administrador"||!profile.activo)return;
 allowed=true;void load();
});
window.addEventListener("tsys:locked",clear);
window.addEventListener("tsys:panel-refrescar",()=>void load());
