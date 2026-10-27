-- PROFILE-01: foto de perfil en Supabase Storage.
-- Correr UNA vez en Supabase → SQL Editor (o crear lo mismo desde el panel).
--
-- Bucket PRIVADO "avatars". Cada usuario tiene una sola ruta posible:
--   avatars/<auth.uid()>/avatar
-- y solo puede leer, crear, reemplazar o borrar ESA ruta. Nadie puede
-- listar, leer ni escribir la foto de otro usuario. La app lee la foto con
-- signed URLs de 1 hora. Nunca se usa service_role en el frontend.

-- 1. Bucket privado, máximo 1 MB, solo WebP/JPEG (la app comprime a 512x512).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 1048576, array['image/webp', 'image/jpeg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 2. Políticas sobre storage.objects (RLS ya está activo en esa tabla).
--    La condición es la misma en las cuatro: bucket "avatars" y el nombre
--    exacto "<uid del usuario autenticado>/avatar".

create policy "avatars: leer la propia"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'avatars' and name = (select auth.uid())::text || '/avatar');

create policy "avatars: subir la propia"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'avatars' and name = (select auth.uid())::text || '/avatar');

create policy "avatars: reemplazar la propia"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'avatars' and name = (select auth.uid())::text || '/avatar')
  with check (bucket_id = 'avatars' and name = (select auth.uid())::text || '/avatar');

create policy "avatars: borrar la propia"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'avatars' and name = (select auth.uid())::text || '/avatar');
