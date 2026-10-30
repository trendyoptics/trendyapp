-- Datos iniciales EXCLUSIVOS de la instalación fundadora TrendyOptics.
-- La migración no sobreescribe modificaciones hechas por el administrador.
-- No usar como seed universal ni para instalaciones de otras ópticas.
UPDATE public.identidad_optica_tsysoptics
SET
 nit_optica = CASE WHEN trim(coalesce(nit_optica,''))='' THEN '1073263942-5' ELSE nit_optica END,
 direccion_optica = CASE WHEN trim(coalesce(direccion_optica,''))='' THEN 'Calle 39a Sur N 87d - 58, Patio Bonito, Bogotá D.C.' ELSE direccion_optica END,
 telefono_optica = CASE WHEN trim(coalesce(telefono_optica,''))='' THEN '+57 3003391055' ELSE telefono_optica END
WHERE id=1
  AND regexp_replace(upper(coalesce(nombre_optica,'')),'[^A-Z]','','g')='TRENDYOPTICS'
  AND (trim(coalesce(nit_optica,''))='' OR trim(coalesce(direccion_optica,''))='' OR trim(coalesce(telefono_optica,''))='');
