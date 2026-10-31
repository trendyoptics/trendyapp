// Libro Excel real: pestañas independientes, filtros, cifras numéricas y formato COP.
// La librería se carga únicamente al pulsar Exportar Excel; no se envían datos a ningún servidor.
const INK="FF0B1C40",BLUE="FF294773",PALE="FFEAF0F7",MUTED="FF585F73",WHITE="FFFFFFFF",ALERT="FFFFEBE7";
const COP='#,##0.00 "COP"';
const INTEGER="#,##0";
let excelLibPromise;
function loadExcelJS(){
 if(window.ExcelJS)return Promise.resolve(window.ExcelJS);
 if(!excelLibPromise){
  excelLibPromise=new Promise((resolve,reject)=>{
   const script=document.createElement("script");
   script.src="https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js";
   script.async=true;
   script.onload=()=>window.ExcelJS?resolve(window.ExcelJS):reject(Error("No se cargó el motor de Excel."));
   script.onerror=()=>reject(Error("No se pudo cargar Excel. Verifica la conexión y usa CSV si continúa el problema."));
   document.head.append(script);
  }).catch(error=>{excelLibPromise=null;throw error});
 }
 return excelLibPromise;
}
const cop=n=>Number(n)||0;
function safe(v){
 if(v===null||v===undefined)return "";
 if(typeof v==="number"&&Number.isFinite(v))return v;
 const value=String(v);
 // Nunca interpretar textos de clientes, SKU o nombres como fórmulas.
 return /^[\s\uFEFF]*[=+@-]/.test(value)?"'"+value:value;
}
function bogotaDate(value){
 if(!value)return "";
 const d=new Date(value);
 if(Number.isNaN(d.getTime()))return String(value).slice(0,10);
 return new Intl.DateTimeFormat("sv-SE",{
  timeZone:"America/Bogota",year:"numeric",month:"2-digit",day:"2-digit"
 }).format(d);
}
const widths={
 brief:16,name:38,text:44,id:39,money:20,number:17,date:19,normal:26
};
function makeSheet(book,{name,title,month,note,cols,rows,totals}){
 const sheet=book.addWorksheet(name,{
  views:[{state:"frozen",ySplit:5}],
  pageSetup:{paperSize:9,fitToPage:true,fitToWidth:1,fitToHeight:0,orientation:"landscape"},
  properties:{defaultRowHeight:18}
 });
 sheet.columns=cols.map((c,i)=>({key:"field"+i,width:typeof c.width==="number"?c.width:(widths[c.width]||23)}));
 sheet.mergeCells(1,1,2,cols.length);
 const heading=sheet.getCell(1,1);heading.value=title;
 heading.font={name:"Aptos Display",size:16,bold:true,color:{argb:WHITE}};
 heading.fill={type:"pattern",pattern:"solid",fgColor:{argb:INK}};
 heading.alignment={vertical:"middle",indent:1};
 sheet.getRow(1).height=26;sheet.getRow(2).height=10;
 sheet.mergeCells(3,1,3,cols.length);
 const sub=sheet.getCell(3,1);
 sub.value="Periodo: "+month+"  |  "+note;
 sub.font={name:"Aptos",size:10,color:{argb:MUTED},italic:true};
 sub.alignment={vertical:"middle",wrapText:true};
 sheet.getRow(3).height=34;
 const header=sheet.getRow(5);header.height=30;
 cols.forEach((c,i)=>{
  const cell=header.getCell(i+1);cell.value=c.label;
  cell.font={bold:true,name:"Aptos",color:{argb:WHITE},size:10};
  cell.fill={type:"pattern",pattern:"solid",fgColor:{argb:BLUE}};
  cell.alignment={vertical:"middle",wrapText:true};
  if(c.type==="money")sheet.getColumn(i+1).numFmt=COP;
  else if(c.type==="integer")sheet.getColumn(i+1).numFmt=INTEGER;
 });
 const cap=20000;
 if(rows.length>cap)throw Error("El informe excede el límite de filas para Excel. Utiliza CSV o divide el periodo.");
 for(let i=0;i<rows.length;i++){
  const row=sheet.getRow(i+6);
  row.values=rows[i].map(safe);
  if(i%2===1){
   for(let c=1;c<=cols.length;c++)row.getCell(c).fill={type:"pattern",pattern:"solid",fgColor:{argb:"FFF4F7FA"}};
  }
  for(let c=1;c<=cols.length;c++){
   row.getCell(c).alignment={vertical:"middle",wrapText:cols[c-1].width==="name"||cols[c-1].width==="text"};
  }
  if(name==="Inventario actual"&&rows[i][9]==="ACTIVO"&&Number(rows[i][3])<=Number(rows[i][4])){
   row.getCell(5).fill={type:"pattern",pattern:"solid",fgColor:{argb:ALERT}};
  }
 }
 const finalRow=rows.length+5;
 if(totals?.length){
  const total=sheet.getRow(finalRow+1);
  total.getCell(1).value="TOTAL";
  totals.forEach(({column,value})=>{
   const idx=column+1;
   total.getCell(idx).value=rows.length?{formula:"SUM("+sheet.getColumn(idx).letter+"6:"+sheet.getColumn(idx).letter+finalRow+")",result:value}:0;
  });
  total.eachCell(c=>{c.font={bold:true,color:{argb:INK}};c.fill={type:"pattern",pattern:"solid",fgColor:{argb:PALE}}});
 }
 if(rows.length)sheet.autoFilter={from:{row:5,column:1},to:{row:finalRow,column:cols.length}};
 sheet.headerFooter.oddFooter="TsysOptics  |  "+name+"  |  Página &P de &N";
 return sheet;
}
function row(caption,value,scope){return [caption,value,scope]}
function build(book,r,company){
 const t=r.totals,month=r.month;
 const generated=new Date(r.generatedAt).toLocaleString("es-CO",{timeZone:"America/Bogota"});
 const current="Generado: "+generated+" (Bogotá)";
 const common={month,note:current};
 const summary=[
  row("VENTAS VIGENTES DEL MES (COP)",cop(t.salesTotal),"Ventas creadas en el mes, excluyendo anuladas y devueltas actuales"),
  row("NÚMERO DE VENTAS VIGENTES",t.salesCount,"Operaciones del mes"),
  row("VENTAS ANULADAS",t.voidCount,"Estado actual"),
  row("VENTAS DEVUELTAS",t.returnedCount,"Estado actual"),
  row("RECAUDOS DEL MES (COP)",cop(t.paymentsTotal),"Pagos recibidos en el mes, incluso de ventas anteriores"),
  row("REEMBOLSOS DEL MES (COP)",cop(t.refundedTotal),"Devoluciones registradas durante el periodo"),
  row("RECAUDOS MENOS REEMBOLSOS (COP)",cop(t.paymentsTotal-t.refundedTotal),"No representa utilidad neta ni saldo de caja"),
  row("SALDO ACTUAL DE VENTAS DEL MES (COP)",cop(t.balanceNow),"No es necesariamente el saldo al último día del mes"),
  row("UNIDADES VENDIDAS",t.unitsSold,"Detalle de ventas vigentes"),
  row("COSTO ESTIMADO VENDIDO (COP)",cop(t.estimatedCost),"Costos históricos de productos vendidos"),
  row("MARGEN BRUTO ESTIMADO (COP)",cop(t.salesTotal-t.estimatedCost),"Sin gastos, impuestos ni ajustes"),
  row("GASTOS DEL MES (COP)",cop(t.expensesTotal),"Gastos operativos registrados"),
  row("RESULTADO OPERATIVO ESTIMADO (COP)",cop(t.operatingResult),"Ventas menos costo de productos y gastos"),
  row("CIERRE HISTÓRICO",r.storedClose?"REGISTRADO":"PENDIENTE","Una vez guardado no se recalcula"),
  row("REFERENCIAS ACTIVAS HOY",t.stockRefs,"Inventario actual, no histórico"),
  row("EXISTENCIAS HOY",t.stockUnits,"Inventario actual, no histórico"),
  row("VALOR A COSTO HOY (COP)",cop(t.stockCost),"Valoración actual estimada"),
  row("VALOR DE VENTA HOY (COP)",cop(t.stockRetail),"No equivale a ventas realizadas"),
  row("REFERENCIAS CON ALERTA HOY",t.stockLow,"Bajo mínimo o agotadas"),
  row("ENTRADAS DE INVENTARIO DEL MES",t.stockIn,"Unidades"),
  row("SALIDAS DE INVENTARIO DEL MES",t.stockOut,"Unidades"),
  row("ÓRDENES CREADAS EN EL MES",t.labCreated,"Órdenes de laboratorio"),
  row("ÓRDENES ABIERTAS HOY",t.labOpenNow,"Estado actual"),
  row("ÓRDENES VENCIDAS HOY",t.labOverdueNow,"Estado actual"),
  row("TURNOS DE CAJA CERRADOS",t.shiftsClosed,"Durante el mes"),
  row("DIFERENCIA EN ARQUEOS (COP)",cop(t.shiftsDifference),"Suma de diferencias"),
  row("INGRESOS MANUALES DE CAJA (COP)",cop(t.cashIn),"No sumar a pagos sin conciliación"),
  row("EGRESOS MANUALES DE CAJA (COP)",cop(t.cashOut),"No sumar a devoluciones sin conciliación")
 ];
 const sh=makeSheet(book,{...common,name:"Resumen",title:company+" | CIERRE MENSUAL",cols:[
  {label:"Indicador",width:48},{label:"Valor",width:"money"},{label:"Interpretación y alcance",width:67}
 ],rows:summary});
 summary.forEach(([k,v],i)=>{sh.getCell(i+6,2).numFmt=k.includes("COP")?COP:INTEGER});
 sh.getColumn(3).alignment={wrapText:true};
 makeSheet(book,{...common,name:"Ventas",title:"VENTAS DEL MES",cols:[
  {label:"Número",width:"brief"},{label:"Fecha (Bogotá)",width:"date"},{label:"Estado actual",width:"normal"},
  {label:"Total COP",width:"money",type:"money"},{label:"Abonado actual COP",width:"money",type:"money"},{label:"Saldo actual COP",width:"money",type:"money"}
 ],rows:r.sales.map(x=>[x.numero,bogotaDate(x.fecha),x.estado,cop(x.total),cop(x.abonado),cop(x.saldo)])});
 makeSheet(book,{...common,name:"Recaudos",title:"PAGOS RECIBIDOS EN EL MES",cols:[
  {label:"Fecha (Bogotá)",width:"date"},{label:"Medio",width:"normal"},{label:"Monto COP",width:"money",type:"money"},
  {label:"Venta ID",width:"id"},{label:"Pago ID",width:"id"}
 ],rows:r.payments.map(x=>[bogotaDate(x.registrado_en),x.medio,cop(x.monto),x.venta_id,x.id]),
 totals:[{column:2,value:cop(t.paymentsTotal)}]});
 makeSheet(book,{...common,name:"Productos vendidos",title:"PRODUCTOS MÁS VENDIDOS",cols:[
  {label:"Código",width:"brief"},{label:"Referencia",width:"name"},{label:"Unidades",width:"number",type:"integer"},
  {label:"Ventas COP",width:"money",type:"money"},{label:"Costo estimado COP",width:"money",type:"money"},
  {label:"Margen estimado COP",width:"money",type:"money"}
 ],rows:r.top.map(x=>[x.codigo,x.nombre,cop(x.unidades),cop(x.valor),cop(x.costo),cop(x.valor)-cop(x.costo)]),
 totals:[{column:2,value:t.unitsSold},{column:3,value:t.salesTotal},{column:4,value:t.estimatedCost},{column:5,value:t.salesTotal-t.estimatedCost}]});
 makeSheet(book,{...common,name:"Inventario actual",title:"INVENTARIO ACTUAL - NO HISTÓRICO",cols:[
  {label:"Código",width:"brief"},{label:"Referencia",width:"name"},{label:"Tipo",width:"normal"},
  {label:"Unidades",width:"number",type:"integer"},{label:"Mínimo",width:"number",type:"integer"},
  {label:"Costo unitario COP",width:"money",type:"money"},{label:"Precio venta COP",width:"money",type:"money"},
  {label:"Valor a costo COP",width:"money",type:"money"},{label:"Valor público COP",width:"money",type:"money"},
  {label:"Estado",width:"brief"},{label:"Alerta",width:"brief"}
 ],rows:r.stock.map(x=>[x.codigo,x.nombre,x.tipo,cop(x.cantidad),cop(x.stock_minimo),
  cop(x.costo_compra),cop(x.precio_venta),cop(x.cantidad)*cop(x.costo_compra),cop(x.cantidad)*cop(x.precio_venta),
  x.activo?"ACTIVO":"INACTIVO",!x.activo?"INACTIVO":cop(x.cantidad)<=0?"AGOTADO":cop(x.cantidad)<=cop(x.stock_minimo)?"BAJO MÍNIMO":"OK"] )});
 makeSheet(book,{...common,name:"Laboratorio",title:"ORDENES CREADAS EN EL MES",cols:[
  {label:"Orden ID",width:"id"},{label:"Venta ID",width:"id"},{label:"Laboratorio",width:"name"},
  {label:"Creado (Bogotá)",width:"date"},{label:"Estado actual",width:"normal"},
  {label:"Entrega estimada",width:"date"},{label:"Entregado paciente",width:"date"}
 ],rows:r.orderMonth.map(x=>[x.id,x.venta_id||"",x.laboratorio||"",bogotaDate(x.creado_en),
  x.estado,x.fecha_entrega_estimada||"",x.fecha_entrega_paciente||""])});
 const names=new Map(r.stock.map(p=>[p.id,p.codigo+" · "+p.nombre]));
 makeSheet(book,{...common,name:"Gastos",title:"GASTOS ADMINISTRATIVOS DEL MES",cols:[
  {label:"Fecha",width:"date"},{label:"Categoría",width:"normal"},{label:"Descripción",width:"text"},
  {label:"Monto COP",width:"money",type:"money"},{label:"Medio",width:"normal"},{label:"Referencia",width:"normal"}
 ],rows:(r.expenses||[]).map(g=>[g.fecha,g.categoria,g.descripcion,cop(g.monto),g.medio,g.referencia||""]),
 totals:[{column:3,value:t.expensesTotal||0}]});
 makeSheet(book,{...common,name:"Cierre histórico",title:"CIERRE MENSUAL HISTÓRICO",cols:[
  {label:"Indicador",width:48},{label:"Valor",width:"money"},{label:"Interpretación",width:75}
 ],rows:r.storedClose?[
  ["Fecha del cierre",bogotaDate(r.storedClose.cerrado_en),"Fecha real en que se congelaron los datos"],
  ["Ventas al guardar cierre COP",cop(r.storedClose.datos?.ventas_total),"Ventas vigentes al capturar"],
  ["Recaudos COP",cop(r.storedClose.datos?.recaudos_total),"Pagos recibidos durante el mes"],
  ["Gastos COP",cop(r.storedClose.datos?.gastos_total),"Gastos registrados en el periodo"],
  ["Inventario unidades",cop(r.storedClose.datos?.inventario_unidades),"Fotografía tomada en la fecha de cierre"],
  ["Inventario valor a costo COP",cop(r.storedClose.datos?.inventario_costo),"Fotografía tomada en la fecha de cierre"],
  ["Diferencia en arqueos COP",cop(r.storedClose.datos?.arqueo_diferencia),"Requiere conciliación si es distinta de cero"]
 ]:[["Estado","NO SE HA REALIZADO CIERRE","El informe corriente puede cambiar con nuevas operaciones"] ]});
 makeSheet(book,{...common,name:"Mov. inventario",title:"MOVIMIENTOS DE INVENTARIO DEL MES",cols:[
  {label:"Fecha (Bogotá)",width:"date"},{label:"Producto",width:"name"},
  {label:"Diferencia unidades",width:"number",type:"integer"},{label:"Motivo",width:"text"}
 ],rows:r.stockMoves.map(x=>[bogotaDate(x.creado_en),names.get(x.producto_id)||x.producto_id,cop(x.diferencia),x.motivo||""])});
 makeSheet(book,{...common,name:"Mov. caja",title:"MOVIMIENTOS MANUALES DE CAJA",cols:[
  {label:"Fecha (Bogotá)",width:"date"},{label:"Tipo",width:"normal"},{label:"Monto COP",width:"money",type:"money"},
  {label:"Motivo",width:"text"}
 ],rows:r.cashMoves.map(x=>[bogotaDate(x.fecha),x.tipo,cop(x.monto),x.motivo||""])});
 makeSheet(book,{...common,name:"Cierres de caja",title:"ARQUEOS Y CIERRES DE CAJA",cols:[
  {label:"Cierre (Bogotá)",width:"date"},{label:"Turno ID",width:"id"},{label:"Estado",width:"normal"},
  {label:"Diferencia COP",width:"money",type:"money"}
 ],rows:r.shifts.map(x=>[bogotaDate(x.cerrada_en),x.id,x.estado,cop(x.diferencia)]),
 totals:[{column:3,value:t.shiftsDifference}]});
 makeSheet(book,{...common,name:"Notas",title:"CÓMO INTERPRETAR ESTE INFORME",cols:[
  {label:"Concepto",width:"normal"},{label:"Alcance",width:98}
 ],rows:[
  ["Periodo","Se utiliza la zona horaria America/Bogota. La fecha de generación identifica cuándo se consultaron los datos."],
  ["Ventas","Ventas creadas en el periodo, según su estado ACTUAL al generar el reporte. Las anuladas y devueltas no forman parte del total vigente."],
  ["Recaudos","Pagos recibidos en el periodo, incluso de ventas realizadas anteriormente. No corresponden necesariamente a ventas de ese mismo mes ni son recaudos netos de devoluciones."],
  ["Saldos","Son los saldos actuales de ventas originadas en el periodo consultado."],
  ["Inventario","Es una fotografía del inventario ACTUAL. No es un cierre histórico del último día del mes consultado."],
  ["Laboratorio","Órdenes creadas en el periodo; su estado mostrado es el actual."],
  ["Rentabilidad","Resultado operativo estimado: ventas menos costo vendido y gastos registrados; no es utilidad neta ni sustituye conciliación."],
  ["Cierre histórico","Si existe, la fotografía del inventario fue tomada AL EJECUTAR el cierre, no necesariamente el último día del mes."],
  ["Caja","Los ingresos y egresos manuales no deben agregarse automáticamente a los recaudos de ventas, para evitar doble contabilización."],
  ["Alcance","Documento operativo interno; no reemplaza contabilidad, conciliación bancaria ni factura electrónica DIAN."]
 ]});
 return book;
}
export async function exportMonthlyXlsx(report,company){
 const ExcelJS=await loadExcelJS();
 const workbook=new ExcelJS.Workbook();
 workbook.creator="TsysOptics - Sistema de gestión";
 workbook.title="Informe mensual "+report.month;
 workbook.subject="Cierre administrativo operativo";
 workbook.created=new Date();
 workbook.calcProperties.fullCalcOnLoad=true;
 build(workbook,report,company||"ÓPTICA");
 const bytes=await workbook.xlsx.writeBuffer();
 const blob=new Blob([bytes],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
 const url=URL.createObjectURL(blob);
 const a=document.createElement("a");
 a.href=url;a.download="TsysOptics_Cierre_Mensual_"+report.month+".xlsx";
 document.body.append(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),30000);
 return a.download;
}
