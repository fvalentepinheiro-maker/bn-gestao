// Testes das regras de cálculo. Rodar:  node testes/calculo.test.mjs
import assert from 'node:assert/strict';
import * as C from '../js/calculo.js';

const turnos = [
  { unidade_id: 'mat', chave: 'manha', rotulo: 'Manhã', fat_paciente: 40, rep_paciente: 22.5 },
  { unidade_id: 'mat', chave: 'tarde', rotulo: 'Tarde', fat_paciente: 40, rep_paciente: 25 },
  { unidade_id: 'coe', chave: 'manha', rotulo: 'Manhã', fat_paciente: 33.33, rep_paciente: 10.1 },
];
const unidades = [{ id: 'mat', aliquota: 0.17, teto_qtd: 100, teto_tipo: 'total' }, { id: 'coe', aliquota: 0.17, teto_qtd: 35, teto_tipo: 'mensal' }];
const escala = [
  { unidade_id: 'mat', data: '2026-09-01', turno: 'manha', pessoa_id: 'ana', pacientes: 43, status: 'realizado' },
  { unidade_id: 'mat', data: '2026-09-01', turno: 'tarde', pessoa_id: 'gil', pacientes: 48, status: 'confirmado' },
  { unidade_id: 'mat', data: '2026-09-02', turno: 'manha', pessoa_id: 'ana', pacientes: 50, status: 'cancelado' },   // não conta
  { unidade_id: 'mat', data: '2026-09-03', turno: 'manha', pessoa_id: null, pacientes: 9, status: 'vago' },           // não conta
  { unidade_id: 'mat', data: '2026-10-01', turno: 'manha', pessoa_id: 'ana', pacientes: 10, status: 'realizado' },
  { unidade_id: 'coe', data: '2026-09-05', turno: 'manha', pessoa_id: 'ana', pacientes: 3, status: 'realizado' },
  { unidade_id: 'coe', data: '2026-10-05', turno: 'manha', pessoa_id: 'ana', pacientes: 36, status: 'realizado' },
];

// arredondamento em centavos (o clássico 0.1+0.2 e o 1.005)
assert.equal(C.r2(0.1 + 0.2), 0.3);
assert.equal(C.r2(1.005), 1.01);
assert.equal(C.r2(3 * 33.33), 99.99);

// valor de um turno
assert.deepEqual(C.valores(escala[0], turnos[0]), { pacientes: 43, fat: 1720, rep: 967.5 });
assert.deepEqual(C.valores(escala[2], turnos[0]), { pacientes: 0, fat: 0, rep: 0 });

// por médico × serviço × mês
const pm = C.porMedicoMes(escala, turnos);
const de = (p, u, m) => pm.find((a) => a.pessoa_id === p && a.unidade_id === u && a.mes === m);
assert.equal(pm.length, 5);
assert.deepEqual(de('ana', 'mat', '2026-09'), { pessoa_id: 'ana', unidade_id: 'mat', mes: '2026-09', turnos: 1, pacientes: 43, fat: 1720, rep: 967.5 });
assert.equal(de('gil', 'mat', '2026-09').rep, 1200);
assert.equal(de('ana', 'coe', '2026-09').fat, 99.99);
assert.equal(de('ana', 'coe', '2026-09').rep, 30.3);

// totais de setembro na maternidade: fat 3640, repasse 2167,50, imposto 17% = 618,80, margem 853,70
const t = C.totais(escala.filter((l) => l.unidade_id === 'mat' && C.mesDe(l.data) === '2026-09'), turnos, unidades);
assert.deepEqual(t, { pacientes: 91, fat: 3640, rep: 2167.5, imposto: 618.8, margem: 853.7 });

// teto total (acumula todos os meses) x teto mensal (só o mês)
assert.deepEqual(C.consumoTeto(unidades[0], escala, '2026-09'), { teto: 100, exec: 101, saldo: -1, pct: 101, mensal: false });
assert.deepEqual(C.consumoTeto(unidades[1], escala, '2026-09'), { teto: 35, exec: 3, saldo: 32, pct: 9, mensal: true });
assert.equal(C.consumoTeto(unidades[1], escala, '2026-10').saldo, -1);

// situação de pagamento
assert.equal(C.situacaoValor(0, 100).cls, 'pendente');
assert.equal(C.situacaoValor(40, 100).cls, 'parcial');
assert.equal(C.situacaoValor(100, 100).cls, 'ok');
assert.equal(C.situacaoValor(120, 100).cls, 'excedente');
assert.equal(C.situacaoValor(0, 0).cls, 'neutro');

// financeiro: aporte não é receita; aberto e DEA separados
const f = C.resumoFinanceiro([
  { tipo: 'entrada', valor: 92000, situacao: 'liquidado' },
  { tipo: 'entrada', valor: 21514.32, aporte: true, situacao: 'liquidado' },
  { tipo: 'despesa', valor: 30000.1, situacao: 'liquidado' },
  { tipo: 'despesa', valor: 14000, situacao: 'aberto' },
  { tipo: 'despesa', valor: 500.2, situacao: 'dea' },
]);
assert.deepEqual(f, { entradas: 92000, despesas: 44500.3, aportes: 21514.32, saldo: 47499.7, liquidado: 61999.9, aberto: -14000, dea: 500.2 });

// documentos
assert.equal(C.situacaoDocumento(null, '2026-11-10').cls, 'neutro');
assert.equal(C.situacaoDocumento('2026-11-09', '2026-11-10').dias, -1);
assert.equal(C.situacaoDocumento('2026-11-10', '2026-11-10').txt, 'vence hoje');
assert.equal(C.situacaoDocumento('2026-12-10', '2026-11-10').cls, 'parcial');
assert.equal(C.situacaoDocumento('2026-12-11', '2026-11-10').cls, 'ok');
assert.equal(C.situacaoDocumento('2027-03-01', '2026-11-10').dias, 111);

// calendário: novembro/2026 começa num domingo e tem 30 dias; fevereiro/2028 é bissexto
const nov = C.semanasDoMes('2026-11');
assert.equal(nov.flat().length, 30);
assert.deepEqual(nov[0], [{ iso: '2026-11-01', dia: 1, ds: 0 }]);
assert.equal(nov[1][0].ds, 1); assert.equal(nov[1].length, 7); assert.equal(nov.at(-1).at(-1).iso, '2026-11-30');
assert.equal(C.semanasDoMes('2028-02').flat().length, 29);
assert.equal(C.mesSeguinte('2026-12'), '2027-01');
assert.equal(C.mesSeguinte('2026-01', -1), '2025-12');
assert.equal(C.mesSeguinte('2026-11', -5), '2026-06');

console.log('OK — todas as regras de cálculo passaram.');
