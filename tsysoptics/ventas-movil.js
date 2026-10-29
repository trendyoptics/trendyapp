/* TsysOptics: flujo táctil de Ventas. Solo presentación, nunca escribe en Supabase. */
(()=>{
 "use strict";
 const page=document.getElementById("ventas");
 const form=document.getElementById("form-venta");
 const cart=document.getElementById("venta-carrito");
 const list=document.getElementById("lista-ventas");
 const paymentForm=document.getElementById("ventas-form-abono");
 const product=document.getElementById("venta-producto");
 if(!page||!form||!cart||!list||!paymentForm||!product)return;
 const media=window.matchMedia("(max-width: 850px)");
 const style=document.createElement("link");
 style.rel="stylesheet";
 style.href=new URL("./ventas-movil.css?v=20261029a",import.meta.url).href;
 document.head.append(style);

 const create=(tag,cls,text)=>{
  const x=document.createElement(tag);
  if(cls)x.className=cls;
  if(text!=null)x.textContent=text;
  return x;
 };
 const historyCard=list.closest(".card");
 const infoCard=paymentForm.parentElement?.querySelector(".card:not(#ventas-form-abono)");
 if(historyCard)historyCard.classList.add("tsys-sales-history-card");
 if(infoCard)infoCard.classList.add("tsys-sales-info-card");

 // Mantener las advertencias visibles en un bloque consultable de bajo consumo vertical.
 const title=page.querySelector("h1");
 const intro=title?.nextElementSibling;
 const second=intro?.nextElementSibling;
 if(title&&intro?.matches("p.muted")&&second?.matches("p.muted")){
  const note=create("details","tsys-sales-disclosure");
  const summary=create("summary",null,"Piloto · No sustituye la factura electrónica DIAN");
  note.append(summary,intro,second);
  title.after(note);
  const adjust=()=>{note.open=!media.matches};
  adjust();media.addEventListener("change",adjust);
 }
 const tabs=create("div","tsys-sales-tabs");
 tabs.id="tsys-ventas-nav";
 tabs.setAttribute("role","tablist");
 tabs.setAttribute("aria-label","Secciones de ventas");
 const options=[
  {id:"nueva",name:"Nueva venta",icon:"🛒",panel:"form-venta"},
  {id:"historial",name:"Historial",icon:"▤",panel:historyCard?.id||"lista-ventas"},
  {id:"abonos",name:"Abonos",icon:"＋",panel:"ventas-form-abono"}
 ];
 const buttons=new Map();
 for(const item of options){
  const b=create("button","tsys-sales-tab");
  b.type="button";
  b.dataset.tab=item.id;
  b.setAttribute("role","tab");
  b.setAttribute("aria-controls",item.panel);
  b.setAttribute("aria-label",item.name);
  const icon=create("span","tsys-sales-tab-icon",item.icon);
  icon.setAttribute("aria-hidden","true");
  const label=create("span","tsys-sales-tab-label",item.name);
  const badge=create("span","tsys-sales-tab-badge");
  badge.hidden=true;
  b.append(icon,label,badge);
  b.addEventListener("click",()=>setTab(item.id));
  tabs.append(b);
  buttons.set(item.id,{button:b,badge});
 }
 function setTab(tab){
  if(!buttons.has(tab))return;
  page.dataset.tsysMobileTab=tab;
  for(const [id,value] of buttons){
   const active=id===tab;
   value.button.classList.toggle("is-active",active);
   value.button.setAttribute("aria-selected",String(active));
   value.button.tabIndex=active?0:-1;
  }
 }
 tabs.addEventListener("keydown",event=>{
  if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;
  const sequence=options.map(x=>x.id);
  let index=sequence.indexOf(page.dataset.tsysMobileTab);
  if(event.key==="ArrowLeft")index=(index+sequence.length-1)%sequence.length;
  if(event.key==="ArrowRight")index=(index+1)%sequence.length;
  if(event.key==="Home")index=0;
  if(event.key==="End")index=sequence.length-1;
  setTab(sequence[index]);
  buttons.get(sequence[index]).button.focus();
  event.preventDefault();
 });
 page.querySelector(".venta-resumen")?.before(tabs);
 setTab("nueva");
 window.tsysVentasMobileTab=tab=>{
  if(!media.matches)return;
  setTab(tab);
  tabs.scrollIntoView({behavior:"smooth",block:"start"});
 };

 // Filtro de referencias, sin alterar el catálogo en Supabase.
 const productSearch=create("div","tsys-sales-product-search");
 productSearch.id="tsys-ventas-product-search";
 const filterLabel=create("label",null,"Buscar montura o referencia");
 filterLabel.htmlFor="tsys-ventas-product-query";
 const filterInput=create("input");
 filterInput.id="tsys-ventas-product-query";
 filterInput.type="search";
 filterInput.autocomplete="off";
 filterInput.placeholder="Código o nombre de la referencia";
 filterInput.setAttribute("aria-describedby","tsys-ventas-product-results");
 filterInput.maxLength=100;
 const filterState=create("small","tsys-sales-search-state");
 filterState.id="tsys-ventas-product-results";
 filterState.setAttribute("role","status");
 productSearch.append(filterLabel,filterInput,filterState);
 product.closest("label")?.before(productSearch);
 filterInput.addEventListener("input",()=>window.tsysVentasMobileFiltrar?.(filterInput.value));
 window.addEventListener("tsys:ventas-busqueda",event=>{
  const count=Number(event.detail?.cantidad)||0;
  filterState.textContent=count?count+" referencia(s) disponibles":"No hay referencias con ese nombre o código.";
 });
 media.addEventListener("change",()=>window.tsysVentasMobileFiltrar?.(filterInput.value));

 // Búsqueda local del historial descargado (no hace consultas de pacientes).
 const historySearch=create("div","tsys-sales-history-search");
 historySearch.id="tsys-ventas-history-search";
 const searchLabel=create("label",null,"Buscar entre las ventas mostradas");
 searchLabel.htmlFor="tsys-ventas-history-query";
 const searchInput=create("input");
 searchInput.id="tsys-ventas-history-query";
 searchInput.type="search";
 searchInput.autocomplete="off";
 searchInput.maxLength=100;
 searchInput.placeholder="Número, cliente o referencia";
 const matchCount=create("small","tsys-sales-search-state");
 matchCount.id="tsys-ventas-history-results";
 historySearch.append(searchLabel,searchInput,matchCount);
 const listStatus=document.getElementById("ventas-list-status");
 listStatus?.before(historySearch);
 const normalize=value=>String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
 function filterHistory(){
  const q=normalize(searchInput.value.trim());
  let visible=0,total=0;
  for(const row of list.children){
   if(!row.classList.contains("item"))continue;
   total++;
   row.hidden=!!q&&!normalize(row.textContent).includes(q);
   if(!row.hidden)visible++;
  }
  matchCount.textContent=q?visible+" de "+total+" ventas mostradas coinciden.":"Búsqueda dentro de las últimas ventas cargadas.";
 }
 searchInput.addEventListener("input",filterHistory);
 window.addEventListener("tsys:ventas-lista",filterHistory);

 const cartBadge=buttons.get("nueva")?.badge;
 window.addEventListener("tsys:ventas-carrito",event=>{
  const quantity=Number(event.detail?.unidades)||0;
  if(!cartBadge)return;
  cartBadge.textContent=quantity>0?String(quantity):"";
  cartBadge.hidden=quantity===0;
  buttons.get("nueva").button.setAttribute("aria-label",
   quantity>0?"Nueva venta, "+quantity+" unidad(es) en carrito":"Nueva venta");
 });
})();
