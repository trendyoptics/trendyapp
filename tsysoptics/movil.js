/* Navegación móvil TsysOptics. Ejecutado por caja.js en todo el panel. */
(()=>{
 "use strict";
 const app=document.getElementById("tsys-app");
 if(!app)return;
 const stylesheet=document.createElement("link");
 stylesheet.rel="stylesheet";
 stylesheet.href=new URL("./movil.css?v=20261029f",import.meta.url).href;
 document.head.append(stylesheet);
 const ico={
  inicio:'<path d="m3 10 9-7 9 7v11H3z"/><path d="M9 21v-7h6v7"/>',
  pacientes:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  agenda:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/>',
  ventas:'<path d="M3 5h2l2 12h12l2-9H6M8 21h.01M18 21h.01"/>',
  caja:'<rect x="2" y="6" width="20" height="15" rx="2"/><path d="M2 10h20M17 16h2"/>',
  inventario:'<path d="m12 2 9 5-9 5-9-5zM3 7v10l9 5 9-5V7M12 12v10"/>',
  simulador:'<circle cx="8" cy="12" r="4"/><circle cx="17" cy="12" r="4"/><path d="M12 12h1M3 12H2m19 0h1"/>',
  apariencia:'<path d="M12 2a10 10 0 0 0 0 20c2 0 3-2 2-4s1-3 3-3h2a3 3 0 0 0 3-3A10 10 0 0 0 12 2Z"/><path d="M7 10h.01M9 6h.01M14 6h.01M18 9h.01"/>',
  clinica:'<path d="M12 3v18M3 12h18"/>',
  devoluciones:'<path d="M3 11a9 9 0 1 0 3-6M3 4v7h7"/><path d="M8 15h8"/>',
  mas:'<path d="M4 7h16M4 12h16M4 17h16"/>'
 };
 const svg=key=>'<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">'+ico[key]+'</svg>';
 const dock=document.createElement("nav");dock.className="tsys-mobile-dock";dock.hidden=true;dock.setAttribute("aria-label","Navegación móvil");
 const shade=document.createElement("div");shade.className="tsys-mobile-backdrop";shade.hidden=true;
 const sheet=document.createElement("div");sheet.className="tsys-mobile-sheet";sheet.hidden=true;
 sheet.setAttribute("role","dialog");sheet.setAttribute("aria-label","Más módulos");
 sheet.innerHTML='<h2>Más módulos</h2><div class="tsys-mobile-options"></div>';
 document.body.append(dock,shade,sheet);
 const all=[
  ["inicio","Inicio"],["pacientes","Pacientes"],["agenda","Agenda"],
  ["ventas","Ventas"],["caja","Caja"],["inventario","Inventario"],
  ["simulador","Simulador"],["apariencia","Apariencia"],
  ["clinica","Clínica"],["devoluciones","Notas internas"]
 ];
 let role=null,moreButton=null;
 function closeMore(){shade.hidden=true;sheet.hidden=true;if(moreButton)moreButton.setAttribute("aria-expanded","false")}
 function navigate(destination){
  closeMore();
  if(["pacientes","clinica"].includes(destination)){
   const link=document.querySelector('.sidebar a[data-access-target="'+destination+'"]');
   if(link&&!link.classList.contains("role-locked"))location.assign(link.href);
   return;
  }
  if(destination==="devoluciones"){if(role==="administrador")location.assign("./devoluciones.html");return}
  const source=document.querySelector('.sidebar button[data-page="'+destination+'"]');
  if(source){
   source.click();
   // Al cambiar de sección, mostrar la cabecera y no conservar un scroll de Caja.
   window.scrollTo(0,0);
  }
  sync();
 }
 function button(item,primary){
  const b=document.createElement("button");b.type="button";
  b.innerHTML=svg(item[0])+"<span>"+item[1]+"</span>";
  b.setAttribute("aria-label",item[1]);
  if(item[0]==="mas"){moreButton=b;b.setAttribute("aria-expanded","false");
   b.addEventListener("click",()=>{const next=sheet.hidden;shade.hidden=!next;sheet.hidden=!next;b.setAttribute("aria-expanded",String(next))});
  }else{
   if(primary&&!["pacientes","clinica","devoluciones"].includes(item[0]))b.dataset.page=item[0];
   b.addEventListener("click",()=>navigate(item[0]));
  }
  return b;
 }
 function sync(){
  const page=document.querySelector(".page.active")?.id||"inicio";
  const main=new Set([...dock.querySelectorAll("[data-page]")].map(x=>x.dataset.page));
  dock.querySelectorAll("button").forEach(b=>{
   const current=b.dataset.page===page||(b===moreButton&&!main.has(page)&&page!=="inicio");
   b.classList.toggle("active",current);
   if(b.dataset.page)b.setAttribute("aria-current",current?"page":"false");
  });
 }
 function applyIncomingRoute(){
  const url=new URL(window.location.href);
  const selected=url.searchParams.get("modulo");
  if(!selected)return;
  const safe=new Set(["inicio","pacientes","agenda","inventario","ventas","caja","simulador","apariencia"]);
  const allowed=role==="administrador"||!["inventario","ventas","caja"].includes(selected);
  if(!safe.has(selected)||!allowed)return;
  const source=document.querySelector('.sidebar button[data-page="'+selected+'"]');
  if(!source)return;
  source.click();
  window.scrollTo(0,0);
  url.searchParams.delete("modulo");
  history.replaceState(history.state,"",url.pathname+url.search+url.hash);
 }
 function renderRole(){
  const primary=role==="administrador"?
   ["inicio","pacientes","ventas","caja","mas"]:
   ["inicio","pacientes","agenda","clinica","mas"];
  dock.replaceChildren();
  const menu=sheet.querySelector(".tsys-mobile-options");menu.replaceChildren();
  for(const name of primary){
   const item=name==="mas"?["mas","Más"]:all.find(x=>x[0]===name);
   dock.append(button(item,true));
  }
  for(const item of all){
   if(primary.includes(item[0]))continue;
   if(role!=="administrador"&&["ventas","caja","inventario","devoluciones"].includes(item[0]))continue;
   menu.append(button(item,false));
  }
  dock.hidden=false;
  applyIncomingRoute();
  sync();
 }
 shade.addEventListener("click",closeMore);
 document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!sheet.hidden)closeMore()});
 document.addEventListener("click",e=>{
  if(e.target.closest("[data-page],[data-go]"))queueMicrotask(sync);
 });
 window.addEventListener("tsys:role",e=>{role=e.detail?.role||null;closeMore();if(role)renderRole()});
 window.addEventListener("tsys:locked",()=>{role=null;closeMore();dock.hidden=true});

 const media=window.matchMedia("(max-width: 850px)");
 const details=[];
 function compact(container,summaryText,children){
  const panel=document.createElement("details");
  panel.className=container;
  const summary=document.createElement("summary");summary.textContent=summaryText;
  panel.append(summary,...children);
  details.push(panel);
  return panel;
 }
 const alert=app.querySelector("main>.warning");
 if(alert){const box=compact("tsys-pilot-details","Información del piloto y sus limitaciones",[alert]);
  app.querySelector("main").prepend(box)}
 const revenue=document.getElementById("caja-medios");
 if(revenue){
  const childList=[revenue];
  const footer=document.getElementById("caja-manuales-resumen");
  if(footer)childList.push(footer);
  const panel=compact("tsys-caja-details","Ver cobros y devoluciones por medio",childList);
  revenue.closest(".card")?.append(panel);
  const metrics=document.querySelector("#caja .venta-resumen");
  if(metrics){
   const quick=document.createElement("div");quick.className="tsys-caja-quick";
   for(const [label,icon,target] of [["Movimiento","✚","caja-movimiento-form"],["Arqueo","▣","caja-cierre-form"],["Recaudos","◉","caja-medios"]]){
    const b=document.createElement("button");b.type="button";
    b.innerHTML="<span>"+icon+"</span>"+label;
    b.addEventListener("click",()=>{
     if(target==="caja-medios")panel.open=true;
     const preferred=document.getElementById(target);
     const el=preferred?.hidden?document.getElementById("caja-abrir-form"):preferred;
     el?.scrollIntoView({behavior:"smooth",block:"start"});
    });
    quick.append(b);
   }
   metrics.before(quick);
  }
 }
 function adapt(){for(const el of details)el.open=!media.matches}
 adapt();media.addEventListener("change",adapt);
 // Si el login terminó antes que este módulo, recuperar el rol ya validado.
 if(app.dataset.role){role=app.dataset.role;renderRole()}
})();
