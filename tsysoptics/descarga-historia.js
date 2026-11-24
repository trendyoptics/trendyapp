// PDF clínico generado localmente, sin bibliotecas ni servicios externos.
export function descargarHistoriaClinicaPDF(registro) {
  if (!registro || registro.estado !== "finalizada") throw new Error("Solo se descargan historias finalizadas.");
  const datos = registro.datos_clinicos || {};
  const paciente = registro.paciente || {};
  const nombre = paciente.nombre_completo || datos.nombre || "Paciente";
  const titulo = "HISTORIA CLÍNICA OPTOMÉTRICA";
  const campos = [
    ["Paciente", nombre],
    ["Tipo de documento", paciente.tipo_documento || datos.tipoDoc],
    ["Documento", paciente.documento || datos.documento],
    ["Fecha de consulta", datos.fechaConsulta || registro.fecha_consulta],
    ["Profesional", registro.optometra_nombre || datos.optometra],
    ["Estado", "FINALIZADA"]
  ];
  const etiquetas = {
    horaConsulta:"Hora", fechaNacimiento:"Fecha de nacimiento", edad:"Edad",
    telefono:"Teléfono", direccion:"Dirección", eps:"EPS", ocupacion:"Ocupación",
    motivoConsulta:"Motivo de consulta", antecedentes:"Antecedentes",
    odEsfera:"OD esfera", odCilindro:"OD cilindro", odEje:"OD eje",
    odAdicion:"OD adición", odAvLejos:"OD agudeza visual lejana",
    odAvCerca:"OD agudeza visual cercana", odDnp:"OD DNP",
    oiEsfera:"OI esfera", oiCilindro:"OI cilindro", oiEje:"OI eje",
    oiAdicion:"OI adición", oiAvLejos:"OI agudeza visual lejana",
    oiAvCerca:"OI agudeza visual cercana", oiDnp:"OI DNP",
    dp:"Distancia pupilar", biomicroscopia:"Biomicroscopía",
    oftalmoscopia:"Oftalmoscopia", motilidad:"Motilidad",
    tipoLente:"Tipo de lente", montura:"Montura", notas:"Observaciones",
    precioTotal:"Valor total", valorAbonado:"Valor abonado",
    saldoPendiente:"Saldo pendiente", metodoPago:"Método de pago"
  };
  const omitidos = new Set(["nombre","tipoDoc","documento","fechaConsulta","optometra"]);
  Object.entries(datos).forEach(([clave, valor]) => {
    if (omitidos.has(clave) || valor === null || valor === undefined || valor === "") return;
    const texto = typeof valor === "object" ? JSON.stringify(valor) : String(valor);
    campos.push([etiquetas[clave] || clave.replace(/([a-z])([A-Z])/g,"$1 $2"), texto]);
  });

  const ancho = 1275, alto = 1650, margen = 95;
  const paginas = [];
  let canvas, ctx, y, numero = 0;
  function nuevaPagina() {
    if (canvas) paginas.push(canvas.toDataURL("image/jpeg", 0.91).split(",")[1]);
    canvas = document.createElement("canvas");
    canvas.width = ancho; canvas.height = alto;
    ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0,0,ancho,alto);
    ctx.fillStyle = "#0B1C40"; ctx.fillRect(0,0,ancho,19);
    ctx.font = "bold 37px Arial"; ctx.fillText(titulo,margen,100);
    ctx.font = "22px Arial"; ctx.fillStyle = "#585F73";
    ctx.fillText("TsysOptics · Copia de historia finalizada",margen,140);
    ctx.strokeStyle = "#BFBFBF"; ctx.beginPath(); ctx.moveTo(margen,164); ctx.lineTo(ancho-margen,164); ctx.stroke();
    y = 210; numero++;
  }
  function envolver(texto, anchura) {
    ctx.font = "24px Arial";
    const salida = [];
    const palabras = String(texto).replace(/\s+/g," ").split(" ");
    let linea = "";
    for (const palabra of palabras) {
      const candidato = linea ? linea + " " + palabra : palabra;
      if (ctx.measureText(candidato).width > anchura && linea) {
        salida.push(linea); linea = palabra;
      } else linea = candidato;
    }
    if (linea) salida.push(linea);
    return salida.length ? salida : ["—"];
  }
  nuevaPagina();
  for (const [etiqueta, valor] of campos) {
    const lineas = envolver(valor, ancho - 2*margen - 34);
    const requerido = 37 + lineas.length * 34 + 15;
    if (y + requerido > alto - 110) nuevaPagina();
    ctx.font = "bold 22px Arial"; ctx.fillStyle = "#0B1C40";
    ctx.fillText(etiqueta, margen, y);
    y += 35;
    ctx.font = "24px Arial"; ctx.fillStyle = "#1f2937";
    for (const linea of lineas) { ctx.fillText(linea,margen+12,y); y += 34; }
    ctx.strokeStyle = "#e5e7eb"; ctx.beginPath(); ctx.moveTo(margen,y+5); ctx.lineTo(ancho-margen,y+5);ctx.stroke();
    y += 26;
  }
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
    .replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9_-]+/g,"_").slice(0,90)+".pdf";
  const enlace=document.createElement("a"); enlace.href=url; enlace.download=nombreArchivo;
  document.body.append(enlace); enlace.click(); enlace.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
  return nombreArchivo;
}
