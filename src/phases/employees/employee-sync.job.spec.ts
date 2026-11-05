import { EmployeeSyncJob } from './employee-sync.job';
import { WorkdayClient } from '../../workday/workday.client';
import { PmovelClient } from '../../pmovel/pmovel.client';
import { EmployeeMapper } from '../../mapping/employee.mapper';
import { ConsolidatedWorker } from '../../workday/consolidated-worker';
import { SyncOperation } from '../../persistence/entities/sync-item.entity';
import { RestClientError } from '../../common/http/rest-client.error';
import {
  workerCommonV1Fixture,
  workerStaffingV6Fixture,
} from '../../workday/__fixtures__/worker.fixture';

const baseWorker: ConsolidatedWorker = {
  id: 'wid-1',
  descriptor: 'Fulano de Tal',
  workerId: '1001',
  email: 'fulano@example.com',
  active: true,
};

function makeJob(overrides: {
  workday?: Partial<WorkdayClient>;
  pmovel?: Partial<PmovelClient>;
  mapper?: Partial<EmployeeMapper>;
}) {
  const workday = { ...overrides.workday } as WorkdayClient;
  const pmovel = { ...overrides.pmovel } as PmovelClient;
  const mapper = {
    toCreateDto: jest.fn().mockResolvedValue({ external_id: '1001' }),
    toUpdateDto: jest.fn().mockResolvedValue({ name: 'Fulano' }),
    ...overrides.mapper,
  } as unknown as EmployeeMapper;
  return new EmployeeSyncJob(workday, pmovel, mapper);
}

describe('WorkdayClient.consolidate', () => {
  it('junta common/v1 e staffing/v6 num ConsolidatedWorker', () => {
    const w = WorkdayClient.consolidate(
      'wid-1',
      workerCommonV1Fixture,
      workerStaffingV6Fixture,
    );
    expect(w.workerId).toBe('1001');
    expect(w.email).toBe('fulano@example.com');
    expect(w.jobTitle).toBe('Analista de Sistemas - Fulano de Tal');
    expect(w.countryAlpha2).toBe('BR');
    expect(w.isManager).toBe(false);
    expect(w.legalEntity).toBe('Operações - Brasil');
    expect(w.legalEntityId).toBe('SO01');
  });
});

describe('WorkdayClient.consolidateFromWql', () => {
  it('monta ConsolidatedWorker a partir de uma linha WQL (ativo)', () => {
    const w = WorkdayClient.consolidateFromWql({
      employeeID: '21001',
      legalNameInGeneralDisplayFormat: 'Ana Souza',
      primaryWork_Email: 'ana@example.com',
      hireDate: '2015-01-01',
      terminationDate: null,
      currentlyActive: 'true',
      company_ID: 'NLE BR',
      company: { descriptor: 'NLE Brasil', id: 'co-1' },
      dateOfBirth: '1990-01-01',
      isManager: 'true',
      jobCode: 'Analista',
      nationalIdentifiers: [{ id: '00000000000' }],
    });
    expect(w.workerId).toBe('21001');
    expect(w.descriptor).toBe('Ana Souza');
    expect(w.email).toBe('ana@example.com');
    expect(w.hireDate).toBe('2015-01-01');
    expect(w.active).toBe(true);
    expect(w.legalEntity).toBe('NLE BR');
    expect(w.isManager).toBe(true);
    expect(w.cpf).toBe('00000000000');
  });

  it('marca inativo e preserva terminationDate (demitido)', () => {
    const w = WorkdayClient.consolidateFromWql({
      employeeID: '21099',
      currentlyActive: 'false',
      terminationDate: '2018-06-18',
      company_ID: 'NLE BR',
    });
    expect(w.active).toBe(false);
    expect(w.terminationDate).toBe('2018-06-18');
  });

  it('extrai email quando vem como objeto indexado', () => {
    const w = WorkdayClient.consolidateFromWql({
      employeeID: '1',
      primaryWork_Email: { '0': 'x@y.com' },
    });
    expect(w.email).toBe('x@y.com');
  });
});

