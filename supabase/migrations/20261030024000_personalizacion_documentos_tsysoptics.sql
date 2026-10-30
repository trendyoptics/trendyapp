-- Personalización por instalación: documentos comerciales y mensaje de entrega.
ALTER TABLE public.identidad_optica_tsysoptics
 ADD COLUMN IF NOT EXISTS titulo_documento text NOT NULL DEFAULT 'HISTORIA CLÍNICA Y COMPROBANTE DE VENTA',
 ADD COLUMN IF NOT EXISTS nota_garantia text NOT NULL DEFAULT 'NO SE DA GARANTÍA POR FÓRMULAS DE OTRO LUGAR.',
 ADD COLUMN IF NOT EXISTS pie_documento text NOT NULL DEFAULT 'Comprobante comercial interno. No equivale a factura electrónica DIAN.',
 ADD COLUMN IF NOT EXISTS mensaje_whatsapp text NOT NULL DEFAULT 'Gracias por elegir {optica}. Te compartimos la información de tu compra {venta} en PDF.';
ALTER TABLE public.identidad_optica_tsysoptics
 DROP CONSTRAINT IF EXISTS tsys_docs_textos_longitud;
ALTER TABLE public.identidad_optica_tsysoptics
 ADD CONSTRAINT tsys_docs_textos_longitud CHECK (
 char_length(titulo_documento) BETWEEN 2 AND 100 AND
 char_length(nota_garantia) <= 500 AND
 char_length(pie_documento) <= 500 AND
 char_length(mensaje_whatsapp) BETWEEN 5 AND 700
 );
