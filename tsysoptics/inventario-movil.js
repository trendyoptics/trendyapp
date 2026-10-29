/* TsysOptics · Inventario táctil. Solo interfaz; todas las escrituras siguen
   bajo las mismas validaciones y permisos de inventario.js / Supabase. */
(()=>{
 "use strict";
 const page=document.getElementById("inventario");
 const catalog=document.getElementById("lista-productos");
 const search=document.getElementById("inventario-buscar");
 const createForm=document.getElementById("form-producto");
 const adjustForm=document.getElementById("inventario-ajuste-form");
 const history=document.getElementById("inventario-movimientos");
 if(!page||!catalog||!search||!createForm||!adjustForm||!history)return;
 const media=window.matchMedia("(max-width: 850px)");
 const style=document.createElement("link");
 style.rel="stylesheet";
 style.href=new URL("./inventario-movil.css?v=20261029a",import.meta.url).href;
 document.head.append(style);
 const el=(tag,cls,text)=>{
  const node=document.createElement(tag);
  if(cls)node.className=cls;
  if(text!==undefined)node.textContent=text;
  return node;
 };
 const catalogCard=catalog.closest(".card");
 const movementsCard=history.closest(".card");
 if(!catalogCard||!movementsCard)return;
 catalogCard.classList.add("tsys-inv-catalog-card");
 createForm.classList.add("tsys-inv-create-card");
 adjustForm.classList.add("tsys-inv-adjust-card");
 movementsCard.classList.add("tsys-inv-movements-card");
 const firstCols=createForm.closest(".cols");
 const tabs=el("nav","tsys-inv-tabs");
 tabs.id="tsys-inv-tabs";
 tabs.setAttribute("role","tablist");
 tabs.setAttribute("aria-label","Secciones del inventario");
 const definitions=[
  ["catalogo","Catálogo","list"],
  ["nuevo","Nueva","plus"],
  ["ajustar","Ajustar","adjust"],
  ["movimientos","Movimientos","history"]
 ];
 const icons={
  list:'<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/>',
  plus:'<path d="M12 4v16M4 12h16"/>',
  adjust:'<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2"/><circle cx="15" cy="17" r="2"/>',
  history:'<path d="M3 11a9 9 0 1 0 3-6M3 4v7h7M12 7v5l3 2"/>'
 };
 const buttons=new Map();
 for(const [id,label,icon] of definitions){
  const b=el("button","tsys-inv-tab");
  b.type="button";
  b.dataset.tab=id;
  b.setAttribute("role","tab");
  b.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+icons[icon]+"</svg>";
  b.append(el("span",null,label));
  b.addEventListener("click",()=>setTab(id));
  tabs.append(b);
  buttons.set(id,b);
 }
 tabs.addEventListener("keydown",event=>{
  if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;
  const seq=definitions.map(x=>x[0]);
  let i=seq.indexOf(page.dataset.tsysInvTab);
  if(event.key==="ArrowLeft")i=(i+seq.length-1)%seq.length;
  if(event.key==="ArrowRight")i=(i+1)%seq.length;
  if(event.key==="Home")i=0;
  if(event.key==="End")i=seq.length-1;
  setTab(seq[i]);buttons.get(seq[i]).focus();event.preventDefault();
 });
 function setTab(tab){
  if(!buttons.has(tab))return;
  page.dataset.tsysInvTab=tab;
  for(const [key,b] of buttons){
   const active=key===tab;
   b.classList.toggle("is-active",active);
   b.setAttribute("aria-selected",String(active));
   b.tabIndex=active?0:-1;
  }
 }
 window.tsysInventarioMobileTab=tab=>{
  if(!media.matches)return;
  setTab(tab);
  tabs.scrollIntoView({behavior:"smooth",block:"start"});
 };
 firstCols?.before(tabs);
 setTab("catalogo");

 const dashboard=el("div","tsys-inv-summary");
 dashboard.id="tsys-inv-summary";
 dashboard.setAttribute("aria-label","Estado de inventario");
 const cards=[
  ["total","Referencias"],
  ["alert","Stock bajo"],
  ["empty","Agotadas"],
  ["inactive","Inactivas"]
 ];
 const valueNodes=new Map();
 for(const [key,label] of cards){
  const item=el("div","tsys-inv-metric tsys-inv-metric-"+key);
  const caption=el("small",null,label);
  const value=el("strong",null,"0");
  value.dataset.metric=key;
  item.append(caption,value);
  dashboard.append(item);
  valueNodes.set(key,value);
 }
 tabs.before(dashboard);
 window.addEventListener("tsys:inventario-resumen",event=>{
  const d=event.detail||{};
  for(const [key,value] of valueNodes)value.textContent=String(Math.max(0,Number(d[key])||0));
 });

 const filterWrap=el("div","tsys-inv-filters");
 filterWrap.setAttribute("role","group");
 filterWrap.setAttribute("aria-label","Filtrar referencias");
 const filters=[
  ["todos","Todas"],
  ["alerta","Stock bajo"],
  ["agotadas","Agotadas"],
  ["inactivas","Inactivas"]
 ];
 const filterButtons=new Map();
 let currentFilter="todos";
 for(const [key,label] of filters){
  const b=el("button","tsys-inv-filter",label);
  b.type="button";
  b.setAttribute("aria-pressed",key==="todos"?"true":"false");
  b.addEventListener("click",()=>{
   currentFilter=key;
   updateFilterButtons();
   window.tsysInventarioMobileFilter?.(key);
  });
  filterWrap.append(b);
  filterButtons.set(key,b);
 }
 function updateFilterButtons(){
  for(const [key,b] of filterButtons){
   const active=key===currentFilter;
   b.classList.toggle("is-active",active);
   b.setAttribute("aria-pressed",String(active));
  }
 }
 const catalogHeader=catalogCard.querySelector("h2");
 if(catalogHeader)catalogHeader.after(filterWrap);
 // El campo original de búsqueda y su botón Actualizar siguen utilizándose.
 search.setAttribute("inputmode","search");
 search.setAttribute("autocomplete","off");
 search.setAttribute("aria-label","Buscar referencia por código o nombre");
 if(!search.placeholder)search.placeholder="Código o nombre";
 window.tsysInventarioMobileReset=()=>{
  currentFilter="todos";
  updateFilterButtons();
  setTab("catalogo");
 };
 window.addEventListener("tsys:inventario-buscar",event=>{
  const total=event.detail?.visible;
  if(typeof total==="number")filterWrap.setAttribute("aria-label",
   "Filtrar referencias. "+total+" resultados visibles.");
 });

 // Acción rápida desde el resumen (solo muestra las referencias con alerta).
 for(const key of ["alert","empty"]){
  const metric=valueNodes.get(key)?.parentElement;
  if(!metric)continue;
  metric.setAttribute("role","button");
  metric.setAttribute("tabindex","0");
  metric.setAttribute("aria-label",
   key==="alert"?"Filtrar referencias con stock bajo":"Mostrar referencias agotadas");
  const handle=()=>{
   currentFilter=key==="alert"?"alerta":"agotadas";
   updateFilterButtons();
   window.tsysInventarioMobileFilter?.(currentFilter);
   window.tsysInventarioMobileTab?.("catalogo");
  };
  metric.addEventListener("click",handle);
  metric.addEventListener("keydown",event=>{
   if(event.key==="Enter"||event.key===" "){event.preventDefault();handle()}
  });
 }
})();
