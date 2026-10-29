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
 // En los campos COP, mostrar 100.000 (y 100.000,50 si hay centavos),
 // manteniendo los datos exactos para las operaciones de Supabase.
 // Los campos de cantidades, ejes, dioptrías y fechas NO usan este formato.
 const copNumber = raw => {
  const text=String(raw??"").trim();
  if(!text||!/^(?:\\d+|\\d{1,3}(?:\\.\\d{3})+)(?:,\\d{1,2})?$/.test(text))return NaN;
  const n=Number(text.replace(/\\./g,"").replace(",","."));
  return Number.isFinite(n)&&n>=0?n:NaN;
 };
 const copFormat=new Intl.NumberFormat("es-CO",{minimumFractionDigits:0,maximumFractionDigits:2});
 function formatCopField(input){
  if(!(input instanceof HTMLInputElement)||!input.matches("[data-tsys-cop]"))return;
  if(input.value.trim()==="")return;
  const n=copNumber(input.value);
  if(Number.isFinite(n))input.value=copFormat.format(n);
 }
 window.tsysParseCOP=copNumber;
 window.tsysFormatCOPInput=formatCopField;
 window.tsysFormatCOPInputs=(scope=document)=>{
  scope.querySelectorAll("[data-tsys-cop]").forEach(formatCopField);
 };
 document.addEventListener("focusout",event=>{
  formatCopField(event.target);
 });
 // El navegador puede restaurar valores de autocompletado después de cargar:
 // formatear al iniciarse la página sin modificar los valores almacenados.
 if(document.readyState==="loading"){
  document.addEventListener("DOMContentLoaded",()=>window.tsysFormatCOPInputs(),{once:true});
 }else{window.tsysFormatCOPInputs();}
})();
