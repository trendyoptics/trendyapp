-- Ejecutar SOLO después de crear y confirmar en Authentication > Users
-- la cuenta controlada: trendyoptics1+externo@gmail.com.
-- No hace cambios si el correo no existe o está sin confirmar.
insert into public.usuarios_tsysoptics (id, nombre, rol, activo)
select id, 'Externo - Demostracion', 'externo', true
from auth.users
where lower(email) = lower('trendyoptics1+externo@gmail.com')
  and email_confirmed_at is not null
on conflict (id) do update
set nombre = excluded.nombre, rol = excluded.rol, activo = excluded.activo;

-- Resultado esperado: una fila con 'externo', true.
select u.nombre, u.rol, u.activo
from public.usuarios_tsysoptics u
join auth.users a on a.id = u.id
where lower(a.email) = lower('trendyoptics1+externo@gmail.com');
