-- =====================================================================
-- GERENCIAL BN — ESTRUTURA DO BANCO (limpa, sem nada do GSER)
-- Rode este arquivo inteiro no Supabase: SQL Editor > New query > Run.
-- Pode rodar mais de uma vez sem estragar nada.
-- Depois rode o 2-migrar-dados-antigos.sql para trazer os dados atuais.
-- =====================================================================

-- ---------- USUÁRIOS ----------
create table if not exists public.bn_usuarios (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,
  email text,
  perfil text not null default 'operador' check (perfil in ('gestor','operador','consulta')),
  ativo boolean not null default false,
  criado_em timestamptz not null default now()
);

-- Funções de segurança (usadas pelas regras de acesso de todas as tabelas)
create or replace function public.bn_ativo() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.bn_usuarios where id = auth.uid() and ativo);
$$;
create or replace function public.bn_pode_editar() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.bn_usuarios where id = auth.uid() and ativo and perfil in ('gestor','operador'));
$$;
create or replace function public.bn_gestor() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.bn_usuarios where id = auth.uid() and ativo and perfil = 'gestor');
$$;

-- Toda conta criada no login ganha uma ficha de usuário, INATIVA, aguardando o gestor liberar.
-- Exceção: se ainda não existe nenhum gestor, a primeira conta já entra como gestor ativo.
create or replace function public.bn_novo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
declare primeiro boolean;
begin
  select not exists (select 1 from public.bn_usuarios where perfil = 'gestor' and ativo) into primeiro;
  insert into public.bn_usuarios (id, nome, email, perfil, ativo)
  values (new.id, coalesce(new.raw_user_meta_data->>'nome', new.raw_user_meta_data->>'full_name', new.email), new.email,
          case when primeiro then 'gestor' else 'operador' end, primeiro)
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists bn_novo_usuario on auth.users;
create trigger bn_novo_usuario after insert on auth.users
  for each row execute function public.bn_novo_usuario();

-- ---------- CONTRATOS E SERVIÇOS ----------
create table if not exists public.bn_contratos (
  id uuid primary key default gen_random_uuid(),
  numero text not null,
  cliente text not null,
  objeto text,
  tipo text not null default 'publico' check (tipo in ('publico','privado')),
  inicio date,
  fim date,
  valor_total numeric(14,2),
  situacao text not null default 'ativo' check (situacao in ('ativo','encerrado','sem_contrato')),
  obs text,
  criado_em timestamptz not null default now()
);

-- Serviço / unidade de atendimento (Maternidade 1, COE, Vitria...). O teto é por serviço.
create table if not exists public.bn_unidades (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  slug text not null unique,
  cor text not null default '#0e7c5a',
  aliquota numeric(6,4) not null default 0.17,          -- imposto sobre o faturamento
  contrato_id uuid references public.bn_contratos(id) on delete set null,
  teto_qtd integer,                                     -- nº de atendimentos
  teto_tipo text not null default 'total' check (teto_tipo in ('total','mensal')),
  valor_norte numeric(12,2),                            -- R$ por atendimento (referência)
  ordem integer not null default 0,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

-- Turnos de cada serviço, com o valor por paciente (faturamento e repasse)
create table if not exists public.bn_turnos (
  id uuid primary key default gen_random_uuid(),
  unidade_id uuid not null references public.bn_unidades(id) on delete cascade,
  chave text not null,
  rotulo text not null,
  fat_paciente numeric(12,2) not null default 0,
  rep_paciente numeric(12,2) not null default 0,
  ordem integer not null default 0,
  unique (unidade_id, chave)
);

-- ---------- PESSOAS ----------
create table if not exists public.bn_pessoas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  tipo text not null default 'medico' check (tipo in ('medico','equipe')),
  crm text,
  especialidade text,
  funcao text,
  telefone text,
  email text,
  ativo boolean not null default true,
  obs text,
  criado_em timestamptz not null default now()
);
create table if not exists public.bn_pessoa_unidades (
  id uuid primary key default gen_random_uuid(),
  pessoa_id uuid not null references public.bn_pessoas(id) on delete cascade,
  unidade_id uuid not null references public.bn_unidades(id) on delete cascade,
  unique (pessoa_id, unidade_id)
);

-- ---------- ESCALA E REPASSE ----------
create table if not exists public.bn_escala (
  id uuid primary key default gen_random_uuid(),
  unidade_id uuid not null references public.bn_unidades(id) on delete cascade,
  data date not null,
  turno text not null,
  pessoa_id uuid references public.bn_pessoas(id) on delete set null,
  pacientes integer not null default 0 check (pacientes >= 0),
  status text not null default 'vago' check (status in ('vago','realizado','confirmado','cancelado')),
  obs text,
  atualizado_em timestamptz not null default now(),
  unique (unidade_id, data, turno)
);
create index if not exists bn_escala_data on public.bn_escala (data);

