import { Injectable, Logger } from '@nestjs/common';
import {
  PhaseSyncJob,
  SyncItemInput,
  ItemResult,
} from '../../sync/phase-sync-job';
import { SyncOperation } from '../../persistence/entities/sync-item.entity';
import { WorkdayClient } from '../../workday/workday.client';
import { PmovelClient } from '../../pmovel/pmovel.client';
import { EmployeeMapper } from '../../mapping/employee.mapper';
import { ConsolidatedWorker } from '../../workday/consolidated-worker';
import { RestClientError } from '../../common/http/rest-client.error';

/**
 * Fase 1 — sincronização de colaboradores (Workday → Pmovel).
 *
 * `fetchItems`: lista os workers do Workday e consolida cada um. (O filtro por
 * diff real desde o cursor depende de WQL/SOAP com data de última alteração —
 * ver gap no de/para; por ora processa o conjunto, com idempotência no destino.)
 *
 * `processItem`: classifica e aplica:
 * - **demissão**: worker inativo/terminado → `inactivate` no Pmovel (se existir).
 * - **admissão**: worker novo → `POST` (upsert: se já existe, cai para `PUT`).
 * - **atualização**: worker já existente e ativo → `PUT`.
 *
 * A chave de correlação é o `external_id` (derivado do worker pela config de
 * mapeamento). Idempotência garantida pelo upsert + checagem de existência.
 */
@Injectable()
export class EmployeeSyncJob implements PhaseSyncJob<ConsolidatedWorker> {
  readonly key = 'employees:full';
  readonly phase = 'employees';
  readonly type = 'full';

  private readonly logger = new Logger(EmployeeSyncJob.name);

  constructor(
    private readonly workday: WorkdayClient,
    private readonly pmovel: PmovelClient,
    private readonly mapper: EmployeeMapper,
  ) {}

  async fetchItems(
    _since: Date | null,
  ): Promise<SyncItemInput<ConsolidatedWorker>[]> {
    // Uma única query WQL paginada traz ativos e terminados com todos os campos
    // da Fase 1 (hireDate, terminationDate, status, company, etc.) — muito mais
    // eficiente que N chamadas REST por worker.
    const items: SyncItemInput<ConsolidatedWorker>[] = [];
    for await (const worker of this.workday.listConsolidatedWorkersViaWql()) {
      const externalId = worker.workerId || worker.id;
      items.push({ externalId, payload: worker });
    }
    this.logger.log(`${items.length} worker(s) consolidados do Workday (WQL)`);
    return items;
  }

  async processItem(
    item: SyncItemInput<ConsolidatedWorker>,
  ): Promise<ItemResult> {
    const worker = item.payload;

    // 1) Demissão: worker inativo/terminado.
    if (worker.active === false || worker.terminationDate) {
      return this.applyTermination(item.externalId, worker);
    }

    // 2) Admissão/atualização: existe no Pmovel?
    const existing = await this.pmovel.getEmployeeByExternalId(item.externalId);
    if (existing) {
      return this.applyUpdate(item.externalId, worker);
    }
    return this.applyUpsertCreate(item.externalId, worker);
  }

  /** Demissão via inactivate (só se o colaborador existir no Pmovel). */
  private async applyTermination(
    externalId: string,
    worker: ConsolidatedWorker,
  ): Promise<ItemResult> {
    const existing = await this.pmovel.getEmployeeByExternalId(externalId);
    if (!existing) {
      return {
        skipped: true,
        operation: SyncOperation.NONE,
        summary: 'inexistente no Pmovel',
      };
    }
    if (existing.active === false) {
      return {
        skipped: true,
        operation: SyncOperation.NONE,
        summary: 'já inativo',
      };
    }
    await this.pmovel.inactivateEmployeeByExternalId(externalId, {
      dt_demissao: worker.terminationDate ?? null,
    });
    return { operation: SyncOperation.INACTIVATE, summary: 'demitido' };
  }

  /** Atualização via PUT. */
  private async applyUpdate(
    externalId: string,
    worker: ConsolidatedWorker,
  ): Promise<ItemResult> {
    const dto = await this.mapper.toUpdateDto(worker);
    await this.pmovel.updateEmployeeByExternalId(externalId, dto);
    return { operation: SyncOperation.UPDATE, summary: 'atualizado' };
  }

  /**
   * Admissão com upsert: tenta POST; se a API indicar "já existe" (409, ou 400
   * com mensagem de duplicidade), cai para PUT.
   */
  private async applyUpsertCreate(
    externalId: string,
    worker: ConsolidatedWorker,
  ): Promise<ItemResult> {
    const createDto = await this.mapper.toCreateDto(worker);
    try {
      await this.pmovel.createEmployee(createDto);
      return { operation: SyncOperation.CREATE, summary: 'admitido' };
    } catch (e) {
      if (e instanceof RestClientError && EmployeeSyncJob.isAlreadyExists(e)) {
        const dto = await this.mapper.toUpdateDto(worker);
        await this.pmovel.updateEmployeeByExternalId(externalId, dto);
        return {
          operation: SyncOperation.UPDATE,
          summary: 'já existia → atualizado',
        };
      }
      throw e;
    }
  }

  /** Heurística de "já existe": 409, ou 400/422 com menção a duplicidade. */
  static isAlreadyExists(e: RestClientError): boolean {
    if (e.status === 409) return true;
    if (e.status === 400 || e.status === 422) {
      return /exist|duplic|already|já existe/i.test(e.body ?? '');
    }
    return false;
  }
}
