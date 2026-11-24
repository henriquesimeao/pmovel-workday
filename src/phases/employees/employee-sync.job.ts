import { Injectable, Logger } from '@nestjs/common';
import {
  PhaseSyncJob,
  SyncItemInput,
  ItemResult,
} from '../../sync/phase-sync-job';
import { SyncOperation } from '../../persistence/entities/sync-item.entity';
import { WorkdayClient } from '../../workday/workday.client';
import { PmovelClient } from '../../pmovel/pmovel.client';
import { EmployeeResponse } from '../../pmovel/pmovel.types';
import { EmployeeMapper } from '../../mapping/employee.mapper';
import { ConsolidatedWorker } from '../../workday/consolidated-worker';
import { RestClientError } from '../../common/http/rest-client.error';
import { ManualReviewError } from '../../sync/manual-review.error';

/**
 * Fase 1 — sincronização de colaboradores (Workday → Pmovel).
 *
 * `fetchItems`: uma única query WQL (`allActiveAndTerminatedWorkers`) traz todos
 * os workers, ativos e demitidos, já consolidados. O parâmetro `since` (cursor)
 * ainda NÃO é usado: toda execução varre o conjunto inteiro e a idempotência vem
 * do destino. Diff por data de alteração é uma pendência (docs/continuidade.md).
 *
 * `processItem`: classifica e aplica:
 * - **demissão**: worker inativo/demitido → consulta o Pmovel; só `inactivate` se
 *   ele existir e ainda estiver ativo. Inexistente ou já inativo é ignorado.
 * - **admissão**: worker novo → `POST`. Se a API disser que o `external_id` já
 *   existe, cai para `PUT`.
 * - **atualização**: worker já existente e ativo → `PUT`.
 * - **readmissão**: worker ativo no Workday, mas inativo no Pmovel:
 *   - mesma data de admissão **e** mesma empresa (CNPJ) → a demissão foi
 *     desfeita no Workday: `reactivate` (limpa `dt_demissao`) + `PUT`;
 *   - senão → readmissão com novo cadastro: `POST` com `join_history: true`
 *     (o Pmovel cria um novo registro e liga o histórico ao antigo).
 *
 * Conflito de e-mail/CPF com outra pessoa NÃO vira PUT: é convertido em
 * `ManualReviewError` (tratamento manual), com os valores em destaque.
 *
 * A chave de correlação é o `external_id` (derivado do worker pela config de
 * mapeamento).
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
    if (EmployeeSyncJob.isTerminated(worker)) {
      return this.applyTermination(item.externalId, worker);
    }

    // 2) Admissão/atualização/readmissão: existe no Pmovel?
    const existing = await this.pmovel.getEmployeeByExternalId(item.externalId);
    if (!existing) {
      return this.applyUpsertCreate(item.externalId, worker);
    }
    if (existing.active === false) {
      return this.applyReadmission(item.externalId, worker, existing);
    }
    return this.applyUpdate(item.externalId, worker);
  }

  /**
   * O worker conta como demitido quando está inativo no Workday, ou quando tem
   * data de demissão que não é anterior à admissão atual. Numa recontratação o
   * Workday pode manter a data da demissão antiga: se ela é anterior à nova
   * admissão, a pessoa está ativa (foi readmitida).
   */
  static isTerminated(worker: ConsolidatedWorker): boolean {
    if (worker.active === false) return true;
    const termination = EmployeeSyncJob.dateKey(worker.terminationDate);
    if (!termination) return false;
    const hire = EmployeeSyncJob.dateKey(worker.hireDate);
    return !hire || termination >= hire;
  }

  /**
   * Worker ativo no Workday e inativo no Pmovel.
   *
   * Só reativa o cadastro existente quando a data de admissão e a empresa
   * (CNPJ) são as mesmas: é o caso de demissão desfeita no Workday. Qualquer
   * diferença indica nova admissão, e o Pmovel recebe um novo cadastro com
   * `join_history` (liga o histórico ao cadastro antigo).
   */
  private async applyReadmission(
    externalId: string,
    worker: ConsolidatedWorker,
    existing: EmployeeResponse,
  ): Promise<ItemResult> {
    const workerCnpj = await this.mapper.resolveCnpj(worker);
    const pmovelHire = EmployeeSyncJob.dateKey(existing.dt_admissao);
    const workdayHire = EmployeeSyncJob.dateKey(worker.hireDate);
    const pmovelCnpj = EmployeeSyncJob.cnpjKey(existing.cnpj);
    const workdayCnpj = EmployeeSyncJob.cnpjKey(workerCnpj);

    const sameHireDate = !!workdayHire && pmovelHire === workdayHire;
    const sameCompany = !!workdayCnpj && pmovelCnpj === workdayCnpj;

    if (sameHireDate && sameCompany) {
      await this.pmovel.reactivateEmployeeByExternalId(externalId, {
        clean_dt_demissao: true,
      });
      await this.applyUpdate(externalId, worker);
      return {
        operation: SyncOperation.REACTIVATE,
        summary: 'reativado (mesma admissão e empresa)',
      };
    }

    const reasons: string[] = [];
    if (!sameHireDate) {
      reasons.push(`admissão ${pmovelHire || '?'} → ${workdayHire || '?'}`);
    }
    if (!sameCompany) {
      reasons.push(`empresa ${pmovelCnpj || '?'} → ${workdayCnpj || '?'}`);
    }

    const createDto = await this.mapper.toCreateDto(worker);
    try {
      await this.pmovel.createEmployee({ ...createDto, join_history: true });
    } catch (e) {
      throw this.asManualReview(externalId, e);
    }
    return {
      operation: SyncOperation.CREATE,
      summary: `readmitido, novo cadastro (${reasons.join('; ')})`,
    };
  }

  /** Data como `YYYY-MM-DD` (ignora hora/fuso); vazio quando não há data. */
  static dateKey(value: unknown): string {
    if (value === undefined || value === null) return '';
    const match = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : '';
  }

  /** CNPJ só com letras e números, maiúsculo (aceita o CNPJ alfanumérico). */
  static cnpjKey(value: unknown): string {
    if (value === undefined || value === null) return '';
    return String(value)
      .replace(/[^A-Za-z0-9]/g, '')
      .toUpperCase();
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
    summary = 'atualizado',
  ): Promise<ItemResult> {
    const dto = await this.mapper.toUpdateDto(worker);
    try {
      await this.pmovel.updateEmployeeByExternalId(externalId, dto);
    } catch (e) {
      throw this.asManualReview(externalId, e);
    }
    return { operation: SyncOperation.UPDATE, summary };
  }

  /**
   * Admissão com upsert: tenta POST; se a API indicar que o `external_id` já
   * existe, cai para PUT. Conflito de e-mail/CPF com outra pessoa não é upsert:
   * vira item para tratamento manual.
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
        return this.applyUpdate(externalId, worker, 'já existia → atualizado');
      }
      throw this.asManualReview(externalId, e);
    }
  }

  /**
   * Se o erro for "e-mail ou CPF já existe" (outra pessoa já usa esses dados no
   * Pmovel), devolve um ManualReviewError com os dois valores em destaque.
   * Qualquer outro erro é devolvido sem alteração.
   */
  private asManualReview(externalId: string, e: unknown): unknown {
    if (!(e instanceof RestClientError)) return e;
    const conflict = EmployeeSyncJob.parseEmailCpfConflict(e);
    if (!conflict) return e;
    return new ManualReviewError(
      externalId,
      'e-mail ou CPF já existe no Pmovel',
      {
        external_id: externalId,
        'e-mail': conflict.email,
        CPF: conflict.cpf,
      },
      'localizar no Pmovel o colaborador ativo (de qualquer cliente) com esse e-mail ou CPF, inclusive só os dígitos do CPF',
    );
  }

  /**
   * Lê "Employee with email X or CPF Y already exists." da resposta de erro e
   * devolve os dois valores. Devolve null para qualquer outro erro, inclusive
   * "Employee with external_id X already exists".
   */
  static parseEmailCpfConflict(
    e: RestClientError,
  ): { email: string; cpf: string } | null {
    if (e.status !== 400 && e.status !== 409 && e.status !== 422) return null;

    let text = e.body ?? '';
    try {
      const parsed = JSON.parse(text) as { message?: unknown };
      const message = Array.isArray(parsed.message)
        ? parsed.message.join(' ')
        : parsed.message;
      if (typeof message === 'string') text = message;
    } catch {
      // corpo não é JSON: usa o texto como veio
    }

    const match = text.match(
      /Employee with email (.+?) or CPF (.+?) already exists/i,
    );
    return match ? { email: match[1].trim(), cpf: match[2].trim() } : null;
  }

  /**
   * Indica que o POST falhou porque o `external_id` já existe no Pmovel (o que
   * justifica cair para PUT). A API usa a mesma expressão "already exists" para
   * outro erro, que NÃO deve virar PUT: e-mail ou CPF que já pertencem a outra
   * pessoa ("Employee with email X or CPF Y already exists"). Por isso só
   * aceitamos a mensagem que cita o `external_id`.
   */
  static isAlreadyExists(e: RestClientError): boolean {
    if (e.status === 409) return true;
    if (e.status === 400 || e.status === 422) {
      return /external_id[^"]*already exists/i.test(e.body ?? '');
    }
    return false;
  }
}
