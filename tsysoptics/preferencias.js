/* TsysOptics · preferencias de interfaz sin acceso a datos clínicos ni Supabase. */
(()=>{
 "use strict";
 const storageKey="tsysoptics_tema_v1";
 const colors={
  clasico:"#0B1C40",oceano:"#095B73",esmeralda:"#166345",
  violeta:"#554096","morado-neon":"#320140",terracota:"#8E472F"
 };
 const valid=name=>Object.hasOwn(colors,name)?name:"clasico";
 const saved=()=>{try{return valid(localStorage.getItem(storageKey)||"clasico")}catch{return "clasico"}};
 function paint(name,persist){
  const theme=valid(name);
  document.documentElement.dataset.tsysTheme=theme;
  const meta=document.querySelector('meta[name="theme-color"]');
  if(meta)meta.setAttribute("content",colors[theme]);
  if(persist){try{localStorage.setItem(storageKey,theme)}catch{}}
  document.querySelectorAll("[data-tsys-theme-choice]").forEach(btn=>{
   btn.setAttribute("aria-pressed",String(btn.dataset.tsysThemeChoice===theme));
  });
 }
 paint(saved(),false);
 document.addEventListener("click",event=>{
  const item=event.target.closest("[data-tsys-theme-choice]");
  if(!item)return;
  paint(item.dataset.tsysThemeChoice,true);
 });
 window.addEventListener("storage",event=>{
  if(event.key===storageKey)paint(valid(event.newValue||"clasico"),false);
 });
 // Al enfocar un cero predeterminado, despejarlo para escribir de inmediato.
 // Si se abandona sin teclear, recuperar exactamente el cero previo.
 // No tocar valores clínicos distintos de cero, ni historias finalizadas.
 const zero=/^[+-]?0+(?:[.,]0+)?$/;
 const cleared=new WeakMap();
 document.addEventListener("focusin",event=>{
  const input=event.target;
  if(!(input instanceof HTMLInputElement))return;
  if(!["text","number","tel","search"].includes(input.type)||input.disabled||input.readOnly)return;
  if(input.closest("#auth-root")||input.closest("#auth-form"))return;
  const clinical=input.closest("#hcForm");
  if(clinical?.dataset.tsysHistoriaFinalizada==="true")return;
  if(!clinical && !input.closest("#tsys-app") && !input.closest("#panel"))return;
  const before=input.value.trim();
  if(!zero.test(before))return;
  cleared.set(input,before);
  input.value="";
 });
 document.addEventListener("focusout",event=>{
  const input=event.target;
  if(!(input instanceof HTMLInputElement))return;
  const before=cleared.get(input);
  if(before===undefined)return;
  cleared.delete(input);
  if(input.value==="")input.value=before;
 });
})();
