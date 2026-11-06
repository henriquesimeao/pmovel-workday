import { JobRegistry } from './job-registry';
import { SyncScheduler } from './sync.scheduler';
import { SyncOrchestrator, SyncAlreadyRunningError } from './sync.orchestrator';
import { AppConfigService } from '../config/app-config.service';
import { SchedulerRegistry } from '@nestjs/schedule';
import { PhaseSyncJob } from './phase-sync-job';
import { SyncOperation } from '../persistence/entities/sync-item.entity';

function fakeJob(phase: string, type: string): PhaseSyncJob {
  return {
    key: `${phase}:${type}`,
    phase,
    type,
    fetchItems: async () => [],
    processItem: async () => ({ operation: SyncOperation.NONE }),
  };
}

describe('SyncScheduler', () => {
  it('runAll executa todos os jobs registrados', async () => {
    const registry = new JobRegistry();
    registry.register(fakeJob('employees', 'full'));
    registry.register(fakeJob('other', 'x'));

    const run = jest.fn().mockResolvedValue(1);
    const orchestrator = { run } as unknown as SyncOrchestrator;
    const config = {
      sync: { cron: '0 * * * *', scheduleEnabled: false },
    } as AppConfigService;

    const scheduler = new SyncScheduler(
      orchestrator,
      registry,
      config,
      {} as SchedulerRegistry,
    );

    await scheduler.runAll();
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenCalledWith(expect.anything(), 'scheduled');
  });

  it('runAll ignora SyncAlreadyRunningError e segue', async () => {
    const registry = new JobRegistry();
    registry.register(fakeJob('a', '1'));
    registry.register(fakeJob('b', '2'));

    const run = jest
      .fn()
      .mockRejectedValueOnce(new SyncAlreadyRunningError('a', '1'))
      .mockResolvedValueOnce(2);
    const orchestrator = { run } as unknown as SyncOrchestrator;
    const config = {
      sync: { cron: '0 * * * *', scheduleEnabled: false },
    } as AppConfigService;

    const scheduler = new SyncScheduler(
      orchestrator,
      registry,
      config,
      {} as SchedulerRegistry,
    );

    await expect(scheduler.runAll()).resolves.toBeUndefined();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('onModuleInit não agenda quando desabilitado', () => {
    const registry = new JobRegistry();
    const orchestrator = { run: jest.fn() } as unknown as SyncOrchestrator;
    const config = {
      sync: { cron: '0 * * * *', scheduleEnabled: false },
    } as AppConfigService;
    const addCronJob = jest.fn();
    const schedulerRegistry = { addCronJob } as unknown as SchedulerRegistry;

    const scheduler = new SyncScheduler(
      orchestrator,
      registry,
      config,
      schedulerRegistry,
    );
    scheduler.onModuleInit();

    expect(addCronJob).not.toHaveBeenCalled();
  });

  it('onModuleInit agenda quando habilitado', () => {
    const registry = new JobRegistry();
    const orchestrator = { run: jest.fn() } as unknown as SyncOrchestrator;
    const config = {
      sync: { cron: '0 * * * *', scheduleEnabled: true },
    } as AppConfigService;
    const addCronJob = jest.fn();
    const schedulerRegistry = { addCronJob } as unknown as SchedulerRegistry;

    const scheduler = new SyncScheduler(
      orchestrator,
      registry,
      config,
      schedulerRegistry,
    );
    scheduler.onModuleInit();

    expect(addCronJob).toHaveBeenCalledWith('sync-all', expect.anything());

    // Para o CronJob criado para não vazar timer no processo de teste.
    const created = addCronJob.mock.calls[0][1] as { stop: () => void };
    created.stop();
  });
});
