-- =====================================================================
-- GERENCIAL BN — TRAZER OS DADOS DO SISTEMA ANTIGO (tabelas cm_ do GSER)
-- Rode DEPOIS do 1-estrutura.sql. Só COPIA: não apaga nem altera nada antigo.
-- Pode rodar de novo: quem já foi copiado é atualizado, não duplica.
-- =====================================================================
do $$
declare n integer;
begin
  -- Usuários (perfis antigos: manager / operator / demais = consulta)
  if to_regclass('public.cm_profiles') is not null then
    insert into public.bn_usuarios (id, nome, email, perfil, ativo)
    select (j->>'id')::uuid, coalesce(j->>'full_name', j->>'email', 'Usuário'), j->>'email',
           case j->>'role' when 'manager' then 'gestor' when 'operator' then 'operador' else 'consulta' end,
           coalesce((j->>'is_active')::boolean, false)
    from public.cm_profiles p, lateral to_jsonb(p) j
    where exists (select 1 from auth.users u where u.id = (j->>'id')::uuid)
    on conflict (id) do update set nome = excluded.nome, email = excluded.email, perfil = excluded.perfil, ativo = excluded.ativo;
    get diagnostics n = row_count; raise notice 'usuários: %', n;
  end if;

  -- Contratos
  if to_regclass('public.cm_contracts') is not null then
    insert into public.bn_contratos (id, numero, cliente, objeto, tipo, inicio, fim, valor_total, situacao, obs)
    select (j->>'id')::uuid,
           coalesce(nullif(j->>'contract_number',''), 'S/N'),
           coalesce(nullif(j->>'supplier_name',''), '—'),
           coalesce(j->>'object', j->>'description', j->>'contract_object'),
           'publico',
           nullif(j->>'start_date','')::date, nullif(j->>'end_date','')::date,
           coalesce(nullif(j->>'current_contract_value','')::numeric, nullif(j->>'original_value','')::numeric),
           case when (j->>'contract_number') ilike 'SEM CONTRATO%' then 'sem_contrato'
                when lower(coalesce(j->>'status','')) ~ '^(encerr|inativ|finaliz|closed|inactive|ended)' then 'encerrado'
                else 'ativo' end,
           coalesce(j->>'cap_notes', j->>'notes')
    from public.cm_contracts c, lateral to_jsonb(c) j
    on conflict (id) do update set numero = excluded.numero, cliente = excluded.cliente, objeto = excluded.objeto,
      inicio = excluded.inicio, fim = excluded.fim, valor_total = excluded.valor_total, situacao = excluded.situacao;
    get diagnostics n = row_count; raise notice 'contratos: %', n;
  end if;

  -- Serviços / unidades da escala
  if to_regclass('public.cm_schedule_units') is not null then
    insert into public.bn_unidades (id, nome, slug, cor, aliquota, contrato_id, teto_qtd, teto_tipo, valor_norte, ordem, ativo)
    select (j->>'id')::uuid, j->>'name', j->>'slug', coalesce(nullif(j->>'color',''), '#0e7c5a'),
           coalesce(nullif(j->>'tax_rate','')::numeric, 0.17),
           (select id from public.bn_contratos where id = nullif(j->>'contract_id','')::uuid),
           nullif(j->>'teto_qtd','')::numeric::integer,
           case when j->>'slug' in ('coe','vitoria','vitria') then 'mensal' else 'total' end,   -- COE e Vitria: teto por mês
           nullif(j->>'valor_norte','')::numeric,
           coalesce(nullif(j->>'display_order','')::integer, 0),
           coalesce((j->>'is_active')::boolean, true)
    from public.cm_schedule_units u, lateral to_jsonb(u) j
    on conflict (id) do update set nome = excluded.nome, cor = excluded.cor, aliquota = excluded.aliquota,
      contrato_id = excluded.contrato_id, teto_qtd = excluded.teto_qtd, valor_norte = excluded.valor_norte, ordem = excluded.ordem;
    get diagnostics n = row_count; raise notice 'serviços: %', n;
  end if;

  -- Turnos e valores por paciente
  if to_regclass('public.cm_schedule_period_rates') is not null then
    insert into public.bn_turnos (unidade_id, chave, rotulo, fat_paciente, rep_paciente, ordem)
    select (j->>'unit_id')::uuid, j->>'period_key', coalesce(j->>'period_label', j->>'period_key'),
           coalesce(nullif(j->>'billing_per_patient','')::numeric, 0),
           coalesce(nullif(j->>'transfer_per_patient','')::numeric, 0),
           coalesce(nullif(j->>'display_order','')::integer, 0)
    from public.cm_schedule_period_rates r, lateral to_jsonb(r) j
    where exists (select 1 from public.bn_unidades where id = (j->>'unit_id')::uuid)
    on conflict (unidade_id, chave) do update set rotulo = excluded.rotulo, fat_paciente = excluded.fat_paciente,
      rep_paciente = excluded.rep_paciente, ordem = excluded.ordem;
    get diagnostics n = row_count; raise notice 'turnos: %', n;
  end if;

  -- Médicos
  if to_regclass('public.cm_physicians') is not null then
    insert into public.bn_pessoas (id, nome, tipo, crm, especialidade, telefone, email, ativo)
    select (j->>'id')::uuid, j->>'full_name', 'medico', j->>'crm', j->>'specialty', j->>'phone', j->>'email',
           coalesce((j->>'is_active')::boolean, true)
    from public.cm_physicians p, lateral to_jsonb(p) j
    on conflict (id) do update set nome = excluded.nome, crm = excluded.crm, especialidade = excluded.especialidade,
      telefone = excluded.telefone, ativo = excluded.ativo;
    get diagnostics n = row_count; raise notice 'médicos: %', n;
  end if;

  if to_regclass('public.cm_physician_units') is not null then
    insert into public.bn_pessoa_unidades (pessoa_id, unidade_id)
    select (j->>'physician_id')::uuid, (j->>'unit_id')::uuid
    from public.cm_physician_units x, lateral to_jsonb(x) j
    where exists (select 1 from public.bn_pessoas where id = (j->>'physician_id')::uuid)
      and exists (select 1 from public.bn_unidades where id = (j->>'unit_id')::uuid)
    on conflict (pessoa_id, unidade_id) do nothing;
    get diagnostics n = row_count; raise notice 'vínculos médico-serviço: %', n;
  end if;

  -- Escala (situação antiga "preenchido" = "realizado" no sistema novo)
  if to_regclass('public.cm_schedule_slots') is not null then
    insert into public.bn_escala (unidade_id, data, turno, pessoa_id, pacientes, status, obs)
    select (j->>'unit_id')::uuid, (j->>'slot_date')::date, j->>'period_key',
           (select id from public.bn_pessoas where id = nullif(j->>'physician_id','')::uuid),
           greatest(coalesce(nullif(j->>'patients','')::numeric::integer, 0), 0),
           case j->>'status' when 'preenchido' then 'realizado' when 'confirmado' then 'confirmado'
                             when 'cancelado' then 'cancelado' else 'vago' end,
           j->>'notes'
    from public.cm_schedule_slots s, lateral to_jsonb(s) j
    where exists (select 1 from public.bn_unidades where id = (j->>'unit_id')::uuid)
    on conflict (unidade_id, data, turno) do update set pessoa_id = excluded.pessoa_id, pacientes = excluded.pacientes,
      status = excluded.status, obs = excluded.obs;
    get diagnostics n = row_count; raise notice 'lançamentos de escala: %', n;
  end if;

  -- Repasse (pago ao médico / recebido do cliente)
  if to_regclass('public.cm_physician_payments') is not null then
    insert into public.bn_repasses (pessoa_id, unidade_id, competencia, pago, pago_pacientes, pago_em, recebido, recebido_pacientes, recebido_em)
    select (j->>'physician_id')::uuid, (j->>'unit_id')::uuid, date_trunc('month', (j->>'competence')::date)::date,
           coalesce(nullif(j->>'paid_value','')::numeric, 0), coalesce(nullif(j->>'paid_patients','')::numeric::integer, 0),
           nullif(j->>'paid_at','')::date,
           coalesce(nullif(j->>'received_value','')::numeric, 0), coalesce(nullif(j->>'received_patients','')::numeric::integer, 0),
           nullif(j->>'received_at','')::date
    from public.cm_physician_payments p, lateral to_jsonb(p) j
    where exists (select 1 from public.bn_pessoas where id = (j->>'physician_id')::uuid)
      and exists (select 1 from public.bn_unidades where id = (j->>'unit_id')::uuid)
    on conflict (pessoa_id, unidade_id, competencia) do update set pago = excluded.pago, pago_pacientes = excluded.pago_pacientes,
      pago_em = excluded.pago_em, recebido = excluded.recebido, recebido_pacientes = excluded.recebido_pacientes, recebido_em = excluded.recebido_em;
    get diagnostics n = row_count; raise notice 'repasses: %', n;
  end if;

  -- Financeiro
  if to_regclass('public.cm_fin_entries') is not null then
    insert into public.bn_lancamentos (id, tipo, data, competencia, periodo_ini, periodo_fim, categoria, descricao, valor,
                                       unidade_id, contrato_id, aporte, origem, situacao, forma_pagamento, nf_numero, tem_nf)
    select (j->>'id')::uuid,
           case when j->>'kind' = 'entrada' then 'entrada' else 'despesa' end,
           coalesce(nullif(j->>'entry_date','')::date, (j->>'competence')::date),
           date_trunc('month', coalesce(nullif(j->>'competence','')::date, (j->>'entry_date')::date))::date,
           nullif(j->>'period_start','')::date, nullif(j->>'period_end','')::date,
           coalesce(nullif(j->>'category',''), 'Outros'), j->>'description',
           abs(coalesce(nullif(j->>'amount','')::numeric, 0)),
           (select id from public.bn_unidades where id = nullif(j->>'unit_id','')::uuid),
           (select id from public.bn_contratos where id = nullif(j->>'contract_id','')::uuid),
           coalesce((j->>'is_aporte')::boolean, false), j->>'source',
           case j->>'status_fin' when 'aberto' then 'aberto' when 'dea' then 'dea' else 'liquidado' end,
           j->>'payment_method', j->>'nf_number', coalesce((j->>'has_nf')::boolean, false)
    from public.cm_fin_entries f, lateral to_jsonb(f) j
    on conflict (id) do update set tipo = excluded.tipo, data = excluded.data, competencia = excluded.competencia,
      categoria = excluded.categoria, descricao = excluded.descricao, valor = excluded.valor, situacao = excluded.situacao;
    get diagnostics n = row_count; raise notice 'lançamentos financeiros: %', n;
  end if;

  -- Garantia: tem que existir pelo menos um gestor ativo para alguém conseguir entrar e liberar os demais.
  if not exists (select 1 from public.bn_usuarios where perfil = 'gestor' and ativo) then
    update public.bn_usuarios set perfil = 'gestor', ativo = true
    where id = (select id from auth.users order by created_at limit 1);
    raise notice 'nenhum gestor encontrado: a conta mais antiga virou gestor.';
  end if;
end $$;

-- Conferência: compare estes números com o que você vê no sistema antigo.
select 'usuários' as item, count(*) as quantidade from public.bn_usuarios
union all select 'contratos', count(*) from public.bn_contratos
union all select 'serviços', count(*) from public.bn_unidades
union all select 'turnos', count(*) from public.bn_turnos
union all select 'pessoas', count(*) from public.bn_pessoas
union all select 'escala (linhas)', count(*) from public.bn_escala
union all select 'escala (pacientes realizados)', coalesce(sum(pacientes),0) from public.bn_escala where status in ('realizado','confirmado')
union all select 'repasses', count(*) from public.bn_repasses
union all select 'financeiro (linhas)', count(*) from public.bn_lancamentos
union all select 'financeiro (R$ entradas)', coalesce(sum(valor),0) from public.bn_lancamentos where tipo = 'entrada'
union all select 'financeiro (R$ despesas)', coalesce(sum(valor),0) from public.bn_lancamentos where tipo = 'despesa';
