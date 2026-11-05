import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import request from 'supertest';
import {
  SyncRun,
  SyncItem,
  CnpjMapping,
  SyncCursor,
} from '../src/persistence/entities';
import { SyncOperation } from '../src/persistence/entities/sync-item.entity';
import { SyncRunRepository } from '../src/persistence/sync-run.repository';
import { SyncCursorRepository } from '../src/persistence/sync-cursor.repository';
import { SyncOrchestrator } from '../src/sync/sync.orchestrator';
import { JobRegistry } from '../src/sync/job-registry';
import { SyncController } from '../src/sync/sync.controller';
import { PhaseSyncJob } from '../src/sync/phase-sync-job';

/**
 * E2E do disparo sob demanda e consulta de runs. Usa SQLite em memória e um job
 * fake registrado — não depende de MySQL nem do scheduler real.
 */
describe('Sync (e2e)', () => {
  let app: INestApplication;
  let registry: JobRegistry;

  const fakeJob: PhaseSyncJob<{ fail?: boolean }> = {
    key: 'employees:full',
    phase: 'employees',
    type: 'full',
    fetchItems: async () => [
      { externalId: '1001', payload: {} },
      { externalId: '1002', payload: { fail: true } },
    ],
    processItem: async (item) => {
      if (item.payload.fail) throw new Error('falha no item 1002');
      return { operation: SyncOperation.CREATE, summary: 'criado' };
    },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
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
      controllers: [SyncController],
      providers: [SyncOrchestrator, SyncRunRepository, SyncCursorRepository, JobRegistry],
    }).compile();

    app = moduleRef.createNestApplication();
    registry = moduleRef.get(JobRegistry);
    registry.register(fakeJob);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /sync/jobs lista os jobs registrados', async () => {
    const res = await request(app.getHttpServer()).get('/sync/jobs').expect(200);
    expect(res.body).toEqual([{ phase: 'employees', type: 'full', key: 'employees:full' }]);
  });

  it('POST /sync/:phase/:type dispara e GET /sync/runs/:id mostra o resultado', async () => {
    const trigger = await request(app.getHttpServer())
      .post('/sync/employees/full')
      .expect(201);
    const runId = trigger.body.runId;
    expect(runId).toBeDefined();

    const runRes = await request(app.getHttpServer()).get(`/sync/runs/${runId}`).expect(200);
    expect(runRes.body.status).toBe('completed');
    expect(runRes.body.totalCount).toBe(2);
    expect(runRes.body.successCount).toBe(1);
    expect(runRes.body.failureCount).toBe(1);
    expect(runRes.body.items).toHaveLength(2);
  });

  it('POST em job inexistente retorna 404', async () => {
    await request(app.getHttpServer()).post('/sync/nope/nope').expect(404);
  });

  it('GET /sync/runs/:id inexistente retorna 404', async () => {
    await request(app.getHttpServer()).get('/sync/runs/99999').expect(404);
  });
});
