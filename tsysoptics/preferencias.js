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
 // Escritura directa: al entrar en un campo editable con contenido,
 // despejarlo para reemplazar el valor de inmediato, sea "0", "0.00",
 // "-1.00", "150000" o cualquier otro valor anterior.
 //
 // Si el usuario abandona el campo sin escribir, recuperar el dato original.
 // Si escribe (incluso si lo borra después), respetar su modificación.
 // Las historias finalizadas, controles de solo lectura, selectores, fechas,
 // contraseñas y pantalla de acceso nunca se alteran.
 const replaced=new WeakMap();
 function editableField(input){
  if(!(input instanceof HTMLInputElement))return false;
  if(!["text","number","tel","search","email","url"].includes(input.type))return false;
  if(input.disabled||input.readOnly||input.matches("[data-tsys-conservar-valor]"))return false;
  if(input.closest("#auth-root, #auth-form"))return false;
  const clinical=input.closest("#hcForm");
  if(clinical?.dataset.tsysHistoriaFinalizada==="true")return false;
  return Boolean(clinical||input.closest("#tsys-app, #panel"));
 }
 document.addEventListener("focusin",event=>{
  const input=event.target;
  if(!editableField(input)||input.value==="")return;
  replaced.set(input,{original:input.value,edited:false});
  input.value="";
 });
 document.addEventListener("input",event=>{
  const input=event.target;
  if(!(input instanceof HTMLInputElement))return;
  const state=replaced.get(input);
  if(state)state.edited=true;
 },true);
 document.addEventListener("focusout",event=>{
  const input=event.target;
  if(!(input instanceof HTMLInputElement))return;
  const state=replaced.get(input);
  if(!state)return;
  replaced.delete(input);
  if(!state.edited&&input.value==="")input.value=state.original;
 });
})();
