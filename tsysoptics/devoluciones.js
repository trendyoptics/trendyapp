import {createClient} from "https://esm.sh/@supabase/supabase-js@2";
import {SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY} from "./supabase-config.js";

const db=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{
 auth:{flowType:"pkce",persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
});
const $=id=>document.getElementById(id);
const money=n=>new Intl.NumberFormat("es-CO",{style:"currency",currency:"COP",maximumFractionDigits:2}).format(Number(n)||0);
const name=n=>"V-"+String(n).padStart(6,"0");
const labels={efectivo:"Efectivo",transferencia:"Transferencia",nequi:"Nequi",daviplata:"Daviplata",tarjeta:"Tarjeta",otro:"Otro"};
let admin=false,loading=false,saving=false,selected=null,token=crypto.randomUUID();
const msg=text=>$("estado").textContent=text;
const make=(tag,text)=>{const node=document.createElement(tag);if(text!=null)node.textContent=String(text);return node};

async function verify(){
 const {data,error}=await db.auth.getUser();
 if(error||!data?.user)return false;
 const {data:profile,error:pe}=await db.from("usuarios_tsysoptics")
  .select("rol,activo").eq("id",data.user.id).maybeSingle();
 return !pe&&profile?.rol==="administrador"&&profile?.activo===true;
}
function cashOpen(response){
 return Array.isArray(response?.data)&&response.data[0]?.estado==="abierta";
}
function sumByMethod(pagos){
 const by={};
 for(const p of pagos||[]){
  const method=p.medio||"otro";
  by[method]=(by[method]||0)+Number(p.monto);
 }
 return by;
}
function closeForm(){
 if(saving)return;
 selected=null;$("edit").hidden=true;$("form").reset();$("resultado").textContent="";
}
function chooseSale(sale){
 if(!admin||saving)return;
 selected=sale;
 token=crypto.randomUUID();
 $("form").reset();
 $("resultado").textContent="";
 $("resumen").textContent="Venta "+name(sale.numero)+" · Valor original "+money(sale.total)+
  " · Dinero a reembolsar "+money(sale.abonado)+
  " · Saldo pendiente a cancelar "+money(sale.saldo)+".";
 const region=$("medios");
 region.replaceChildren();
 region.append(make("strong","Medios y valores que debieron reembolsarse:"));
 const by=sumByMethod(sale.pagos);
 for(const [medio,importe] of Object.entries(by)){
  const row=make("div");row.className="item";
  row.append(make("span",labels[medio]||medio),make("strong",money(importe)));
  region.append(row);
 }
 $("edit").hidden=false;
 $("edit").scrollIntoView({behavior:"smooth",block:"start"});
}
function showNote(note){
 $("nota-codigo").textContent="Nota NCI-"+name(note.numero_venta)+" · Operación completa";
 $("nota-fecha").textContent="Fecha de registro: "+new Date(note.fecha).toLocaleString("es-CO",{timeZone:"America/Bogota"});
 $("nota-motivo").textContent="Motivo: "+note.motivo;
 $("nota-importe").textContent="Valor reembolsado: "+money(note.monto_reembolsado)+
  " · Saldo pendiente cancelado: "+money(note.saldo_condonado);
 $("nota-detalle").textContent="Medios registrados: "+(note.medios||[]).map(x=>
  (labels[x.medio]||x.medio)+" "+money(x.monto)).join(" | ");
 $("nota-stock").textContent=note.reintegro_stock
  ?"Inventario reintegrado: "+(note.detalle_inventario||[]).map(x=>x.codigo+" × "+x.cantidad).join(", ")
  :"Mercancía no reintegrada al inventario.";
 $("nota-vista").hidden=false;
 $("nota-vista").scrollIntoView({behavior:"smooth",block:"start"});
}
$("nota-cerrar").addEventListener("click",()=>{$("nota-vista").hidden=true});
$("nota-imprimir").addEventListener("click",()=>window.print());
function renderNotes(items){
 const root=$("notas");root.replaceChildren();
 if(!items?.length){root.append(make("p","Todavía no hay devoluciones registradas."));return}
 for(const item of items){
  const row=make("div");row.className="item";
  const info=make("div");
  info.append(make("strong","NCI-"+name(item.numero_venta)+" · "+money(item.monto_reembolsado)));
  const desc=make("p",new Date(item.fecha).toLocaleString("es-CO",{timeZone:"America/Bogota"})+" · "+
   (item.reintegro_stock?"Con reintegro de inventario":"Sin reintegro de inventario"));
  desc.className="muted";info.append(desc);
  const button=make("button","Ver nota");
  button.className="secondary";button.addEventListener("click",()=>showNote(item));
  row.append(info,button);root.append(row);
 }
}
function render(list,open){
 const root=$("ventas");root.replaceChildren();
 const available=(list||[]).filter(x=>x.estado==="emitida"&&Number(x.abonado)>0);
 if(!available.length){root.append(make("p","No hay ventas pagadas que puedan devolverse."));return}
 for(const sale of available){
  const row=make("div");row.className="item";
  const info=make("div");
  info.append(make("strong",name(sale.numero)+" · "+money(sale.total)));
  const itemText=(sale.lineas||[]).map(p=>p.codigo_snapshot+" × "+p.cantidad).join(", ");
  const sub=make("p",itemText+" · Recaudado "+money(sale.abonado)+" · Por cobrar "+money(sale.saldo));
  sub.className="muted";info.append(sub);
  const button=make("button","Preparar devolución");
  button.disabled=!open;
  button.addEventListener("click",()=>chooseSale(sale));
  row.append(info,button);root.append(row);
 }
}
async function load(){
 if(!admin||loading)return;
 loading=true;msg("Consultando ventas y turno de caja…");
 try{
  const [sales,shift,notes]=await Promise.all([
   db.from("ventas_tsysoptics")
    .select("id,numero,total,abonado,saldo,estado,pagos:pagos_ventas_tsysoptics(medio,monto),lineas:detalle_ventas_tsysoptics(codigo_snapshot,cantidad)")
    .eq("estado","emitida").gt("abonado",0).order("fecha",{ascending:false}).limit(100),
   db.rpc("resumen_turno_caja_tsysoptics"),
   db.from("devoluciones_ventas_tsysoptics")
    .select("id,numero_venta,fecha,motivo,monto_reembolsado,saldo_condonado,reintegro_stock,detalle_inventario,medios:reembolsos_medios_tsysoptics(medio,monto)")
    .order("fecha",{ascending:false}).limit(40)
  ]);
  if(sales.error||shift.error||notes.error){
   msg("No fue posible consultar las ventas, Caja o el historial de devoluciones.");return;
  }
  const open=cashOpen(shift);
  msg(open
   ?"Turno de caja abierto. Puedes registrar una devolución manual ya realizada."
   :"Caja cerrada. Abre un turno en Caja antes de documentar devoluciones.");
  render(sales.data||[],open);
  renderNotes(notes.data||[]);
  if(!open)closeForm();
 }catch{msg("Error de conexión. Comprueba tu sesión y vuelve a cargar la página.")}
 finally{loading=false}
}
$("actualizar").addEventListener("click",load);
$("cancelar").addEventListener("click",closeForm);
$("form").addEventListener("submit",async event=>{
 event.preventDefault();
 if(!admin||saving||!selected)return;
 const reason=$("motivo").value.trim();
 const confirmed=$("confirmado").checked;
 const restock=$("reintegrar").checked;
 if(reason.length<10||reason.length>300||!confirmed){
  $("resultado").textContent="Debes escribir el motivo y confirmar que el reembolso ya ocurrió.";
  return;
 }
 if(!window.confirm("¿Registrar la devolución íntegra de "+name(selected.numero)+
  "? El dinero debe haberse devuelto antes por fuera del sistema. Esta operación no se puede deshacer."))return;

 saving=true;$("guardar").disabled=true;$("cancelar").disabled=true;
 $("resultado").textContent="Registrando nota crédito interna…";
 try{
  const {data,error}=await db.rpc("devolver_venta_tsysoptics",{
   p_venta_id:selected.id,
   p_motivo:reason,
   p_reintegra_stock:restock,
   p_reembolso_confirmado:true,
   p_operacion_id:token
  });
  if(error||!data){
   const detail=String(error?.message||"");
   $("resultado").textContent=detail.includes("efectivo suficiente")
    ?"No hay suficiente efectivo en el turno para cubrir este reembolso."
    :detail.includes("ya fue anulada o devuelta")
    ?"Esta venta ya se encuentra anulada o devuelta. Actualiza el listado."
    :detail.includes("abrir un turno")
    ?"Debes abrir un turno antes de registrar la devolución."
    :"No se confirmó la operación. Revisa la lista antes de reintentar.";
   return;
  }
  token=crypto.randomUUID();
  const saleNo=name(selected.numero);
  closeFormForced();
  await load();
  msg("Nota crédito interna registrada para "+saleNo+
   ". Reembolsos y existencias documentados en Supabase.");
 }catch{
  $("resultado").textContent="No se pudo confirmar la devolución. Actualiza el listado antes de reintentar.";
 }finally{saving=false;$("guardar").disabled=false;$("cancelar").disabled=false}
});
function closeFormForced(){
 selected=null;$("edit").hidden=true;$("form").reset();$("resultado").textContent="";
}
async function boot(){
 try{
  if(!(await verify())){msg("Acceso restringido: inicia sesión como administrador en TsysOptics.");return}
  admin=true;$("app").hidden=false;
  await load();
 }catch{msg("No se pudo validar la sesión. Accede nuevamente al panel principal.")}
}
void boot();