describe('EmployeeSyncJob.processItem', () => {
  it('worker novo (não existe no Pmovel) → CREATE', async () => {
    const createEmployee = jest.fn().mockResolvedValue({ id: 1 });
    const job = makeJob({
      pmovel: {
        getEmployeeByExternalId: jest.fn().mockResolvedValue(null),
        createEmployee,
      } as unknown as Partial<PmovelClient>,
    });

    const result = await job.processItem({
      externalId: '1001',
      payload: baseWorker,
    });

    expect(result.operation).toBe(SyncOperation.CREATE);
    expect(createEmployee).toHaveBeenCalled();
  });

  it('worker existente e ativo → UPDATE', async () => {
    const updateEmployeeByExternalId = jest.fn().mockResolvedValue({ id: 1 });
    const job = makeJob({
      pmovel: {
        getEmployeeByExternalId: jest
          .fn()
          .mockResolvedValue({ id: 1, active: true }),
        updateEmployeeByExternalId,
      } as unknown as Partial<PmovelClient>,
    });

    const result = await job.processItem({
      externalId: '1001',
      payload: baseWorker,
    });

    expect(result.operation).toBe(SyncOperation.UPDATE);
    expect(updateEmployeeByExternalId).toHaveBeenCalledWith(
      '1001',
      expect.anything(),
    );
  });

  it('worker terminado e existente ativo → INACTIVATE', async () => {
    const inactivate = jest.fn().mockResolvedValue(undefined);
    const job = makeJob({
      pmovel: {
        getEmployeeByExternalId: jest
          .fn()
          .mockResolvedValue({ id: 1, active: true }),
        inactivateEmployeeByExternalId: inactivate,
      } as unknown as Partial<PmovelClient>,
    });

    const terminated: ConsolidatedWorker = {
      ...baseWorker,
      active: false,
      terminationDate: '2026-01-31',
    };
    const result = await job.processItem({
      externalId: '1001',
      payload: terminated,
    });

    expect(result.operation).toBe(SyncOperation.INACTIVATE);
    expect(inactivate).toHaveBeenCalledWith('1001', {
      dt_demissao: '2026-01-31',
    });
  });

  it('worker terminado mas inexistente no Pmovel → SKIP', async () => {
    const job = makeJob({
      pmovel: {
        getEmployeeByExternalId: jest.fn().mockResolvedValue(null),
        inactivateEmployeeByExternalId: jest.fn(),
      } as unknown as Partial<PmovelClient>,
    });

    const terminated: ConsolidatedWorker = { ...baseWorker, active: false };
    const result = await job.processItem({
      externalId: '1001',
      payload: terminated,
    });

    expect(result.skipped).toBe(true);
  });

  it('upsert: CREATE falha com "já existe" → cai para UPDATE', async () => {
    const createEmployee = jest
      .fn()
      .mockRejectedValue(
        new RestClientError('conflito', 409, 'already exists'),
      );
    const updateEmployeeByExternalId = jest.fn().mockResolvedValue({ id: 1 });
    const job = makeJob({
      pmovel: {
        getEmployeeByExternalId: jest.fn().mockResolvedValue(null),
        createEmployee,
        updateEmployeeByExternalId,
      } as unknown as Partial<PmovelClient>,
    });

    const result = await job.processItem({
      externalId: '1001',
      payload: baseWorker,
    });

    expect(result.operation).toBe(SyncOperation.UPDATE);
    expect(createEmployee).toHaveBeenCalled();
    expect(updateEmployeeByExternalId).toHaveBeenCalled();
  });

  it('upsert: CREATE falha com erro não-duplicidade → propaga (vira falha de item)', async () => {
    const createEmployee = jest
      .fn()
      .mockRejectedValue(
        new RestClientError('erro', 400, 'invalid field email'),
      );
    const job = makeJob({
      pmovel: {
        getEmployeeByExternalId: jest.fn().mockResolvedValue(null),
        createEmployee,
        updateEmployeeByExternalId: jest.fn(),
      } as unknown as Partial<PmovelClient>,
    });

    await expect(
      job.processItem({ externalId: '1001', payload: baseWorker }),
    ).rejects.toBeInstanceOf(RestClientError);
  });
});

describe('EmployeeSyncJob.isAlreadyExists', () => {
  it('reconhece 409', () => {
    expect(
      EmployeeSyncJob.isAlreadyExists(new RestClientError('', 409, '')),
    ).toBe(true);
  });
  it('reconhece 400 com mensagem de duplicidade', () => {
    expect(
      EmployeeSyncJob.isAlreadyExists(
        new RestClientError('', 400, 'already exists'),
      ),
    ).toBe(true);
  });
  it('não reconhece 400 genérico', () => {
    expect(
      EmployeeSyncJob.isAlreadyExists(
        new RestClientError('', 400, 'invalid email'),
      ),
    ).toBe(false);
  });
});
