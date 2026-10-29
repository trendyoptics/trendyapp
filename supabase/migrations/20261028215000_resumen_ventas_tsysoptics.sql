-- Resumen financiero global con permisos RLS de la sesión.
BEGIN;
CREATE OR REPLACE FUNCTION public.resumen_ventas_tsysoptics()
RETURNS TABLE(cantidad bigint,total numeric,recibido numeric,pendiente numeric)
LANGUAGE sql SECURITY INVOKER
SET search_path=pg_catalog,public
AS $$
 SELECT count(*),
        coalesce(sum(v.total),0),
        coalesce(sum(v.abonado),0),
        coalesce(sum(v.saldo),0)
 FROM public.ventas_tsysoptics v
$$;
REVOKE ALL ON FUNCTION public.resumen_ventas_tsysoptics() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.resumen_ventas_tsysoptics() TO authenticated;
COMMIT;