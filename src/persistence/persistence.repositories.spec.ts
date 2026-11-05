import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SyncRun, SyncItem, CnpjMapping, SyncCursor } from './entities';
import { SyncItemStatus, SyncOperation } from './entities/sync-item.entity';
import { SyncRunStatus } from './entities/sync-run.entity';
import { SyncRunRepository } from './sync-run.repository';
import { SyncCursorRepository } from './sync-cursor.repository';
import { CnpjMappingRepository } from './cnpj-mapping.repository';

/**
 * Testes de integração dos repositórios usando SQLite em memória.
 *
 * O mapeamento objeto-relacional (entidades, relações, contadores) é o mesmo
 * em SQLite e MySQL para o que exercitamos aqui; o schema de produção é
 * garantido pela migration (dialeto MySQL). `synchronize: true` só nos testes.
 */
describe('Persistence repositories (SQLite in-memory)', () => {
  let moduleRef: TestingModule;
  let runs: SyncRunRepository;
  let cursors: SyncCursorRepository;
  let cnpj: CnpjMappingRepository;

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
      providers: [SyncRunRepository, SyncCursorRepository, CnpjMappingRepository],
    }).compile();

    runs = moduleRef.get(SyncRunRepository);
    cursors = moduleRef.get(SyncCursorRepository);
    cnpj = moduleRef.get(CnpjMappingRepository);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('cria uma run, registra itens de sucesso/falha/skip e fecha com contadores', async () => {
    const run = await runs.startRun('employees', 'full', 'manual');
    expect(run.status).toBe(SyncRunStatus.RUNNING);

    await runs.recordItem(run.id, {
      externalId: '1001',
      operation: SyncOperation.CREATE,
      status: SyncItemStatus.SUCCESS,
    });
    await runs.recordItem(run.id, {
      externalId: '1002',
      operation: SyncOperation.UPDATE,
      status: SyncItemStatus.FAILURE,
      errorMessage: 'falha simulada',
    });
    await runs.recordItem(run.id, {
      externalId: '1003',
      operation: SyncOperation.NONE,
      status: SyncItemStatus.SKIPPED,
    });

    await runs.completeRun(run.id);

    const loaded = await runs.findById(run.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.status).toBe(SyncRunStatus.COMPLETED);
    expect(loaded!.finishedAt).toBeTruthy();
    expect(loaded!.totalCount).toBe(3);
    expect(loaded!.successCount).toBe(1);
    expect(loaded!.failureCount).toBe(1);
    expect(loaded!.skippedCount).toBe(1);
    expect(loaded!.items).toHaveLength(3);

    const failed = loaded!.items.find((i) => i.status === SyncItemStatus.FAILURE);
    expect(failed!.errorMessage).toBe('falha simulada');
  });

  it('failRun marca a run como FAILED com mensagem', async () => {
    const run = await runs.startRun('employees', 'full', 'scheduled');
    await runs.failRun(run.id, 'origem indisponível');

    const loaded = await runs.findById(run.id);
    expect(loaded!.status).toBe(SyncRunStatus.FAILED);
    expect(loaded!.errorMessage).toBe('origem indisponível');
  });

  it('hasRunning detecta lock de execução concorrente', async () => {
    expect(await runs.hasRunning('employees', 'full')).toBe(false);
    const run = await runs.startRun('employees', 'full', 'manual');
    expect(await runs.hasRunning('employees', 'full')).toBe(true);
    await runs.completeRun(run.id);
    expect(await runs.hasRunning('employees', 'full')).toBe(false);
  });

  it('cursor: salva e lê a última execução por job', async () => {
    expect(await cursors.getLastRunAt('employees:full')).toBeNull();

    const when = new Date('2026-01-15T10:00:00Z');
    await cursors.save('employees:full', when, 'offset-42');

    const lastRunAt = await cursors.getLastRunAt('employees:full');
    expect(lastRunAt?.toISOString()).toBe(when.toISOString());

    const cursor = await cursors.find('employees:full');
    expect(cursor?.lastValue).toBe('offset-42');
  });

  it('cnpj_mapping: upsert e resolução por id e por nome', async () => {
    await cnpj.upsert({
      legalEntityId: 'SO01',
      legalEntityName: 'ACME Brasil LTDA',
      cnpj: '00000000000191',
    });

    expect(await cnpj.resolveCnpj('SO01', null)).toBe('00000000000191');
    expect(await cnpj.resolveCnpj(null, 'ACME Brasil LTDA')).toBe('00000000000191');
    expect(await cnpj.resolveCnpj('INEXISTENTE', null)).toBeNull();
  });

  it('cnpj_mapping: não resolve de/para inativo', async () => {
    await cnpj.upsert({
      legalEntityId: 'SO02',
      legalEntityName: 'Inativa SA',
      cnpj: '99999999999999',
      active: false,
    });
    expect(await cnpj.resolveCnpj('SO02', null)).toBeNull();
  });
});