create table if not exists public.bn_repasses (
  id uuid primary key default gen_random_uuid(),
  pessoa_id uuid not null references public.bn_pessoas(id) on delete cascade,
  unidade_id uuid not null references public.bn_unidades(id) on delete cascade,
  competencia date not null,                            -- sempre o dia 1 do mês
  pago numeric(14,2) not null default 0,
  pago_pacientes integer not null default 0,
  pago_em date,
  recebido numeric(14,2) not null default 0,
  recebido_pacientes integer not null default 0,
  recebido_em date,
  unique (pessoa_id, unidade_id, competencia)
);

-- ---------- FINANCEIRO ----------
create table if not exists public.bn_lancamentos (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('entrada','despesa')),
  data date not null,
  competencia date not null,
  periodo_ini date,
  periodo_fim date,
  categoria text not null,
  descricao text,
  valor numeric(14,2) not null check (valor >= 0),
  unidade_id uuid references public.bn_unidades(id) on delete set null,
  contrato_id uuid references public.bn_contratos(id) on delete set null,
  aporte boolean not null default false,
  origem text,
  situacao text not null default 'liquidado' check (situacao in ('liquidado','aberto','dea')),
  forma_pagamento text,
  nf_numero text,
  tem_nf boolean not null default false,
  criado_em timestamptz not null default now()
);
create index if not exists bn_lancamentos_comp on public.bn_lancamentos (competencia);

-- ---------- QUALIDADE E COMPLIANCE ----------
create table if not exists public.bn_documentos (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  categoria text not null default 'Certidão',
  orgao text,
  numero text,
  emissao date,
  validade date,
  pessoa_id uuid references public.bn_pessoas(id) on delete cascade,  -- vazio = documento da empresa
  link text,
  obs text,
  criado_em timestamptz not null default now()
);

-- ---------- PROCESSOS E PROJETOS ----------
create table if not exists public.bn_processos (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  tipo text not null default 'credenciamento' check (tipo in ('credenciamento','licitacao','projeto','interno')),
  orgao text,
  etapa text not null default 'prospeccao'
    check (etapa in ('prospeccao','documentacao','proposta','analise','contratado','encerrado')),
  responsavel text,
  prazo date,
  valor_estimado numeric(14,2),
  contrato_id uuid references public.bn_contratos(id) on delete set null,
  obs text,
  criado_em timestamptz not null default now()
);
create table if not exists public.bn_tarefas (
  id uuid primary key default gen_random_uuid(),
  processo_id uuid not null references public.bn_processos(id) on delete cascade,
  titulo text not null,
  responsavel text,
  prazo date,
  feito boolean not null default false,
  criado_em timestamptz not null default now()
);

-- =====================================================================
-- REGRAS DE ACESSO (RLS) — nenhuma tabela fica aberta.
--   ler:    qualquer usuário ATIVO
--   gravar: gestor ou operador ativos
--   usuários: só o gestor altera perfil / ativa alguém
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array['bn_contratos','bn_unidades','bn_turnos','bn_pessoas','bn_pessoa_unidades',
                           'bn_escala','bn_repasses','bn_lancamentos','bn_documentos','bn_processos','bn_tarefas']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_ler', t);
    execute format('drop policy if exists %I on public.%I', t || '_gravar', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.bn_ativo())', t || '_ler', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.bn_pode_editar()) with check (public.bn_pode_editar())', t || '_gravar', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

alter table public.bn_usuarios enable row level security;
drop policy if exists bn_usuarios_ler on public.bn_usuarios;
drop policy if exists bn_usuarios_gestor on public.bn_usuarios;
create policy bn_usuarios_ler on public.bn_usuarios for select to authenticated
  using (id = auth.uid() or public.bn_ativo());
create policy bn_usuarios_gestor on public.bn_usuarios for update to authenticated
  using (public.bn_gestor()) with check (public.bn_gestor());
grant select, update on public.bn_usuarios to authenticated;
revoke all on public.bn_usuarios from anon;

-- Contas que já existem no login ganham ficha (inativa) — o passo 2 copia os perfis antigos por cima.
insert into public.bn_usuarios (id, nome, email, perfil, ativo)
select u.id, coalesce(u.raw_user_meta_data->>'full_name', u.email), u.email, 'operador', false
from auth.users u
on conflict (id) do nothing;

select 'Estrutura criada. Agora rode o arquivo 2-migrar-dados-antigos.sql' as resultado;
