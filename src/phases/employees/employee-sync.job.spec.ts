import { EmployeeSyncJob } from './employee-sync.job';
import { WorkdayClient } from '../../workday/workday.client';
import { PmovelClient } from '../../pmovel/pmovel.client';
import { EmployeeMapper } from '../../mapping/employee.mapper';
import { ConsolidatedWorker } from '../../workday/consolidated-worker';
import { SyncOperation } from '../../persistence/entities/sync-item.entity';
import { RestClientError } from '../../common/http/rest-client.error';
import { ManualReviewError } from '../../sync/manual-review.error';
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
      nationalIdentifiers: [
        { id: 'a'.repeat(32), descriptor: '000.000.000-00 (BRA-CPF)' },
      ],
    });
    expect(w.workerId).toBe('21001');
    expect(w.descriptor).toBe('Ana Souza');
    expect(w.email).toBe('ana@example.com');
    expect(w.hireDate).toBe('2015-01-01');
    expect(w.active).toBe(true);
    expect(w.legalEntity).toBe('NLE BR');
    expect(w.legalEntityName).toBe('NLE Brasil');
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

describe('WorkdayClient.extractNationalId', () => {
  const wid = 'f'.repeat(32);

  it('lê o número do descriptor e devolve só os dígitos (BRA-CPF)', () => {
    expect(
      WorkdayClient.extractNationalId([
        { id: wid, descriptor: '123.456.789-09 (BRA-CPF)' },
      ]),
    ).toBe('12345678909');
  });

  it('nunca devolve o id interno do Workday', () => {
    const cpf = WorkdayClient.extractNationalId([
      { id: wid, descriptor: '123.456.789-09 (BRA-CPF)' },
    ]);
    expect(cpf).not.toBe(wid);
  });

  it('sem CPF, usa o documento principal estrangeiro, como o Workday formata', () => {
    expect(
      WorkdayClient.extractNationalId([
        { id: wid, descriptor: '123-45-6789 (USA-SSN)' },
      ]),
    ).toBe('123-45-6789');
    expect(
      WorkdayClient.extractNationalId([
        { id: wid, descriptor: '123 456 789 (CAN-SIN)' },
      ]),
    ).toBe('123 456 789');
  });

  it('preserva letras do documento estrangeiro (NINO britânico)', () => {
    expect(
      WorkdayClient.extractNationalId([
        { id: wid, descriptor: 'AB 12 34 56 C (GBR-NINO)' },
      ]),
    ).toBe('AB 12 34 56 C');
  });

  it('prefere o CPF brasileiro ao documento estrangeiro', () => {
    expect(
      WorkdayClient.extractNationalId([
        { id: wid, descriptor: '000-00-0000 (USA-SSN)' },
        { id: wid, descriptor: '123.456.789-09 (BRA-CPF)' },
      ]),
    ).toBe('12345678909');
  });

  it('com vários documentos estrangeiros, usa o primeiro da lista', () => {
    expect(
      WorkdayClient.extractNationalId([
        { id: wid, descriptor: '111-11-1111 (USA-SSN)' },
        { id: wid, descriptor: '222 222 222 (CAN-SIN)' },
      ]),
    ).toBe('111-11-1111');
  });

  it('ignora itens ilegíveis e usa o próximo documento válido', () => {
    expect(
      WorkdayClient.extractNationalId([
        { id: wid },
        { id: wid, descriptor: 'sem padrão' },
        { id: wid, descriptor: '111-11-1111 (USA-SSN)' },
      ]),
    ).toBe('111-11-1111');
  });

  it('retorna null para vazio, formato inesperado ou sem descriptor', () => {
    expect(WorkdayClient.extractNationalId(undefined)).toBeNull();
    expect(WorkdayClient.extractNationalId([])).toBeNull();
    expect(WorkdayClient.extractNationalId([{ id: wid }])).toBeNull();
    expect(
      WorkdayClient.extractNationalId([{ id: wid, descriptor: 'sem padrão' }]),
    ).toBeNull();
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

  it('demissão não depende do documento: documento inválido ainda inativa', async () => {
    const inactivate = jest.fn().mockResolvedValue(undefined);
    const job = makeJob({
      pmovel: {
        getEmployeeByExternalId: jest
          .fn()
          .mockResolvedValue({ id: 1, active: true }),
        inactivateEmployeeByExternalId: inactivate,
      } as unknown as Partial<PmovelClient>,
    });

    const result = await job.processItem({
      externalId: '1001',
      payload: {
        ...baseWorker,
        cpf: '000000000',
        active: false,
        terminationDate: '2026-01-31',
      },
    });

    expect(result.operation).toBe(SyncOperation.INACTIVATE);
    expect(inactivate).toHaveBeenCalled();
  });

  it('worker terminado que já está inativo no Pmovel → SKIP (não inativa de novo)', async () => {
    const inactivate = jest.fn();
    const job = makeJob({
      pmovel: {
        getEmployeeByExternalId: jest
          .fn()
          .mockResolvedValue({ id: 1, active: false }),
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

    expect(result.skipped).toBe(true);
    expect(result.summary).toBe('já inativo');
    expect(inactivate).not.toHaveBeenCalled();
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

describe('EmployeeSyncJob: conflito de e-mail/CPF (tratamento manual)', () => {
  const conflictBody = JSON.stringify({
    message: [
      'Employee with email sarah.hill@workday.net or CPF AB123456C already exists.',
    ],
    error: 'Bad Request',
    status_code: 400,
  });

  it('na criação: vira ManualReviewError com e-mail e CPF em destaque, sem PUT', async () => {
    const createEmployee = jest
      .fn()
      .mockRejectedValue(new RestClientError('conflito', 400, conflictBody));
    const updateEmployeeByExternalId = jest.fn();
    const job = makeJob({
      pmovel: {
        getEmployeeByExternalId: jest.fn().mockResolvedValue(null),
        createEmployee,
        updateEmployeeByExternalId,
      } as unknown as Partial<PmovelClient>,
    });

    const err = (await job
      .processItem({ externalId: '21609', payload: baseWorker })
      .catch((e) => e)) as ManualReviewError;

    expect(err).toBeInstanceOf(ManualReviewError);
    expect(err.message).toContain('TRATAMENTO MANUAL');
    expect(err.message).toContain('e-mail=sarah.hill@workday.net');
    expect(err.message).toContain('CPF=AB123456C');
    expect(err.message).toContain('external_id=21609');
    expect(err.details).toEqual({
      external_id: '21609',
      'e-mail': 'sarah.hill@workday.net',
      CPF: 'AB123456C',
    });
    expect(updateEmployeeByExternalId).not.toHaveBeenCalled();
  });

  it('na atualização (PUT) também vira ManualReviewError', async () => {
    const job = makeJob({
      pmovel: {
        getEmployeeByExternalId: jest
          .fn()
          .mockResolvedValue({ id: 1, active: true }),
        updateEmployeeByExternalId: jest
          .fn()
          .mockRejectedValue(
            new RestClientError('conflito', 400, conflictBody),
          ),
      } as unknown as Partial<PmovelClient>,
    });

    const err = await job
      .processItem({ externalId: '21609', payload: baseWorker })
      .catch((e) => e);

    expect(err).toBeInstanceOf(ManualReviewError);
    expect(err.message).toContain('CPF=AB123456C');
  });

  it('no fallback external_id → PUT, conflito de e-mail/CPF também vira tratamento manual', async () => {
    const job = makeJob({
      pmovel: {
        getEmployeeByExternalId: jest.fn().mockResolvedValue(null),
        createEmployee: jest
          .fn()
          .mockRejectedValue(
            new RestClientError('dup', 409, 'external_id already exists'),
          ),
        updateEmployeeByExternalId: jest
          .fn()
          .mockRejectedValue(
            new RestClientError('conflito', 400, conflictBody),
          ),
      } as unknown as Partial<PmovelClient>,
    });

    const err = await job
      .processItem({ externalId: '21609', payload: baseWorker })
      .catch((e) => e);

    expect(err).toBeInstanceOf(ManualReviewError);
  });

  it('outros erros da API continuam como estão (não viram tratamento manual)', async () => {
    const original = new RestClientError(
      'campo inválido',
      400,
      JSON.stringify({ message: ['email must be an email'] }),
    );
    const job = makeJob({
      pmovel: {
        getEmployeeByExternalId: jest.fn().mockResolvedValue(null),
        createEmployee: jest.fn().mockRejectedValue(original),
      } as unknown as Partial<PmovelClient>,
    });

    await expect(
      job.processItem({ externalId: '1001', payload: baseWorker }),
    ).rejects.toBe(original);
  });

  describe('parseEmailCpfConflict', () => {
    it('extrai e-mail e CPF, inclusive CPF com espaços', () => {
      const body = JSON.stringify({
        message: [
          'Employee with email a@b.com or CPF 000 000 000 already exists.',
        ],
      });
      expect(
        EmployeeSyncJob.parseEmailCpfConflict(
          new RestClientError('', 400, body),
        ),
      ).toEqual({ email: 'a@b.com', cpf: '000 000 000' });
    });

    it('funciona com corpo que não é JSON', () => {
      expect(
        EmployeeSyncJob.parseEmailCpfConflict(
          new RestClientError(
            '',
            400,
            'Employee with email x@y.com or CPF 123 already exists.',
          ),
        ),
      ).toEqual({ email: 'x@y.com', cpf: '123' });
    });

    it('não confunde com external_id duplicado', () => {
      const body = JSON.stringify({
        message: ['Employee with external_id 21411 already exists.'],
      });
      expect(
        EmployeeSyncJob.parseEmailCpfConflict(
          new RestClientError('', 400, body),
        ),
      ).toBeNull();
    });

    it('ignora status que não são de validação', () => {
      expect(
        EmployeeSyncJob.parseEmailCpfConflict(
          new RestClientError(
            '',
            500,
            'Employee with email a@b.com or CPF 1 already exists.',
          ),
        ),
      ).toBeNull();
    });
  });
});

describe('EmployeeSyncJob.isAlreadyExists', () => {
  it('reconhece 409', () => {
    expect(
      EmployeeSyncJob.isAlreadyExists(new RestClientError('', 409, '')),
    ).toBe(true);
  });

  it('reconhece external_id duplicado (mensagem real da API do Pmovel)', () => {
    const body = JSON.stringify({
      message: ['Employee with external_id 21411 already exists.'],
      error: 'Bad Request',
    });
    expect(
      EmployeeSyncJob.isAlreadyExists(new RestClientError('', 400, body)),
    ).toBe(true);
  });

  it('NÃO trata e-mail/CPF de outra pessoa como external_id duplicado', () => {
    const body = JSON.stringify({
      message: ['Employee with email a@b.com or CPF 123 already exists.'],
      error: 'Bad Request',
    });
    expect(
      EmployeeSyncJob.isAlreadyExists(new RestClientError('', 400, body)),
    ).toBe(false);
  });

  it('não reconhece 400 genérico', () => {
    expect(
      EmployeeSyncJob.isAlreadyExists(
        new RestClientError('', 400, 'invalid email'),
      ),
    ).toBe(false);
  });
});
