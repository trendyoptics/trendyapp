// Informe ejecutivo de cierre mensual. No se presenta como cierre contable ni inventario histórico.
const NAVY=[11,28,64],SLATE=[88,95,115],PALE=[236,241,248],WHITE=[255,255,255];
const COP=v=>"$ "+new Intl.NumberFormat("es-CO",{maximumFractionDigits:2}).format(Number(v)||0);
const INT=v=>new Intl.NumberFormat("es-CO").format(Number(v)||0);
const str=v=>v===undefined||v===null?"":String(v);
const labelDate=value=>new Date(value).toLocaleString("es-CO",{timeZone:"America/Bogota",dateStyle:"medium",timeStyle:"short"});
async function logoData(source){
 if(typeof source!=="string"||!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(source)||source.length>210000)return null;
 const img=new Image();img.src=source;
 try{
  await img.decode();
  const canvas=document.createElement("canvas");
  const scale=Math.min(1,350/Math.max(img.naturalWidth,img.naturalHeight));
  canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));
  canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
  const ctx=canvas.getContext("2d");if(!ctx)return null;
  ctx.drawImage(img,0,0,canvas.width,canvas.height);
  return {data:canvas.toDataURL("image/png"),ratio:canvas.width/canvas.height};
 }catch{return null}
}
export async function createMonthlyPdf(report,identity={}){
 const {jsPDF}=await import("https://esm.sh/jspdf@2.5.2");
 const pdf=new jsPDF({unit:"mm",format:"a4",orientation:"portrait"});
 const W=210,H=297,M=13,C=W-2*M,LIMIT=269;
 const name=str(identity.nombre_optica||"ÓPTICA").slice(0,70);
 const logo=await logoData(identity.logo_data_url);
 const month=new Intl.DateTimeFormat("es-CO",{month:"long",year:"numeric",timeZone:"America/Bogota"})
  .format(new Date(report.month+"-15T12:00:00-05:00")).toLocaleUpperCase("es-CO");
 let y=40;
 const font=(size=8,bold=false)=>{pdf.setFont("helvetica",bold?"bold":"normal");pdf.setFontSize(size)};
 function paint(value,x,z,color=NAVY){pdf.setTextColor(...color);pdf.text(str(value),x,z)}
 function header(continuation=false){
  pdf.setFillColor(...NAVY);pdf.rect(0,0,W,continuation?25:32,"F");
  font(continuation?12:15,true);paint("INFORME ADMINISTRATIVO MENSUAL",M,continuation?13:14,WHITE);
  font(continuation?7:9);paint(name+"  ·  "+month,M,continuation?20:23,WHITE);
  if(!continuation&&logo){
   const w=Math.min(20,21*logo.ratio),h=w/logo.ratio;
   try{pdf.addImage(logo.data,"PNG",W-M-w,5,w,h)}catch{}
  }
 }
 header();
 function newPage(){
  pdf.addPage();header(true);y=31;
 }
 function ensure(height){
  if(y+height>LIMIT)newPage();
 }
 function title(value){
  ensure(15);y+=4;
  pdf.setFillColor(...PALE);pdf.roundedRect(M,y,C,8,1.5,1.5,"F");
  font(9,true);paint(value.toLocaleUpperCase("es-CO"),M+3,y+5.5);
  y+=13;
 }
 function twoCols(rows){
  for(const [left,right] of rows){
   ensure(10);
   const cols=[[left,M],[right,M+C/2+2]];
   for(const [row,x] of cols){
    if(!row)continue;
    font(7);paint(row[0],x,y,SLATE);
    font(8,true);paint(str(row[1]),x,y+4);
   }
   y+=12;
  }
 }
 function gridMetric(caption,value,x,z,w){
  pdf.setFillColor(...PALE);pdf.roundedRect(x,z,w,22,2,2,"F");
  font(7);paint(caption,x+3,z+6,SLATE);
  font(12,true);
  const max=w-6;
  let n=12;
  while(pdf.getTextWidth(str(value))>max&&n>8){n--;font(n,true)}
  paint(value,x+3,z+16);
 }
 function metrics(){
  const gap=4,w=(C-2*gap)/3;
  const items=[
   ["VENTAS DEL MES",COP(report.totals.salesTotal)],
   ["RECAUDOS DEL MES",COP(report.totals.paymentsTotal)],
   ["REEMBOLSOS DEL MES",COP(report.totals.refundedTotal)],
   ["SALDO ACTUAL",COP(report.totals.balanceNow)],
   ["UNIDADES VENDIDAS",INT(report.totals.unitsSold)],
   ["EXISTENCIAS HOY",INT(report.totals.stockUnits)],
   ["INVENTARIO A COSTO",COP(report.totals.stockCost)]
  ];
  for(let row=0;row<2;row++){
   for(let col=0;col<3;col++){
    const [label,value]=items[row*3+col];
    gridMetric(label,value,M+col*(w+gap),y+row*26,w);
   }
  }
  y+=58;
 }
 function paragraph(value,{size=7,color=SLATE,spacing=3}={}){
  font(size);pdf.setTextColor(...color);
  const lines=pdf.splitTextToSize(str(value),C-2);
  for(const line of lines){
   ensure(4.5);pdf.text(line,M+1,y);y+=4;
  }
  y+=spacing;
 }
 function table(heads,records,weights,numeric=[]){
  const columnWidths=weights.map(f=>C*f);
  const drawHeader=()=>{
   ensure(8);pdf.setFillColor(...NAVY);pdf.rect(M,y,C,7,"F");
   let x=M;
   heads.forEach((h,i)=>{
    font(7,true);paint(h,x+2,y+4.8,WHITE);x+=columnWidths[i];
   });y+=7;
  };
  drawHeader();
  if(!records.length){paragraph("Sin registros para este apartado.",{size:7,spacing:1});return}
  records.forEach((cells,index)=>{
   const formatted=cells.map(v=>str(v));
   const lines=formatted.map((v,i)=>{
    font(7);
    return pdf.splitTextToSize(v,Math.max(columnWidths[i]-4,8)).slice(0,2);
   });
   const height=Math.max(7,...lines.map(p=>p.length*3.6+3));
   if(y+height>LIMIT){newPage();drawHeader()}
   if(index%2===1){pdf.setFillColor(246,248,251);pdf.rect(M,y,C,height,"F")}
   let x=M;
   lines.forEach((entry,i)=>{
    font(7,numeric.includes(i));pdf.setTextColor(...(numeric.includes(i)?NAVY:SLATE));
    const pos=numeric.includes(i)?x+columnWidths[i]-2:x+2;
    entry.forEach((line,j)=>pdf.text(line,pos,y+4.2+j*3.6,{align:numeric.includes(i)?"right":"left"}));
    x+=columnWidths[i];
   });
   y+=height;
  });
  y+=4;
 }
 const t=report.totals;
 paragraph("TsysOptics · Sistema de gestión    |    Generado: "+labelDate(report.generatedAt),{size:7});
 metrics();
 paragraph("Cifras operativas del mes seleccionado. Algunos indicadores, como saldos, pedidos abiertos e inventario, reflejan el estado ACTUAL al generar el informe.",{size:7});
 title("Ventas y rentabilidad estimada");
 twoCols([
  [["Ventas vigentes",INT(t.salesCount)],[ "Anuladas",INT(t.voidCount)]],
  [["Devueltas",INT(t.returnedCount)],["Costo de productos vendidos",COP(t.estimatedCost)]],
  [["Margen bruto estimado",COP(t.salesTotal-t.estimatedCost)],["Sin impuestos ni gastos","Estimación operativa"]]
 ]);
 title("Gastos y resultado operativo");
 twoCols([
  [["Gastos registrados",COP(t.expensesTotal||0)],["Resultado operativo estimado",COP(t.operatingResult||0)]],
  [["Cierre histórico",report.storedClose?"REGISTRADO":"SIN CERRAR"],["Fecha de cierre",report.storedClose?labelDate(report.storedClose.cerrado_en):"—"]]
 ]);
 paragraph("El resultado operativo estimado descuenta los costos de los productos vendidos y los gastos registrados; no equivale a utilidad neta.",{size:7});
 title("Cobros por medio de pago");
 table(["Medio de pago","Recaudado COP"],report.methods.map(([medio,monto])=>[
  str(medio).toLocaleUpperCase("es-CO"),COP(monto)
 ]),[.54,.46],[1]);
 paragraph("Los pagos del mes pueden corresponder a ventas anteriores. No se deben sumar automáticamente los movimientos manuales de caja.",{size:7});
 title("Productos más vendidos (primeros 15)");
 table(["Referencia","Unidades","Ventas COP"],report.top.slice(0,15).map(x=>[
  (str(x.codigo)+" · "+str(x.nombre)).slice(0,88),INT(x.unidades),COP(x.valor)
 ]),[.59,.15,.26],[1,2]);
 title("Inventario actual y alertas");
 twoCols([
  [["Referencias activas",INT(t.stockRefs)],["Existencias actuales",INT(t.stockUnits)]],
  [["Valor a costo",COP(t.stockCost)],["Valor público estimado",COP(t.stockRetail)]],
  [["Productos bajo mínimo",INT(t.stockLow)],["Salidas del mes (unidades)",INT(t.stockOut)]]
 ]);
 paragraph("IMPORTANTE: el inventario mostrado es una fotografía ACTUAL, no las existencias históricas del último día del mes consultado.",{size:7});
 table(["Alerta de inventario actual","Existencia","Mínimo"],report.lowStock.slice(0,12).map(x=>[
  str(x.codigo)+" · "+str(x.nombre),INT(x.cantidad),INT(x.stock_minimo)
 ]),[.70,.15,.15],[1,2]);
 title("Gastos por categoría");
 {
  const categories=new Map();
  for(const g of report.expenses||[])categories.set(g.categoria,(categories.get(g.categoria)||0)+Number(g.monto||0));
  table(["Categoría","Total COP"],[...categories.entries()].sort((a,b)=>b[1]-a[1]).map(([c,n])=>[c,COP(n)]),[.58,.42],[1]);
 }
 title("Laboratorio y caja");
 twoCols([
  [["Órdenes creadas en el mes",INT(t.labCreated)],["Órdenes abiertas actualmente",INT(t.labOpenNow)]],
  [["Órdenes vencidas actualmente",INT(t.labOverdueNow)],["Turnos cerrados durante el mes",INT(t.shiftsClosed)]],
  [["Diferencia acumulada arqueos",COP(t.shiftsDifference)],["Ingresos manuales de caja",COP(t.cashIn)]],
  [["Egresos manuales de caja",COP(t.cashOut)],["Estado de órdenes","Se muestra el actual"]]
 ]);
 title("Alcance y advertencias");
 paragraph("Ventas: se cuentan las ventas creadas en el mes y vigentes al consultar. Los saldos son los actuales, no los existentes al cierre del periodo. Los recaudos son pagos registrados durante el mes, incluidos abonos de ventas anteriores.",{size:7});
 paragraph("Si existe un cierre histórico, el inventario se congeló en la fecha en que se ejecutó, que puede ser posterior al último día del periodo. Los movimientos de caja y gastos pueden reflejar la misma salida y no deben sumarse sin conciliar.",{size:7});
 paragraph("El margen es una estimación basada en costo de productos y no equivale a utilidad neta. El reporte es administrativo y NO reemplaza cierre contable, conciliación bancaria, obligaciones tributarias ni factura electrónica DIAN.",{size:7});
 paragraph("Para consultar todas las ventas, pagos, productos, inventario y movimientos por separado, descarga el libro Excel (.xlsx).",{size:7});
 const total=pdf.getNumberOfPages();
 for(let i=1;i<=total;i++){
  pdf.setPage(i);pdf.setDrawColor(198,206,219);pdf.line(M,276,W-M,276);
  font(6.8);paint("TsysOptics · "+name+" · Informe "+report.month,M,282,SLATE);
  pdf.text("Página "+i+" de "+total,W-M,282,{align:"right"});
  font(6);paint("Documento administrativo interno · Datos consultados "+labelDate(report.generatedAt),M,288,SLATE);
 }
 return {blob:pdf.output("blob"),filename:"TsysOptics_Informe_Mensual_"+report.month+".pdf"};
}
