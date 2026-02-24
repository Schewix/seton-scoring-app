-- Remove obsolete Deskovky event and all dependent data.
delete from public.board_event
where id = '2838b776-7866-4212-9c29-acce27e8b103'::uuid;
