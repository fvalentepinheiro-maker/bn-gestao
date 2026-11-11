# Gerencial BN — versão reconstruída (sem GSER)

Sistema próprio da BN Med: login com perfis, Escala, Repasse médico, Financeiro,
Contratos e tetos, Processos e Projetos, Pessoas, Qualidade e Compliance, Usuários.

## Onde está cada coisa
- `index.html` — só a casca da página (não tem código).
- `css/app.css` — aparência.
- `js/` — todo o código-fonte: `nucleo.js` (login e banco), `calculo.js` (regras de
  faturamento, repasse, imposto e teto), `app.js` (menu) e um arquivo por módulo em `js/modulos/`.
- `config.js` — endereço e chave pública do Supabase.
- `banco/` — os 3 arquivos SQL.
- `testes/` — conferência das regras de cálculo (`node testes/calculo.test.mjs`).

## Para colocar no ar (nesta ordem)
1. Supabase > SQL Editor: rode `banco/1-estrutura.sql`.
2. Rode `banco/2-migrar-dados-antigos.sql`. Ele só COPIA os dados atuais (tabelas `cm_`)
   para as tabelas novas (`bn_`) e mostra uma tabela de conferência no fim.
3. Confira os números com o sistema atual. Só então publique esta versão no lugar da antiga.
4. `banco/3-remover-gser-OPCIONAL.sql` apaga as tabelas antigas. Não rode antes de usar
   a versão nova por algumas semanas.

Perfis: gestor (tudo, inclusive liberar usuários), operador (lança e edita), consulta (só vê).
Conta nova entra bloqueada até um gestor liberar.
