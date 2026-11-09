import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  SyncRun,
  SyncItem,
  CnpjMapping,
  SyncCursor,
} from '../persistence/entities';
import { SyncRunStatus } from '../persistence/entities/sync-run.entity';
import { SyncOperation } from '../persistence/entities/sync-item.entity';
import { SyncRunRepository } from '../persistence/sync-run.repository';
import { SyncCursorRepository } from '../persistence/sync-cursor.repository';
import { SyncOrchestrator, SyncAlreadyRunningError } from './sync.orchestrator';
import { PhaseSyncJob, SyncItemInput, ItemResult } from './phase-sync-job';
import { ManualReviewError } from './manual-review.error';
import { Logger } from '@nestjs/common';

/** Job fake configurável para exercitar o orquestrador. */
class FakeJob implements PhaseSyncJob<{ fail?: boolean; skip?: boolean }> {
  key = 'fake:job';
  phase = 'fake';
  type = 'job';
  fetchError?: Error;
  lastSince: Date | null = null;

  constructor(
    private readonly items: SyncItemInput<{ fail?: boolean; skip?: boolean }>[],
  ) {}

  async fetchItems(since: Date | null) {
    this.lastSince = since;
    if (this.fetchError) throw this.fetchError;
    return this.items;
  }

  async processItem(
    item: SyncItemInput<{ fail?: boolean; skip?: boolean }>,
  ): Promise<ItemResult> {
    if (item.payload.fail) throw new Error('falha simulada no item');
    if (item.payload.skip)
      return { skipped: true, operation: SyncOperation.NONE };
    return { operation: SyncOperation.CREATE, summary: 'ok' };
  }
}

describe('SyncOrchestrator', () => {
  let moduleRef: TestingModule;
  let orchestrator: SyncOrchestrator;
  let runs: SyncRunRepository;
  let cursors: SyncCursorRepository;

  beforeEach(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database: ':memory:',
          dropSchema: true,
          synchronize: true,
          entities: [SyncRun, SyncItem, CnpjMapping, SyncCursor],
        }),
        TypeOrmModule.forFeature([SyncRun, SyncItem, CnpjMapping, SyncCursor]),
      ],
      providers: [SyncOrchestrator, SyncRunRepository, SyncCursorRepository],
    }).compile();

    orchestrator = moduleRef.get(SyncOrchestrator);
    runs = moduleRef.get(SyncRunRepository);
    cursors = moduleRef.get(SyncCursorRepository);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('continua o lote após falha parcial e contabiliza corretamente', async () => {
    const job = new FakeJob([
      { externalId: '1', payload: {} },
      { externalId: '2', payload: { fail: true } },
      { externalId: '3', payload: {} },
      { externalId: '4', payload: { fail: true } },
      { externalId: '5', payload: { skip: true } },
    ]);

    const runId = await orchestrator.run(job, 'manual');
    const run = await runs.findById(runId);

    expect(run!.status).toBe(SyncRunStatus.COMPLETED);
    expect(run!.totalCount).toBe(5);
    expect(run!.successCount).toBe(2);
    expect(run!.failureCount).toBe(2);
    expect(run!.skippedCount).toBe(1);

    const failedItems = run!.items.filter((i) => i.status === 'failure');
    expect(failedItems).toHaveLength(2);
    expect(failedItems[0].errorMessage).toContain('falha simulada');
  });

  it('itens para tratamento manual: ficam como falha, com marcação, e são resumidos no log', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const job = new FakeJob([
      { externalId: '1', payload: {} },
      { externalId: '21609', payload: { fail: true } },
    ]);
    job.processItem = async (item) => {
      if (item.payload.fail) {
        throw new ManualReviewError(
          '21609',
          'e-mail ou CPF já existe no Pmovel',
          { external_id: '21609', 'e-mail': 'a@b.com', CPF: 'AB123456C' },
          'localizar o cadastro',
        );
      }
      return { operation: SyncOperation.CREATE };
    };

    const runId = await orchestrator.run(job, 'manual');
    const run = await runs.findById(runId);

    expect(run!.status).toBe(SyncRunStatus.COMPLETED);
    expect(run!.successCount).toBe(1);
    expect(run!.failureCount).toBe(1);
    const failed = run!.items.find((i) => i.status === 'failure')!;
    expect(failed.errorMessage).toContain('TRATAMENTO MANUAL');
    expect(failed.errorMessage).toContain('e-mail=a@b.com');
    expect(failed.errorMessage).toContain('CPF=AB123456C');

    const logs = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logs).toContain('1 item(ns) para TRATAMENTO MANUAL');
    expect(logs).toContain('e-mail=a@b.com | CPF=AB123456C');
    warn.mockRestore();
  });

  it('sem itens para tratamento manual, não imprime o resumo', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    await orchestrator.run(new FakeJob([{ externalId: '1', payload: { fail: true } }]), 'manual');
    const logs = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logs).not.toContain('para TRATAMENTO MANUAL');
    warn.mockRestore();
  });

  it('atualiza o cursor ao concluir a run', async () => {
    const job = new FakeJob([{ externalId: '1', payload: {} }]);
    expect(await cursors.getLastRunAt('fake:job')).toBeNull();

    await orchestrator.run(job, 'manual');

    expect(await cursors.getLastRunAt('fake:job')).not.toBeNull();
  });

  it('passa o cursor (since) para o fetchItems na execução seguinte', async () => {
    const job = new FakeJob([{ externalId: '1', payload: {} }]);
    await orchestrator.run(job, 'manual');
    const job2 = new FakeJob([{ externalId: '2', payload: {} }]);
    job2.key = 'fake:job';
    await orchestrator.run(job2, 'manual');

    expect(job2.lastSince).not.toBeNull();
  });

  it('marca a run como FAILED e NÃO avança o cursor se a origem falha', async () => {
    const job = new FakeJob([]);
    job.fetchError = new Error('origem fora do ar');

    const runId = await orchestrator.run(job, 'scheduled');
    const run = await runs.findById(runId);

    expect(run!.status).toBe(SyncRunStatus.FAILED);
    expect(run!.errorMessage).toContain('origem fora do ar');
    expect(await cursors.getLastRunAt('fake:job')).toBeNull();
  });

  it('impede execução concorrente do mesmo job (lock)', async () => {
    // cria manualmente uma run RUNNING para simular concorrência
    await runs.startRun('fake', 'job', 'manual');
    const job = new FakeJob([{ externalId: '1', payload: {} }]);

    await expect(orchestrator.run(job, 'manual')).rejects.toBeInstanceOf(
      SyncAlreadyRunningError,
    );
  });
});
