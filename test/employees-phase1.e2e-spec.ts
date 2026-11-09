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
import { SyncRunRepository } from '../src/persistence/sync-run.repository';
import { SyncCursorRepository } from '../src/persistence/sync-cursor.repository';
import { CnpjMappingRepository } from '../src/persistence/cnpj-mapping.repository';
import { SyncOrchestrator } from '../src/sync/sync.orchestrator';
import { JobRegistry } from '../src/sync/job-registry';
import { SyncController } from '../src/sync/sync.controller';
import { EmployeeSyncJob } from '../src/phases/employees/employee-sync.job';
import { WorkdayClient } from '../src/workday/workday.client';
import { PmovelClient } from '../src/pmovel/pmovel.client';
import { EmployeeMapper } from '../src/mapping/employee.mapper';
import { FieldMappingService } from '../src/mapping/field-mapping.service';
import { CnpjMappingService } from '../src/mapping/cnpj-mapping.service';
import { DEFAULT_EMPLOYEE_MAPPING } from '../src/mapping/mapping.config';
import { ConsolidatedWorker } from '../src/workday/consolidated-worker';

/**
 * E2E da Fase 1 ponta a ponta: Workday (mock) → EmployeeSyncJob → Pmovel (mock
 * em memória). Exercita admissão (create), atualização (update) e demissão
 * (inactivate), com idempotência por external_id, e verifica sync_run/sync_item.
 *
 * O "Pmovel" é um fake em memória que guarda employees por external_id.
 */

/** Fake do PmovelClient: armazena employees em memória. */
class FakePmovel {
  store = new Map<string, any>();
  createEmployee = jest.fn(async (dto: any) => {
    this.store.set(dto.external_id, { ...dto, active: true });
    return { id: this.store.size, ...dto };
  });
  updateEmployeeByExternalId = jest.fn(async (id: string, dto: any) => {
    const cur = this.store.get(id) ?? {};
    this.store.set(id, { ...cur, ...dto });
    return this.store.get(id);
  });
  inactivateEmployeeByExternalId = jest.fn(async (id: string, dto: any) => {
    const cur = this.store.get(id);
    if (cur) this.store.set(id, { ...cur, active: false, dt_demissao: dto.dt_demissao });
  });
  getEmployeeByExternalId = jest.fn(async (id: string) => this.store.get(id) ?? null);
}

/** Fake do WorkdayClient: emite workers consolidados via WQL. */
class FakeWorkday {
  workers: ConsolidatedWorker[] = [];
  async *listConsolidatedWorkersViaWql() {
    for (const w of this.workers) yield w;
  }
}

