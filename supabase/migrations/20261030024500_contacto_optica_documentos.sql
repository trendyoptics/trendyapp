ALTER TABLE public.identidad_optica_tsysoptics
 ADD COLUMN IF NOT EXISTS nit_optica text NOT NULL DEFAULT '',
 ADD COLUMN IF NOT EXISTS direccion_optica text NOT NULL DEFAULT '',
 ADD COLUMN IF NOT EXISTS telefono_optica text NOT NULL DEFAULT '';
ALTER TABLE public.identidad_optica_tsysoptics
 DROP CONSTRAINT IF EXISTS tsys_contacto_longitud;
ALTER TABLE public.identidad_optica_tsysoptics
 ADD CONSTRAINT tsys_contacto_longitud CHECK (
 char_length(nit_optica) <= 35 AND
 char_length(direccion_optica) <= 180 AND
 char_length(telefono_optica) <= 50
 );
