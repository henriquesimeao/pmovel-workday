import { DataSource } from 'typeorm';
import {
  CnpjMapping,
  PayrollInputSent,
  SyncCursor,
  SyncItem,
  SyncRun,
} from '../../persistence/entities';
import { CnpjMappingRepository } from '../../persistence/cnpj-mapping.repository';
import { PayrollInputSentRepository } from '../../persistence/payroll-input-sent.repository';
import { SyncOperation } from '../../persistence/entities/sync-item.entity';
import { PmovelClient } from '../../pmovel/pmovel.client';
import {
  PayrollExport,
  PayrollExportTotalsEmployee,
} from '../../pmovel/pmovel.types';
import { JobRunContext, SyncItemInput } from '../../sync/phase-sync-job';
import { PayrollExportJob, PayrollExportItem } from './payroll-export.job';
import {
  PayrollInputLine,
  PayrollInputWriter,
} from './writers/payroll-input-writer';

const CNPJ = '00111111000200';

const request = (over: Partial<PayrollExport> = {}): PayrollExport => ({
  id: 123,
  cnpj: CNPJ,
  cycle: {
    id: 456,
    start_date: '2026-05-15',
    end_date: '2026-06-14',
    closed: true,
  },
  scope: 'global',
  external_id: null,
  target: 'workday',
  status: 'processing',
  ...over,
});

const employee = (
  id: number,
  externalId: string,
  events: Array<[string, 'P' | 'D', number]>,
): PayrollExportTotalsEmployee => ({
  employee_id: id,
  external_id: externalId,
  matricula: externalId,
  name: 'NOME',
  active: true,
  dt_demissao: null,
  events: events.map(([code, type, seconds]) => ({
    code,
    name: `Evento ${code}`,
    type,
    total_seconds: seconds,
    hours_decimal: seconds / 3600,
    hours: '',
  })),
});

