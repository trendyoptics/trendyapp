import {createClient} from "https://esm.sh/@supabase/supabase-js@2";
import {SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY} from "./supabase-config.js";
import {generateLabOrderPdf,downloadLabPdf} from "./orden-laboratorio-pdf.js?v=1";
const db=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{
 auth:{flowType:"pkce",persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
});
const $=id=>document.getElementById(id);
const form=$("lab-form"),status=(id,text)=>{$(id).textContent=text};
const labels={pendiente:"Pendiente",en_fabricacion:"En fabricación",recibido:"Recibido",
 listo_para_entrega:"Listo para entrega",entregado:"Entregado",cancelado:"Cancelado"};
const next={pendiente:["en_fabricacion","cancelado"],en_fabricacion:["recibido","cancelado"],
 recibido:["listo_para_entrega"],listo_para_entrega:["entregado"],entregado:[],cancelado:[]};
let authorized=false,busy=false,orders=[],sales=[],counter=0;
async function admin(){
 const {data,error}=await db.auth.getUser();if(error||!data?.user)return false;
 const {data:profile,error:pError}=await db.from("usuarios_tsysoptics")
  .select("rol,activo").eq("id",data.user.id).maybeSingle();
 return !pError&&profile?.rol==="administrador"&&profile.activo===true;
}
function clear(){
 authorized=false;orders=[];sales=[];counter++;
 $("lab-lista").replaceChildren();
 $("lab-venta").replaceChildren(new Option("Seleccionar venta",""));
 form.reset();form.querySelector("button[type=submit]").disabled=true;
 status("lab-list-status","Se requiere una sesión de administrador.");
}
function node(tag,text,className){
 const e=document.createElement(tag);if(text!==undefined)e.textContent=text;
 if(className)e.className=className;return e;
}
function formatDate(d){return d?new Date(d+"T12:00:00").toLocaleDateString("es-CO"):"Sin fecha"}
function render(){
 const root=$("lab-lista");root.replaceChildren();
 const filter=$("lab-filtro").value;
 const rows=orders.filter(o=>!filter||o.estado===filter);
 if(!rows.length){root.append(node("p","No hay órdenes para este filtro.","muted"));return}
 for(const item of rows){
  const sale=sales.find(s=>s.id===item.venta_id);
  const row=node("div",undefined,"item"),info=node("div"),actions=node("div");
  info.append(node("strong","Venta V-"+String(sale?.numero||"—").padStart(6,"0")+" · "+item.laboratorio));
  info.append(node("small","Estado: "+labels[item.estado]+" · Entrega prevista: "+formatDate(item.fecha_entrega_estimada)));
  if(item.observaciones)info.append(node("small",item.observaciones));
  if(item.fecha_recepcion)info.append(node("small","Recibido: "+formatDate(item.fecha_recepcion)));
  if(item.fecha_entrega_paciente)info.append(node("small","Entregado: "+formatDate(item.fecha_entrega_paciente)));
  const print=node("button","Orden media carta (PDF)","btn alt");
  print.type="button";print.style.margin="4px";
  print.addEventListener("click",async()=>{
   if(!authorized)return;
   print.disabled=true;
   status("lab-list-status","Preparando orden media carta…");
   try{
    if(!(await admin())){clear();return;}
    const file=await generateLabOrderPdf(db,item);
    downloadLabPdf(file);
    status("lab-list-status","Orden descargada. Imprime en papel media carta al 100 %.");
   }catch(error){
    status("lab-list-status",error?.message||"No se pudo preparar la orden.");
   }finally{print.disabled=false}
  });
  actions.append(print);
  for(const state of next[item.estado]||[]){
   const btn=node("button",labels[state],"btn alt");btn.type="button";
   btn.style.margin="4px";btn.addEventListener("click",()=>change(item,state,btn));actions.append(btn);
  }
  row.append(info,actions);root.append(row);
 }
}
async function load(){
 if(!authorized)return;
 const mine=++counter;
 status("lab-list-status","Consultando pedidos…");
 try{
  const [s,o]=await Promise.all([
   db.from("ventas_tsysoptics").select("id,numero,estado").order("fecha",{ascending:false}).limit(250),
   db.from("ordenes_laboratorio_tsysoptics").select("id,venta_id,laboratorio,fecha_entrega_estimada,fecha_recepcion,fecha_entrega_paciente,estado,observaciones,creado_en")
    .order("creado_en",{ascending:false}).limit(250)
  ]);
  if(mine!==counter||!authorized)return;
  if(s.error||o.error)throw Error("No se pudieron consultar las órdenes.");
  sales=s.data||[];orders=o.data||[];
  const current=$("lab-venta").value,ordered=new Set(orders.map(o=>o.venta_id));
  $("lab-venta").replaceChildren(new Option("Seleccionar venta",""));
  for(const sale of sales.filter(s=>s.estado==="emitida"&&!ordered.has(s.id)))
   $("lab-venta").append(new Option("V-"+String(sale.numero).padStart(6,"0"),sale.id));
  if([...$("lab-venta").options].some(x=>x.value===current))$("lab-venta").value=current;
  status("lab-list-status",orders.length+" órdenes consultadas. Puedes actualizar sus estados.");
  render();
 }catch{
  if(mine===counter)status("lab-list-status","No se pudo cargar el módulo de laboratorio. Revisa la conexión y los permisos.");
 }
}
async function change(item,state,button){
 if(busy||!authorized||!next[item.estado]?.includes(state))return;
 if(!window.confirm("¿Cambiar la orden a "+labels[state]+"?"))return;
 busy=true;button.disabled=true;
 try{
  if(!(await admin())){clear();return}
  const today=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Bogota",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const changes={estado:state,actualizado_en:new Date().toISOString()};
  if(state==="recibido")changes.fecha_recepcion=today;
  if(state==="entregado")changes.fecha_entrega_paciente=today;
  const {data,error}=await db.from("ordenes_laboratorio_tsysoptics").update(changes)
   .eq("id",item.id).eq("estado",item.estado).select("id").maybeSingle();
  if(error||!data)throw Error("No se pudo confirmar el cambio. Puede que otro usuario haya actualizado la orden.");
  await load();
 }catch(e){status("lab-list-status",e.message||"No se pudo actualizar el pedido.")}
 finally{busy=false;button.disabled=false}
}
form.addEventListener("submit",async e=>{
 e.preventDefault();if(!authorized||busy)return;
 const id=$("lab-venta").value,nombre=$("lab-nombre").value.trim().toLocaleUpperCase("es-CO");
 const date=$("lab-fecha").value,notes=$("lab-observaciones").value.trim();
 if(!id||nombre.length<3||nombre.length>120||!/^\d{4}-\d{2}-\d{2}$/.test(date)||notes.length>1000){
  status("lab-form-status","Selecciona una venta y completa laboratorio y fecha válida.");return;
 }
 if(!window.confirm("¿Crear la orden de laboratorio vinculada a esta venta?"))return;
 busy=true;$("lab-guardar").disabled=true;
 try{
  if(!(await admin())){clear();return}
  const {data,error}=await db.from("ordenes_laboratorio_tsysoptics").insert({
   venta_id:id,laboratorio:nombre,fecha_entrega_estimada:date,observaciones:notes
  }).select("id").maybeSingle();
  if(error||!data){status("lab-form-status","No se pudo crear la orden. Verifica si esa venta ya tiene pedido.");return}
  form.reset();status("lab-form-status","Orden creada correctamente y vinculada a la venta.");
  await load();
 }catch{status("lab-form-status","No se pudo confirmar el registro. Consulta los pedidos antes de repetirlo.")}
 finally{busy=false;$("lab-guardar").disabled=!authorized}
});
$("lab-filtro").addEventListener("change",render);
$("lab-actualizar").addEventListener("click",()=>void load());
window.addEventListener("tsys:locked",clear);
window.addEventListener("tsys:role",async e=>{
 authorized=e.detail?.role==="administrador"&&await admin();
 $("lab-guardar").disabled=!authorized;
 if(authorized)void load();else clear();
});
if($("tsys-app")?.dataset.role==="administrador"){
 void admin().then(ok=>{authorized=ok;$("lab-guardar").disabled=!ok;if(ok)void load()});
}
