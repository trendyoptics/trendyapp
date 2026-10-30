-- Nuevo mensaje estándar para las instalaciones que no lo hayan personalizado.
-- Las personalizaciones ya editadas por administradores no se reemplazan.
ALTER TABLE public.identidad_optica_tsysoptics
 ALTER COLUMN mensaje_whatsapp SET DEFAULT '¡Nos alegra que nos hayas elegido! Gracias por confiar en {optica}. Te compartimos tu documento de compra {venta} en PDF. ¡Disfruta tus nuevos lentes!';

UPDATE public.identidad_optica_tsysoptics
 SET mensaje_whatsapp='¡Nos alegra que nos hayas elegido! Gracias por confiar en {optica}. Te compartimos tu documento de compra {venta} en PDF. ¡Disfruta tus nuevos lentes!'
 WHERE mensaje_whatsapp='Gracias por elegir {optica}. Te compartimos la información de tu compra {venta} en PDF.';
