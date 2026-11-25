import { Logger } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { PmovelClient } from '../../pmovel/pmovel.client';
import { PayrollExport } from '../../pmovel/pmovel.types';
import { SyncOrchestrator } from '../../sync/sync.orchestrator';
import { SyncRunRepository } from '../../persistence/sync-run.repository';
import { SyncRunStatus } from '../../persistence/entities/sync-run.entity';
import { SyncItemStatus } from '../../persistence/entities/sync-item.entity';
import {
  INTERRUPTED_EXPORT_MESSAGE,
  PayrollExportPoller,
} from './payroll-export.poller';
import { PayrollExportJob } from './payroll-export.job';

const request: PayrollExport = {
  id: 123,
  cnpj: '00111111000200',
  cycle: {
    id: 456,
    start_date: '2026-05-15',
    end_date: '2026-06-14',
    closed: true,
  },
  scope: 'global',
  external_id: null,
  target: 'workday',
  status: 'pending',
};

describe('PayrollExportPoller', () => {
  let pmovel: Record<string, jest.Mock>;
  let orchestrator: { run: jest.Mock };
  let runs: { findById: jest.Mock };
  let job: { takeReport: jest.Mock };
  let enabled: boolean;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    enabled = true;
    pmovel = {
      listPayrollExports: jest.fn(async (status: string) =>
        status === 'pending' ? [request] : [],
      ),
      startPayrollExport: jest.fn(async () => ({
        ...request,
        status: 'processing',
      })),
      finishPayrollExport: jest.fn(async () => undefined),
    };
    orchestrator = { run: jest.fn(async () => 7) };
    runs = {
      findById: jest.fn(async () => ({
        id: 7,
        status: SyncRunStatus.COMPLETED,
        items: [],
      })),
    };
    job = {
      takeReport: jest.fn(() => ({
        employees: 2,
        sent: 3,
        zeroed: 1,
        warnings: ['aviso'],
      })),
    };
  });

  afterEach(() => jest.restoreAllMocks());

  const makePoller = () =>
    new PayrollExportPoller(
      {
        payrollExport: {
          enabled,
          pollSeconds: 60,
          destination: 'external_payroll_input',
        },
      } as unknown as AppConfigService,
      pmovel as unknown as PmovelClient,
      orchestrator as unknown as SyncOrchestrator,
      runs as unknown as SyncRunRepository,
      job as unknown as PayrollExportJob,
    );

  it('desligado: não consulta o Pmovel', async () => {
    enabled = false;
    const poller = makePoller();
    await poller.onApplicationBootstrap();
    expect(pmovel.listPayrollExports).not.toHaveBeenCalled();
    poller.onApplicationShutdown();
  });

  it('ao subir, devolve como failed as solicitações em processamento', async () => {
    pmovel.listPayrollExports.mockImplementation(async (status: string) =>
      status === 'processing' ? [{ ...request, id: 99 }] : [],
    );
    const poller = makePoller();
    await poller.onApplicationBootstrap();
    poller.onApplicationShutdown();
    expect(pmovel.finishPayrollExport).toHaveBeenCalledWith(99, {
      status: 'failed',
      summary: null,
      errors: [],
      error_message: INTERRUPTED_EXPORT_MESSAGE,
    });
  });

  it('assume, executa o job com a solicitação e devolve completed', async () => {
    await makePoller().tick();

    expect(pmovel.startPayrollExport).toHaveBeenCalledWith(123);
    expect(orchestrator.run).toHaveBeenCalledWith(job, 'pmovel', {
      request: expect.objectContaining({ id: 123, status: 'processing' }),
    });
    expect(pmovel.finishPayrollExport).toHaveBeenCalledWith(123, {
      status: 'completed',
      summary: {
        employees: 2,
        inputs_sent: 3,
        inputs_zeroed: 1,
        failures: 0,
        warnings: ['aviso'],
      },
      errors: [],
      error_message: null,
    });
  });

  it('falhas de item viram completed_with_errors, com colaborador e verba', async () => {
    runs.findById.mockResolvedValue({
      id: 7,
      status: SyncRunStatus.COMPLETED,
      items: [
        { externalId: '21411/0020', status: SyncItemStatus.SUCCESS },
        {
          externalId: '21609/0020',
          status: SyncItemStatus.FAILURE,
          errorMessage:
            "Workday Put_External_Payroll_Input: Invalid ID value 'X'",
        },
      ],
    });
    await makePoller().tick();
    const dto = pmovel.finishPayrollExport.mock.calls[0][1];
    expect(dto.status).toBe('completed_with_errors');
    expect(dto.summary.failures).toBe(1);
    expect(dto.errors).toEqual([
      {
        external_id: '21609',
        code: '0020',
        message: "Workday Put_External_Payroll_Input: Invalid ID value 'X'",
      },
    ]);
  });

  it('run com falha (ex.: moeda não configurada) vira failed com a mensagem', async () => {
    runs.findById.mockResolvedValue({
      id: 7,
      status: SyncRunStatus.FAILED,
      errorMessage: 'moeda não configurada para a empresa 00111111000200',
      items: [],
    });
    await makePoller().tick();
    expect(pmovel.finishPayrollExport).toHaveBeenCalledWith(123, {
      status: 'failed',
      summary: null,
      errors: [],
      error_message: 'moeda não configurada para a empresa 00111111000200',
    });
  });

  it('erro ao executar (ex.: job já em andamento) vira failed', async () => {
    orchestrator.run.mockRejectedValue(
      new Error('Já existe uma sincronização em andamento'),
    );
    await makePoller().tick();
    expect(pmovel.finishPayrollExport.mock.calls[0][1]).toMatchObject({
      status: 'failed',
      error_message: 'Já existe uma sincronização em andamento',
    });
    expect(job.takeReport).toHaveBeenCalledWith(123);
  });

  it('se outro processo já assumiu (409), não executa', async () => {
    pmovel.startPayrollExport.mockResolvedValue(null);
    await makePoller().tick();
    expect(orchestrator.run).not.toHaveBeenCalled();
    expect(pmovel.finishPayrollExport).not.toHaveBeenCalled();
  });

  it('uma rodada por vez', async () => {
    let release!: () => void;
    orchestrator.run.mockImplementation(
      () => new Promise<number>((r) => (release = () => r(7))),
    );
    const poller = makePoller();
    const first = poller.tick();
    await new Promise((r) => setImmediate(r));
    await poller.tick(); // ignorada: a primeira ainda roda
    release();
    await first;
    expect(pmovel.listPayrollExports).toHaveBeenCalledTimes(1);
  });

  it('falha ao devolver o resultado não derruba a rodada', async () => {
    pmovel.finishPayrollExport.mockRejectedValue(
      new Error('Pmovel fora do ar'),
    );
    await expect(makePoller().tick()).resolves.toBeUndefined();
  });
});
