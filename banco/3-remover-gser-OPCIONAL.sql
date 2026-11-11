-- =====================================================================
-- OPCIONAL E SEM VOLTA — apaga do banco tudo que era do GSER (tabelas cm_).
-- NÃO rode agora. Rode só depois de usar o sistema novo por algumas semanas
-- e ter conferido que os números batem. Antes, faça um backup no Supabase
-- (Database > Backups) ou exporte as tabelas.
--
-- Este arquivo só LISTA o que seria apagado. Para apagar de verdade, troque
-- a palavra false por true na linha "apagar constant boolean := false;".
-- =====================================================================
do $$
declare
  apagar constant boolean := false;
  r record;
begin
  for r in select c.relname, c.relkind from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relname like 'cm\_%' and c.relkind in ('r','v','m')
           order by c.relkind desc, c.relname
  loop
    if apagar then
      if r.relkind = 'r' then execute format('drop table if exists public.%I cascade', r.relname);
      elsif r.relkind = 'v' then execute format('drop view if exists public.%I cascade', r.relname);
      else execute format('drop materialized view if exists public.%I cascade', r.relname); end if;
      raise notice 'apagado: %', r.relname;
    else
      raise notice 'seria apagado: %', r.relname;
    end if;
  end loop;
  if apagar then
    for r in select p.oid::regprocedure as assinatura from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname like 'cm\_%'
    loop execute 'drop function if exists ' || r.assinatura || ' cascade'; end loop;
  end if;
end $$;
