import {createClient} from "https://esm.sh/@supabase/supabase-js@2";
import {SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY} from "./supabase-config.js";
const db=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{flowType:"pkce",persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const $=id=>document.getElementById("devoluciones-"+id);
const cop=n=>new Intl.NumberFormat("es-CO",{style:"currency",currency:"COP",maximumFractionDigits:0}).format(Number(n)||0);
const node=(tag,text)=>{const el=document.createElement(tag);el.textContent=text;return el};
let admin=false,loading=false,saving=false,selected=null,token=crypto.randomUUID();
const status=t=>$("mensaje").textContent=t;
function reset(){admin=false;selected=null;$("contenido").hidden=true;$("form").hidden=true;$("ventas-lista").replaceChildren();$("historial").replaceChildren();status("Acceso reservado al administrador.");}
async function authorize(){
 const {data,error}=await db.auth.getUser();if(error||!data?.user)return false;
 const {data:profile,error:pe}=await db.from("usuarios_tsysoptics").select("rol,activo").eq("id",data.user.id).maybeSingle();
 return !pe&&profile?.rol==="administrador"&&profile?.activo===true;
}
function closeForm(){if(saving)return;selected=null;$("form").hidden=true;$("form").reset();$("sin-seleccion").hidden=false;$("resultado").textContent="";}
function choose(sale){
 if(!admin||saving)return;
 selected=sale;token=crypto.randomUUID();$("form").reset();$("resultado").textContent="";
 $("resumen").textContent="Venta V-"+String(sale.numero).padStart(6,"0")+" · Total "+cop(sale.total)+" · Reembolsado previamente: "+cop(sale.abonado)+" · Saldo por cancelar "+cop(sale.saldo)+". Medios registrados: "+(sale.pagos||[]).map(p=>p.medio+" "+cop(p.monto)).join(", ");
 $("form").hidden=false;$("sin-seleccion").hidden=true;$("form").scrollIntoView({block:"nearest",behavior:"smooth"});
}
function renderSales(list,open){
 const root=$("ventas-lista");root.replaceChildren();
 if(!list.length){root.append(node("p","No hay ventas elegibles para devolución completa."));return;}
 for(const sale of list){
  const row=node("div","");row.className="item";
  const details=node("div","");details.append(node("strong","Venta V-"+String(sale.numero).padStart(6,"0")+" · "+cop(sale.total)));
  details.append(node("p","Pagado "+cop(sale.abonado)+" · Saldo "+cop(sale.saldo)+" · "+(sale.lineas||[]).map(x=>x.codigo_snapshot+" × "+x.cantidad).join(", ")));
  const btn=node("button",open?"Preparar devolución":"Abrir Caja");btn.type="button";btn.disabled=!open;
  btn.addEventListener("click",()=>choose(sale));row.append(details,btn);root.append(row);
 }
}
function renderHistory(list){
 const root=$("historial");root.replaceChildren();
 if(!list.length){root.append(node("p","Todavía no hay devoluciones registradas."));return;}
 for(const n of list){
  const row=node("div","");row.className="item";
  const info=node("div","");info.append(node("strong","Nota interna NCI-V-"+String(n.numero_venta).padStart(6,"0")+" · "+cop(n.monto_reembolsado)));
  info.append(node("p",new Date(n.fecha).toLocaleString("es-CO",{timeZone:"America/Bogota"})+" · "+n.motivo+" · "+(n.reintegro_stock?"Inventario reintegrado":"Sin reintegro de inventario")));
  const details=node("p","Medios: "+((n.medios||[]).map(x=>x.medio+" "+cop(x.monto)).join(", ")||"No registrados")+" · Saldo cancelado: "+cop(n.saldo_condonado));
  details.className="muted";info.append(details);
  if(n.reintegro_stock){const stock=node("p","Reingreso: "+((n.detalle_inventario||[]).map(x=>x.codigo+" × "+x.cantidad).join(", ")||"Consultar movimientos de inventario"));stock.className="muted";info.append(stock);}
  row.append(info);root.append(row);
 }
}
async function load(){
 if(loading||!admin)return;loading=true;status("Consultando ventas, Caja y devoluciones…");
 try{
  const [sales,shift,notes]=await Promise.all([
   db.from("ventas_tsysoptics").select("id,numero,total,abonado,saldo,estado,pagos:pagos_ventas_tsysoptics(medio,monto),lineas:detalle_ventas_tsysoptics(codigo_snapshot,cantidad)").eq("estado","emitida").gt("abonado",0).order("fecha",{ascending:false}).limit(100),
   db.rpc("resumen_turno_caja_tsysoptics"),
   db.from("devoluciones_ventas_tsysoptics").select("id,numero_venta,fecha,motivo,monto_reembolsado,saldo_condonado,reintegro_stock,detalle_inventario,medios:reembolsos_medios_tsysoptics(medio,monto)").order("fecha",{ascending:false}).limit(40)
  ]);
  if(sales.error||shift.error||notes.error){status("No fue posible consultar las devoluciones. Revisa tu sesión y conexión.");return;}
  const open=Array.isArray(shift.data)&&shift.data[0]?.estado==="abierta";
  renderSales(sales.data||[],open);renderHistory(notes.data||[]);
  if(!open)closeForm();
  status(open?"Caja abierta. Documenta únicamente reembolsos que ya se realizaron.":"Caja cerrada. Abre un turno en Caja para registrar devoluciones.");
 }catch(e){status("Error de conexión al consultar devoluciones.");console.error(e)}
 finally{loading=false}
}
async function boot(){
 if(admin)return;
 if(!(await authorize())){reset();return;}
 admin=true;$("contenido").hidden=false;void load();
}
$("actualizar").addEventListener("click",()=>void load());
$("cancelar").addEventListener("click",closeForm);
$("form").addEventListener("submit",async event=>{
 event.preventDefault();if(!admin||saving||!selected)return;
 const motivo=$("motivo").value.trim();
 if(motivo.length<10||motivo.length>300||!$("confirmado").checked){$("resultado").textContent="Debes escribir un motivo válido y confirmar el reembolso efectuado.";return;}
 if(!window.confirm("¿Documentar la devolución íntegra de esta venta? Esta operación no devuelve dinero automáticamente y no puede deshacerse."))return;
 saving=true;$("guardar").disabled=true;$("cancelar").disabled=true;$("resultado").textContent="Registrando devolución…";
 try{
  const {data,error}=await db.rpc("devolver_venta_tsysoptics",{p_venta_id:selected.id,p_motivo:motivo,p_reintegra_stock:$("reintegrar").checked,p_reembolso_confirmado:true,p_operacion_id:token});
  if(error||!data){$("resultado").textContent="No se pudo confirmar la devolución. Revisa el historial antes de volver a intentarlo.";return;}
  token=crypto.randomUUID();selected=null;$("form").hidden=true;$("form").reset();$("sin-seleccion").hidden=false;
  $("resultado").textContent="Devolución registrada. Consulta el historial.";
  window.dispatchEvent(new Event("tsys:ventas-actualizadas"));window.dispatchEvent(new Event("tsys:inventario-refrescar"));
  await load();
 }catch{$("resultado").textContent="No se pudo confirmar el resultado. Revisa el historial antes de repetir."}
 finally{saving=false;$("guardar").disabled=false;$("cancelar").disabled=false}
});
window.addEventListener("tsys:role",e=>{if(e.detail?.role==="administrador")void boot();else reset()});
window.addEventListener("tsys:locked",reset);
document.querySelectorAll('[data-page="devoluciones"]').forEach(btn=>btn.addEventListener("click",()=>{if(admin)void load();else void boot()}));
void boot();