describe('Fase 1 — EmployeeSyncJob (e2e)', () => {
  let app: INestApplication;
  let fakeWorkday: FakeWorkday;
  let fakePmovel: FakePmovel;
  let cnpjRepo: CnpjMappingRepository;

  beforeAll(async () => {
    fakeWorkday = new FakeWorkday();
    fakePmovel = new FakePmovel();

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
      providers: [
        SyncOrchestrator,
        SyncRunRepository,
        SyncCursorRepository,
        CnpjMappingRepository,
        JobRegistry,
        FieldMappingService,
        CnpjMappingService,
        {
          provide: EmployeeMapper,
          inject: [FieldMappingService, CnpjMappingService],
          useFactory: (f: FieldMappingService, c: CnpjMappingService) =>
            // config de teste: cpf vem do worker, defaults para os gaps
            new EmployeeMapper(f, c, {
              ...DEFAULT_EMPLOYEE_MAPPING,
              fields: {
                ...DEFAULT_EMPLOYEE_MAPPING.fields,
                cpf: { mode: 'direct', source: 'cpf' },
                employeegroup_code: { mode: 'default', value: 'GRP' },
                syndicate_code: { mode: 'default', value: 'SIND' },
                workday_code: { mode: 'default', value: 'JOR' },
              },
            }),
        },
        { provide: WorkdayClient, useValue: fakeWorkday },
        { provide: PmovelClient, useValue: fakePmovel },
        EmployeeSyncJob,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    const registry = moduleRef.get(JobRegistry);
    registry.register(moduleRef.get(EmployeeSyncJob));
    cnpjRepo = moduleRef.get(CnpjMappingRepository);
    await app.init();

    // de/para CNPJ para a legal entity dos workers de teste
    await cnpjRepo.upsert({
      legalEntityId: 'SO01',
      legalEntityName: 'ACME Brasil LTDA',
      cnpj: '00000000000191',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  function worker(partial: Partial<ConsolidatedWorker>): ConsolidatedWorker {
    return {
      id: partial.id!,
      descriptor: partial.descriptor ?? 'Worker',
      workerId: partial.workerId ?? partial.id!,
      email: 'w@example.com',
      cpf: '00000000000',
      countryAlpha2: 'BR',
      isManager: false,
      hireDate: '2021-03-01',
      legalEntityId: 'SO01',
      legalEntity: 'ACME Brasil LTDA',
      active: true,
      ...partial,
    };
  }

  async function runSync(): Promise<number> {
    const res = await request(app.getHttpServer()).post('/sync/employees/full').expect(201);
    return res.body.runId;
  }

  it('1ª sync: dois workers novos → ambos ADMITIDOS (create)', async () => {
    fakeWorkday.workers = [
      worker({ id: 'w1', workerId: '1001', descriptor: 'Ana' }),
      worker({ id: 'w2', workerId: '1002', descriptor: 'Bruno' }),
    ];

    const runId = await runSync();
    const run = await request(app.getHttpServer()).get(`/sync/runs/${runId}`).expect(200);

    expect(run.body.status).toBe('completed');
    expect(run.body.successCount).toBe(2);
    expect(run.body.failureCount).toBe(0);
    expect(fakePmovel.createEmployee).toHaveBeenCalledTimes(2);
    expect(fakePmovel.store.get('1001').cnpj).toBe('00000000000191');
    const criado = fakePmovel.store.get('1001');
    expect(criado.employeegroup_name).toBeTruthy();
    expect(criado.syndicate_name).toBeTruthy();
    expect(criado.workday_name).toBeTruthy();
  });

  it('2ª sync: mesmos workers com dado alterado → ATUALIZADOS (update, idempotente)', async () => {
    fakeWorkday.workers = [
      worker({ id: 'w1', workerId: '1001', descriptor: 'Ana Silva' }),
      worker({ id: 'w2', workerId: '1002', descriptor: 'Bruno' }),
    ];

    const createCallsBefore = fakePmovel.createEmployee.mock.calls.length;
    const runId = await runSync();
    const run = await request(app.getHttpServer()).get(`/sync/runs/${runId}`).expect(200);

    expect(run.body.successCount).toBe(2);
    // não criou de novo (idempotência)
    expect(fakePmovel.createEmployee.mock.calls.length).toBe(createCallsBefore);
    expect(fakePmovel.updateEmployeeByExternalId).toHaveBeenCalled();
    expect(fakePmovel.store.get('1001').name).toBe('Ana Silva');

    // update NÃO deve carregar os campos imutáveis (grupo/sindicato/jornada)
    const lastUpdate = fakePmovel.updateEmployeeByExternalId.mock.calls.at(-1)![1];
    expect(lastUpdate).not.toHaveProperty('employeegroup_code');
    expect(lastUpdate).not.toHaveProperty('syndicate_code');
    expect(lastUpdate).not.toHaveProperty('workday_code');
    expect(lastUpdate).not.toHaveProperty('employeegroup_name');
    expect(lastUpdate).not.toHaveProperty('syndicate_name');
    expect(lastUpdate).not.toHaveProperty('workday_name');
  });

  it('3ª sync: um worker terminado → DEMITIDO (inactivate)', async () => {
    fakeWorkday.workers = [
      worker({ id: 'w1', workerId: '1001', descriptor: 'Ana Silva' }),
      worker({
        id: 'w2',
        workerId: '1002',
        descriptor: 'Bruno',
        active: false,
        terminationDate: '2026-02-28',
      }),
    ];

    const runId = await runSync();
    const run = await request(app.getHttpServer()).get(`/sync/runs/${runId}`).expect(200);

    expect(run.body.successCount).toBe(2); // 1 update + 1 inactivate
    expect(fakePmovel.inactivateEmployeeByExternalId).toHaveBeenCalledWith('1002', {
      dt_demissao: '2026-02-28',
    });
    expect(fakePmovel.store.get('1002').active).toBe(false);
  });

  it('registra falha de item sem abortar o lote (worker sem CNPJ no de/para)', async () => {
    fakeWorkday.workers = [
      worker({ id: 'w1', workerId: '1001', descriptor: 'Ana Silva' }),
      worker({ id: 'w3', workerId: '1003', descriptor: 'Sem CNPJ', legalEntityId: 'SO_X', legalEntity: 'Desconhecida' }),
    ];

    const runId = await runSync();
    const run = await request(app.getHttpServer()).get(`/sync/runs/${runId}`).expect(200);

    expect(run.body.failureCount).toBe(1);
    const failed = run.body.items.find((i: any) => i.status === 'failure');
    expect(failed.externalId).toBe('1003');
    expect(failed.errorMessage).toMatch(/cnpj/i);
    // o outro item seguiu normalmente
    expect(run.body.successCount).toBe(1);
  });
});
