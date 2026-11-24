// PDF clínico autónomo: diseño optométrico en carta, sin servicios externos.
export function descargarHistoriaClinicaPDF(registro, identidad = {}, logoImagen = null) {
  if (!registro || registro.estado !== "finalizada") throw new Error("Solo se descargan historias finalizadas.");
  const d = registro.datos_clinicos || {};
  const p = registro.paciente || {};
  const nombre = p.nombre_completo || d.nombre || "Paciente";
  const nombreOptica = identidad.nombre_optica || "TsysOptics";
  const W = 1275, H = 1650, M = 76, C = W - M * 2;
  const paginas = [];
  let canvas, ctx, y, pagina = 0;
  const val = x => x === null || x === undefined || String(x).trim() === "" ? "—" : String(x);
  function linea(x1, y1, x2, y2, color = "#d8e0eb") {
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath();
    ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
  }
  function texto(str,x,yy,size=23,bold=false,color="#17253e",max=C) {
    ctx.font=(bold?"bold ":"")+size+"px Arial"; ctx.fillStyle=color;
    const words=val(str).replace(/\s+/g," ").split(" ");
    const lines=[]; let current="";
    for(let word of words){
      // Divide tokens exceptionally long to avoid clipping.
      while(ctx.measureText(word).width>max && word.length>1){
        let cut=1;while(cut<word.length && ctx.measureText(word.slice(0,cut+1)).width<=max)cut++;
        if(current){lines.push(current);current="";}
        lines.push(word.slice(0,cut));word=word.slice(cut);
      }
      const next=current?current+" "+word:word;
      if(current && ctx.measureText(next).width>max){lines.push(current);current=word;}else current=next;
    }
    if(current)lines.push(current);
    lines.forEach((line,i)=>ctx.fillText(line,x,yy+i*(size+7)));
    return Math.max(1,lines.length)*(size+7);
  }
  function inicio() {
    if(canvas) paginas.push(canvas.toDataURL("image/jpeg",0.91).split(",")[1]);
    canvas=document.createElement("canvas");canvas.width=W;canvas.height=H;
    ctx=canvas.getContext("2d");ctx.fillStyle="#fff";ctx.fillRect(0,0,W,H);pagina++;
    ctx.fillStyle="#0B1C40";ctx.fillRect(0,0,W,20);
    if(logoImagen && logoImagen.complete && logoImagen.naturalWidth>0){
      const scale=Math.min(128/logoImagen.naturalWidth,128/logoImagen.naturalHeight);
      const w=logoImagen.naturalWidth*scale,h=logoImagen.naturalHeight*scale;
      ctx.drawImage(logoImagen,M+(128-w)/2,45+(128-h)/2,w,h);
    }else{
      ctx.fillStyle="#eef2f8";ctx.fillRect(M,45,128,128);
      texto("TO",M+36,125,36,true,"#0B1C40",65);
    }
    const sx=M+156;
    texto(nombreOptica.toUpperCase(),sx,75,38,true,"#0B1C40",W-sx-M);
    const info=[identidad.nit_optica?"NIT "+identidad.nit_optica:"",identidad.telefono_optica||"",identidad.direccion_optica||""].filter(Boolean);
    let iy=112;
    info.forEach(t=>{iy+=texto(t,sx,iy,19,false,"#526278",W-sx-M)+2;});
    linea(M,190,W-M,190,"#0B1C40");
    texto("HISTORIA CLÍNICA OPTOMÉTRICA",M,238,31,true,"#0B1C40");
    texto("Consulta finalizada · Copia fiel del registro almacenado",M,274,19,false,"#667085");
    texto("Folio: "+val(d.id||String(registro.id).slice(0,13)),W-425,274,18,true,"#46536b",349);
    y=306;
  }
  function asegurar(altura) { if(y+altura>H-165) inicio(); }
  function seccion(nombreSeccion) {
    asegurar(72);ctx.fillStyle="#eef3fa";ctx.fillRect(M,y,C,45);
    ctx.fillStyle="#0B1C40";ctx.fillRect(M,y,7,45);
    texto(nombreSeccion.toUpperCase(),M+24,y+30,22,true,"#0B1C40");
    y+=60;
  }
  function grilla(celdas,columnas=3) {
    const ancho=C/columnas, alturas=celdas.map(([k,v])=>{
      ctx.font="22px Arial";const lines=Math.max(1,Math.ceil(val(v).length/Math.max(18,Math.floor(ancho/13))));
      return 30+lines*27+12;
    });
    const alto=Math.max(85,...alturas);
    asegurar(alto+6);
    celdas.forEach(([label,valor],i)=>{
      const x=M+i*ancho;ctx.fillStyle="#5f6b7d";texto(label,x+13,y+24,17,true,"#5f6b7d",ancho-26);
      texto(valor,x+13,y+53,22,false,"#0B1C40",ancho-26);
      if(i)linea(x,y,x,y+alto);
    });
    linea(M,y+alto,W-M,y+alto);y+=alto+10;
  }
  function bloque(label,valor) {
    if(val(valor)==="—")return;
    ctx.font="22px Arial";const approx=Math.max(1,Math.ceil(val(valor).length/85));
    asegurar(58+approx*32);
    texto(label,M+8,y+23,19,true,"#526278");y+=34;
    y+=texto(valor,M+13,y+22,22,false,"#17253e",C-26)+15;
    linea(M,y,W-M,y);y+=12;
  }
  function tabla(headers,rows,widths) {
    const full=C, xvalues=[M];
    widths.forEach(w=>xvalues.push(xvalues[xvalues.length-1]+full*w));
    const rh=56;asegurar((rows.length+1)*rh+12);
    ctx.fillStyle="#0B1C40";ctx.fillRect(M,y,C,rh);
    headers.forEach((h,i)=>texto(h,xvalues[i]+10,y+35,17,true,"#fff",full*widths[i]-18));y+=rh;
    rows.forEach((row,j)=>{
      ctx.fillStyle=j%2?"#fff":"#f1f5fa";ctx.fillRect(M,y,C,rh);
      row.forEach((value,i)=>texto(value,xvalues[i]+10,y+35,19,i===0,"#19273c",full*widths[i]-18));
      linea(M,y+rh,W-M,y+rh);y+=rh;
    });y+=14;
  }
  function firma() {
    asegurar(150);y+=62;
    linea(M,y,M+470,y,"#6e7786");linea(W-M-470,y,W-M,y,"#6e7786");
    texto(val(registro.optometra_nombre||d.optometra),M,y+32,20,true,"#0B1C40",460);
    texto("Firma y registro del profesional",M,y+60,17,false,"#667085");
    texto("Firma del paciente / acudiente",W-M-470,y+32,19,false,"#667085");
    y+=106;
  }
  inicio();
  seccion("Identificación y consulta");
  grilla([["Paciente",nombre],["Documento",[p.tipo_documento||d.tipoDoc,p.documento||d.documento].filter(Boolean).join(" ")],["Fecha",d.fechaConsulta||registro.fecha_consulta]]);
  grilla([["Edad",d.edad],["Teléfono",d.telefono],["EPS",d.eps]]);
  grilla([["Nacimiento",d.fechaNacimiento],["Ocupación",d.ocupacion],["Acompañante",d.acompanante]]);
  bloque("Dirección del paciente",d.direccion);
  bloque("Motivo de consulta",d.motivoConsulta||d.motivo);
  bloque("Antecedentes",d.antecedentes);

  seccion("Evaluación optométrica");
  tabla(["Examen","Ojo derecho (OD)","Ojo izquierdo (OI)"],[
    ["AV sin corrección lejos",d.avScOdLejos,d.avScOiLejos],
    ["AV sin corrección cerca",d.avScOdCerca,d.avScOiCerca],
    ["Lensometría",d.lensoOd,d.lensoOi]
  ],[0.38,0.31,0.31]);
  bloque("Biomicroscopía",d.biomicroscopia);
  bloque("Oftalmoscopia",d.oftalmoscopia);
  bloque("Motilidad ocular",d.motilidad);

  seccion("Fórmula optométrica");
  const rx=(prefix,label)=>[label,d[prefix+"Esfera"],d[prefix+"Cilindro"],d[prefix+"Eje"],d[prefix+"Adicion"],d[prefix+"AvLejos"],d[prefix+"AvCerca"],d[prefix+"Dnp"]];
  tabla(["Ojo","Esfera","Cil.","Eje","Adición","AV VL","AV VC","DNP"],[
    rx("od","OD"),rx("oi","OI")
  ],[0.085,0.12,0.12,0.105,0.155,0.135,0.135,0.145]);
  grilla([["DP total",d.dp],["CIE-10",[d.cie1,d.cie2,d.cie3,d.cie4,d.cie5].filter(Boolean).join(" · ")],["Diagnóstico",d.diagnostico]],3);

  seccion("Tratamiento e indicaciones");
  grilla([["Lente / material",d.tipoLente],["Montura",d.montura]],2);
  bloque("Recomendaciones y control",d.notas);

  const pagos=[d.precioTotal,d.valorAbonado,d.saldoPendiente,d.metodoPago].some(v=>v!==undefined&&v!==null&&v!=="");
  if(pagos){
    seccion("Resumen económico");
    grilla([["Total",d.precioTotal],["Abono",d.valorAbonado],["Saldo",d.saldoPendiente]],3);
    bloque("Método de pago",d.metodoPago);
  }
  const usados=new Set(["id","nombre","tipoDoc","documento","fechaConsulta","horaConsulta","optometra","timestamp","modo","edad","telefono","eps","fechaNacimiento","ocupacion","acompanante","direccion","motivoConsulta","motivo","antecedentes","avScOdLejos","avScOiLejos","avScOdCerca","avScOiCerca","lensoOd","lensoOi","biomicroscopia","oftalmoscopia","motilidad","dp","cie1","cie2","cie3","cie4","cie5","diagnostico","tipoLente","montura","notas","precioTotal","valorAbonado","saldoPendiente","metodoPago",
  ...["od","oi"].flatMap(pre=>["Esfera","Cilindro","Eje","Adicion","AvLejos","AvCerca","Dnp"].map(s=>pre+s))]);
  const extras=Object.entries(d).filter(([k,v])=>!usados.has(k)&&v!==null&&v!==undefined&&v!=="");
  if(extras.length){seccion("Información clínica complementaria");extras.forEach(([k,v])=>bloque(k.replace(/([a-z])([A-Z])/g,"$1 $2"),typeof v==="object"?JSON.stringify(v):v));}
  firma();
  paginas.push(canvas.toDataURL("image/jpeg",0.91).split(",")[1]);

  // Documento PDF estándar: una imagen JPEG por página.
  const enc = new TextEncoder(), partes=[], offsets=[0];
  let longitud=0;
  function add(bytes) { partes.push(bytes); longitud+=bytes.length; }
  function ascii(txt) { add(enc.encode(txt)); }
  function objeto(n, cuerpo) {
    offsets[n]=longitud; ascii(n+" 0 obj\n"+cuerpo+"\nendobj\n");
  }
  function binario(base64) {
    const raw=atob(base64), bytes=new Uint8Array(raw.length);
    for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
    return bytes;
  }
  const total=2+paginas.length*3;
  ascii("%PDF-1.4\n");
  objeto(1,"<< /Type /Catalog /Pages 2 0 R >>");
  objeto(2,"<< /Type /Pages /Kids ["+paginas.map((_,i)=>(3+i*3)+" 0 R").join(" ")+"] /Count "+paginas.length+" >>");
  paginas.forEach((base64,i)=>{
    const pg=3+i*3, imagen=pg+1, contenido=pg+2, jpeg=binario(base64);
    objeto(pg,"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Img"+i+" "+imagen+" 0 R >> >> /Contents "+contenido+" 0 R >>");
    offsets[imagen]=longitud;
    ascii(imagen+" 0 obj\n<< /Type /XObject /Subtype /Image /Width "+ancho+" /Height "+alto+" /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length "+jpeg.length+" >>\nstream\n");
    add(jpeg); ascii("\nendstream\nendobj\n");
    const dibujo="q 612 0 0 792 0 0 cm /Img"+i+" Do Q";
    objeto(contenido,"<< /Length "+enc.encode(dibujo).length+" >>\nstream\n"+dibujo+"\nendstream");
  });
  const inicioXref=longitud;
  ascii("xref\n0 "+(total+1)+"\n0000000000 65535 f \n");
  for(let n=1;n<=total;n++)ascii(String(offsets[n]).padStart(10,"0")+" 00000 n \n");
  ascii("trailer\n<< /Size "+(total+1)+" /Root 1 0 R >>\nstartxref\n"+inicioXref+"\n%%EOF");
  const archivo=new Blob(partes,{type:"application/pdf"});
  const url=URL.createObjectURL(archivo);
  const nombreArchivo=("Historia_clinica_"+nombre).normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9_-]+/g,"_").slice(0,75)+"_formato_clinico_"+Date.now()+".pdf";
  const enlace=document.createElement("a"); enlace.href=url; enlace.download=nombreArchivo;
  document.body.append(enlace); enlace.click(); enlace.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
  return nombreArchivo;
}
