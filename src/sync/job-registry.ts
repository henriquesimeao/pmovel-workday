import { Injectable } from '@nestjs/common';
import { PhaseSyncJob } from './phase-sync-job';

/**
 * Registro de jobs de fase disponíveis, indexado por `phase/type`.
 * Os módulos de fase (ex.: EmployeesModule) registram seus jobs aqui; o
 * controller e o scheduler os localizam para disparar.
 */
@Injectable()
export class JobRegistry {
  private readonly jobs = new Map<string, PhaseSyncJob>();

  register(job: PhaseSyncJob): void {
    this.jobs.set(JobRegistry.compositeKey(job.phase, job.type), job);
  }

  get(phase: string, type: string): PhaseSyncJob | undefined {
    return this.jobs.get(JobRegistry.compositeKey(phase, type));
  }

  list(): PhaseSyncJob[] {
    return [...this.jobs.values()];
  }

  static compositeKey(phase: string, type: string): string {
    return `${phase}/${type}`;
  }
}