describe('PayrollExportJob', () => {
  let ds: DataSource;
  let sent: PayrollInputSentRepository;
  let cnpj: CnpjMappingRepository;
  let lines: PayrollInputLine[];
  let writer: PayrollInputWriter & { upsert: jest.Mock };
  let totals: PayrollExportTotalsEmployee[];
  let pmovel: { getPayrollExportTotals: jest.Mock };

  beforeEach(async () => {
    ds = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      synchronize: true,
      entities: [SyncRun, SyncItem, CnpjMapping, SyncCursor, PayrollInputSent],
    });
    await ds.initialize();
    sent = new PayrollInputSentRepository(ds.getRepository(PayrollInputSent));
    cnpj = new CnpjMappingRepository(ds.getRepository(CnpjMapping));
    await cnpj.upsert({
      legalEntityId: 'NLE CAN',
      legalEntityName: 'NLE Canada',
      cnpj: CNPJ,
      currency: 'CAD',
    });
    lines = [];
    writer = {
      destination: 'external_payroll_input',
      upsert: jest.fn(async (line: PayrollInputLine) => {
        lines.push(line);
        return { wid: `wid-${line.inputId}` };
      }),
    };
    totals = [];
    pmovel = {
      getPayrollExportTotals: jest.fn(async (_id: number, page: number) => ({
        employees: page === 1 ? totals : [],
        total_employees: totals.length,
      })),
    };
  });

  afterEach(() => ds.destroy());

  const makeJob = () =>
    new PayrollExportJob(pmovel as unknown as PmovelClient, cnpj, sent, writer);

  /** Executa fetch + process de todos os itens, como o orquestrador. */
  async function run(job: PayrollExportJob, req: PayrollExport, runId = 1) {
    const context: JobRunContext = { runId, params: { request: req } };
    const items = await job.fetchItems(null, context);
    const results = [];
    for (const item of items)
      results.push(await job.processItem(item, context));
    return { items, results, report: job.takeReport(req.id) };
  }

  it('envia um lançamento por colaborador e verba, com id estável e horas de 2 casas', async () => {
    totals = [
      employee(282539, '21411', [
        ['0020', 'P', 12600],
        ['0300', 'D', 28800],
      ]),
      employee(282540, '21412', [['0020', 'P', 60]]),
    ];
    const { items, results, report } = await run(makeJob(), request());

    expect(items.map((i) => i.externalId)).toEqual([
      '21411/0020',
      '21411/0300',
      '21412/0020',
    ]);
    expect(lines[0]).toEqual({
      inputId: 'PMV-456-282539-0020',
      batchId: 'PMV-123',
      externalId: '21411',
      code: '0020',
      type: 'P',
      hours: '3.50',
      startDate: '2026-05-15',
      endDate: '2026-06-14',
      currency: 'CAD',
      comment: 'Pmovel: ciclo 2026-05-15 a 2026-06-14, solicitação 123',
    });
    expect(lines[1].type).toBe('D');
    expect(lines[2].hours).toBe('0.02');
    expect(results.every((r) => r.operation === SyncOperation.CREATE)).toBe(
      true,
    );
    expect(report).toEqual({ employees: 2, sent: 3, zeroed: 0, warnings: [] });

    const row = await sent.findOne(456, 282539, '0020');
    expect(row).toMatchObject({
      scope: 'global',
      externalId: '21411',
      totalSeconds: 12600,
      workdayInputId: 'PMV-456-282539-0020',
      workdayWid: 'wid-PMV-456-282539-0020',
      destination: 'external_payroll_input',
      exportId: 123,
      runId: 1,
    });
  });

  it('reenvio do global: mesmo id (atualiza), zera a verba que sumiu e avisa quem saiu', async () => {
    totals = [
      employee(282539, '21411', [
        ['0020', 'P', 3600],
        ['0300', 'D', 3600],
      ]),
      employee(282541, '21500', [['0020', 'P', 3600]]),
    ];
    await run(makeJob(), request(), 1);
    lines = [];

    // Segundo envio: 21411 sem a verba 0300 e com 0020 alterada; 21500 sumiu.
    totals = [employee(282539, '21411', [['0020', 'P', 7200]])];
    const { results, report } = await run(makeJob(), request({ id: 124 }), 2);

    expect(lines.map((l) => [l.inputId, l.hours])).toEqual([
      ['PMV-456-282539-0020', '2.00'],
      ['PMV-456-282539-0300', '0.00'],
      ['PMV-456-282541-0020', '0.00'],
    ]);
    expect(results[0].operation).toBe(SyncOperation.UPDATE);
    expect(results[1].summary).toContain('zerado');
    expect(report.sent).toBe(1);
    expect(report.zeroed).toBe(2);
    expect(report.warnings).toEqual([
      expect.stringContaining(
        'colaborador 21500 estava no envio global anterior',
      ),
    ]);
    expect((await sent.findOne(456, 282541, '0020'))!.totalSeconds).toBe(0);
  });

  it('o que já foi zerado não é zerado de novo', async () => {
    totals = [employee(282539, '21411', [['0300', 'D', 3600]])];
    await run(makeJob(), request(), 1);
    totals = [];
    await run(makeJob(), request({ id: 124 }), 2);
    lines = [];
    const { items } = await run(makeJob(), request({ id: 125 }), 3);
    expect(items).toHaveLength(0);
    expect(lines).toHaveLength(0);
  });

  it('individual: envia só o colaborador e zera só as verbas dele que sumiram', async () => {
    totals = [
      employee(282539, '21411', [
        ['0020', 'P', 3600],
        ['0300', 'D', 3600],
      ]),
      employee(282541, '21500', [['0020', 'P', 3600]]),
    ];
    await run(makeJob(), request(), 1);
    lines = [];

    totals = [employee(282539, '21411', [['0020', 'P', 1800]])];
    const { report } = await run(
      makeJob(),
      request({ id: 200, scope: 'individual', external_id: '21411' }),
      2,
    );

    expect(lines.map((l) => [l.inputId, l.hours])).toEqual([
      ['PMV-456-282539-0020', '0.50'],
      ['PMV-456-282539-0300', '0.00'],
    ]);
    expect(report.warnings).toEqual([]);
    expect((await sent.findOne(456, 282539, '0020'))!.scope).toBe('individual');
    // 21500 (outro colaborador) não foi tocado
    expect((await sent.findOne(456, 282541, '0020'))!.totalSeconds).toBe(3600);
  });

  it('global depois do individual não zera os lançamentos do demitido', async () => {
    totals = [employee(282539, '21411', [['0020', 'P', 3600]])];
    await run(
      makeJob(),
      request({ id: 200, scope: 'individual', external_id: '21411' }),
      1,
    );
    lines = [];

    totals = [employee(282541, '21500', [['0020', 'P', 3600]])];
    await run(makeJob(), request({ id: 201 }), 2);

    expect(lines.map((l) => l.inputId)).toEqual(['PMV-456-282541-0020']);
  });

  it('lê todas as páginas de totais', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) =>
      employee(1000 + i, `E${i}`, [['0020', 'P', 3600]]),
    );
    const page2 = [employee(2000, 'E100', [['0020', 'P', 3600]])];
    pmovel.getPayrollExportTotals.mockImplementation(
      async (_id: number, page: number) => ({
        employees: page === 1 ? page1 : page === 2 ? page2 : [],
        total_employees: 101,
      }),
    );
    const items = await makeJob().fetchItems(null, {
      runId: 1,
      params: { request: request() },
    });
    expect(items).toHaveLength(101);
    expect(pmovel.getPayrollExportTotals).toHaveBeenCalledTimes(2);
  });

  it('Payroll Interface sem moeda configurada: a run falha antes de enviar', async () => {
    await cnpj.upsert({
      legalEntityId: 'NLE CAN',
      legalEntityName: 'NLE Canada',
      cnpj: CNPJ,
      currency: null,
    });
    totals = [employee(282539, '21411', [['0020', 'P', 3600]])];
    await expect(
      makeJob().fetchItems(null, { runId: 1, params: { request: request() } }),
    ).rejects.toThrow(/moeda não configurada para a empresa 00111111000200/);
    expect(writer.upsert).not.toHaveBeenCalled();
  });

  it('Workday Payroll aceita empresa sem moeda (não envia moeda)', async () => {
    await cnpj.upsert({
      legalEntityId: 'NLE CAN',
      legalEntityName: 'NLE Canada',
      cnpj: CNPJ,
      currency: null,
    });
    (writer as { destination: string }).destination = 'payroll_input';
    totals = [employee(282539, '21411', [['0020', 'P', 3600]])];
    await run(makeJob(), request());
    expect(lines[0].currency).toBeNull();
  });

  it('erro do Workday no lançamento propaga (vira falha do item) e nada é registrado', async () => {
    writer.upsert.mockRejectedValueOnce(
      new Error(
        "Workday Put_External_Payroll_Input: Invalid ID value. 'X' ... Earning_Code",
      ),
    );
    totals = [employee(282539, '21411', [['X', 'P', 3600]])];
    const job = makeJob();
    const context: JobRunContext = { runId: 1, params: { request: request() } };
    const [item] = await job.fetchItems(null, context);
    await expect(
      job.processItem(item as SyncItemInput<PayrollExportItem>, context),
    ).rejects.toThrow(/Earning_Code/);
    expect(await sent.findOne(456, 282539, 'X')).toBeNull();
  });

  it('sem solicitação nos parâmetros, recusa', async () => {
    await expect(makeJob().fetchItems(null, { runId: 1 })).rejects.toThrow(
      /precisa de uma solicitação/,
    );
  });
});
