import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ItemResult,
  JobRunContext,
  PhaseSyncJob,
  SyncItemInput,
} from '../../sync/phase-sync-job';
import { SyncOperation } from '../../persistence/entities/sync-item.entity';
import { PmovelClient } from '../../pmovel/pmovel.client';
import {
  PayrollExport,
  PayrollExportTotalsEmployee,
  PayrollExportTotalsEvent,
} from '../../pmovel/pmovel.types';
import { CnpjMappingRepository } from '../../persistence/cnpj-mapping.repository';
import { PayrollInputSentRepository } from '../../persistence/payroll-input-sent.repository';
import { PayrollInputSent } from '../../persistence/entities/payroll-input-sent.entity';
import {
  PAYROLL_INPUT_WRITER,
  PayrollInputLine,
  PayrollInputWriter,
} from './writers/payroll-input-writer';

/** Parâmetros de uma execução: a solicitação de envio assumida no Pmovel. */
export interface PayrollExportParams {
  request: PayrollExport;
}

/** Um item da run: enviar o total de uma verba, ou zerar uma que sumiu. */
export type PayrollExportItem =
  | {
      kind: 'send';
      employee: PayrollExportTotalsEmployee;
      event: PayrollExportTotalsEvent;
    }
  | { kind: 'zero'; previous: PayrollInputSent };

/** Contadores e avisos de uma solicitação, devolvidos ao Pmovel no `finish`. */
export interface PayrollExportReport {
  employees: number;
  sent: number;
  zeroed: number;
  warnings: string[];
}

/** Tamanho da página ao ler os totais no Pmovel. */
const TOTALS_PAGE_SIZE = 100;

/**
 * Fase 2: envia ao Workday as horas do ciclo, por colaborador e verba.
 *
 * Disparado pelo `PayrollExportPoller` com uma solicitação do Pmovel (não fica
 * no `JobRegistry`: sem a solicitação, não há o que enviar).
 *
 * **Id do lançamento.** Cada lançamento usa `PMV-<ciclo>-<colaborador>-<verba>`
 * como `Payroll_Input_ID`. No Workday, gravar de novo com o mesmo id atualiza o
 * lançamento no lugar (validado nos dois destinos), então reenviar nunca soma
 * horas. Como o id não depende do escopo, o envio individual de alguém que já
 * foi no global também só atualiza.
 *
 * **Verba que sumiu num reenvio.** Não há operação de exclusão no Workday: o
 * lançamento é zerado. No global, zera o que foi enviado antes pelo global e não
 * veio agora; no individual, o que foi enviado antes para aquele colaborador.
 *
 * **Avisos.** No global, quem estava no envio anterior e não veio mais (ex.:
 * demitido dentro do ciclo) tem os lançamentos zerados e precisa do envio
 * individual; isso vai como aviso no resultado.
 */
@Injectable()
export class PayrollExportJob implements PhaseSyncJob<PayrollExportItem> {
  readonly key = 'payroll-events:export';
  readonly phase = 'payroll-events';
  readonly type = 'export';

  private readonly logger = new Logger(PayrollExportJob.name);
  private readonly reports = new Map<number, PayrollExportReport>();
  /** Moeda da empresa de cada solicitação em andamento. */
  private readonly currencies = new Map<number, string | null>();

  constructor(
    private readonly pmovel: PmovelClient,
    private readonly cnpjMappings: CnpjMappingRepository,
    private readonly sent: PayrollInputSentRepository,
    @Inject(PAYROLL_INPUT_WRITER) private readonly writer: PayrollInputWriter,
  ) {}

  /** Devolve e descarta o relatório de uma solicitação. */
  takeReport(requestId: number): PayrollExportReport {
    const report = this.reports.get(requestId) ?? {
      employees: 0,
      sent: 0,
      zeroed: 0,
      warnings: [],
    };
    this.reports.delete(requestId);
    this.currencies.delete(requestId);
    return report;
  }

  async fetchItems(
    _since: Date | null,
    context?: JobRunContext,
  ): Promise<SyncItemInput<PayrollExportItem>[]> {
    const request = PayrollExportJob.requestOf(context);
    const currency = await this.currencyFor(request.cnpj);
    if (this.writer.destination === 'external_payroll_input' && !currency) {
      throw new Error(
        `moeda não configurada para a empresa ${PayrollExportJob.cnpjKey(request.cnpj)}: o Payroll Interface exige a moeda; preencha currency em cnpj_mapping (seed)`,
      );
    }
    this.currencies.set(request.id, currency);
    const employees = await this.readAllTotals(request.id);
    const previous = await this.sent.findByCycle(request.cycle.id);

    const items: SyncItemInput<PayrollExportItem>[] = [];
    const current = new Set<string>();
    for (const employee of employees) {
      for (const event of employee.events) {
        current.add(PayrollExportJob.rowKey(employee.employee_id, event.code));
        items.push({
          externalId: `${employee.external_id}/${event.code}`,
          payload: { kind: 'send', employee, event },
        });
      }
    }

    const toZero = previous.filter((row) => {
      if (current.has(PayrollExportJob.rowKey(row.employeeId, row.eventCode)))
        return false;
      if (Number(row.hours) === 0 && row.totalSeconds === 0) return false;
      return request.scope === 'global'
        ? row.scope === 'global'
        : row.externalId === request.external_id;
    });
    for (const row of toZero) {
      items.push({
        externalId: `${row.externalId}/${row.eventCode}`,
        payload: { kind: 'zero', previous: row },
      });
    }

    const warnings: string[] = [];
    if (request.scope === 'global') {
      const now = new Set(employees.map((e) => e.employee_id));
      const gone = new Set(
        toZero.filter((r) => !now.has(r.employeeId)).map((r) => r.externalId),
      );
      for (const externalId of gone) {
        warnings.push(
          `colaborador ${externalId} estava no envio global anterior e não veio neste (demitido no ciclo?): os lançamentos dele foram zerados; faça o envio individual`,
        );
      }
    }

    this.reports.set(request.id, {
      employees: employees.length,
      sent: 0,
      zeroed: 0,
      warnings,
    });
    this.logger.log(
      `solicitação ${request.id} (${request.scope}, ciclo ${request.cycle.id}): ${employees.length} colaborador(es), ${items.length - toZero.length} lançamento(s), ${toZero.length} a zerar`,
    );
    return items;
  }

  async processItem(
    item: SyncItemInput<PayrollExportItem>,
    context?: JobRunContext,
  ): Promise<ItemResult> {
    const request = PayrollExportJob.requestOf(context);
    const runId = context!.runId;
    const currency = this.currencies.has(request.id)
      ? (this.currencies.get(request.id) ?? null)
      : await this.currencyFor(request.cnpj);
    const payload = item.payload;

    const target =
      payload.kind === 'send'
        ? {
            employeeId: payload.employee.employee_id,
            externalId: payload.employee.external_id,
            code: payload.event.code,
            type: payload.event.type,
            totalSeconds: payload.event.total_seconds,
          }
        : {
            employeeId: payload.previous.employeeId,
            externalId: payload.previous.externalId,
            code: payload.previous.eventCode,
            type: payload.previous.eventType,
            totalSeconds: 0,
          };

    const hours = PayrollExportJob.hoursOf(target.totalSeconds);
    const line: PayrollInputLine = {
      inputId: PayrollExportJob.inputId(
        request.cycle.id,
        target.employeeId,
        target.code,
      ),
      batchId: `PMV-${request.id}`,
      externalId: target.externalId,
      code: target.code,
      type: target.type,
      hours,
      startDate: request.cycle.start_date,
      endDate: request.cycle.end_date,
      currency,
      comment: `Pmovel: ciclo ${request.cycle.start_date} a ${request.cycle.end_date}, solicitação ${request.id}`,
    };

    const existing = await this.sent.findOne(
      request.cycle.id,
      target.employeeId,
      target.code,
    );
    const { wid } = await this.writer.upsert(line);
    await this.sent.upsert({
      cycleId: request.cycle.id,
      cnpj: PayrollExportJob.cnpjKey(request.cnpj),
      scope: request.scope,
      employeeId: target.employeeId,
      externalId: target.externalId,
      eventCode: target.code,
      eventType: target.type,
      totalSeconds: target.totalSeconds,
      hours,
      destination: this.writer.destination,
      workdayInputId: line.inputId,
      workdayWid: wid,
      exportId: request.id,
      runId,
    });

    const report = this.reports.get(request.id);
    if (payload.kind === 'zero') {
      if (report) report.zeroed++;
      return {
        operation: SyncOperation.UPDATE,
        summary: `zerado (verba ${target.code} não veio neste envio)`,
      };
    }
    if (report) report.sent++;
    return {
      operation: existing ? SyncOperation.UPDATE : SyncOperation.CREATE,
      summary: `${hours} h na verba ${target.code}`,
    };
  }

  /** Lê todas as páginas de totais da solicitação. */
  private async readAllTotals(
    requestId: number,
  ): Promise<PayrollExportTotalsEmployee[]> {
    const employees: PayrollExportTotalsEmployee[] = [];
    for (let page = 1; ; page++) {
      const res = await this.pmovel.getPayrollExportTotals(
        requestId,
        page,
        TOTALS_PAGE_SIZE,
      );
      employees.push(...res.employees);
      const total = res.total_employees ?? employees.length;
      if (res.employees.length < TOTALS_PAGE_SIZE || employees.length >= total)
        return employees;
    }
  }

  /** Moeda da empresa (de/para de CNPJ). */
  private async currencyFor(cnpj: string): Promise<string | null> {
    const mapping = await this.cnpjMappings.findActiveByCnpj(
      PayrollExportJob.cnpjKey(cnpj),
    );
    return mapping?.currency ?? null;
  }

  private static requestOf(context?: JobRunContext): PayrollExport {
    const request = (context?.params as PayrollExportParams | undefined)
      ?.request;
    if (!request) {
      throw new Error(
        'payroll-events/export precisa de uma solicitação de envio do Pmovel',
      );
    }
    return request;
  }

  /** `Payroll_Input_ID` estável por ciclo, colaborador e verba. */
  static inputId(cycleId: number, employeeId: number, code: string): string {
    return `PMV-${cycleId}-${employeeId}-${code}`;
  }

  /** Segundos → horas decimais com 2 casas (mesmo arredondamento do Pmovel). */
  static hoursOf(totalSeconds: number): string {
    return (Math.round(((totalSeconds || 0) / 3600) * 100) / 100).toFixed(2);
  }

  static cnpjKey(cnpj: string): string {
    return String(cnpj ?? '')
      .replace(/[^A-Za-z0-9]/g, '')
      .toUpperCase();
  }

  private static rowKey(employeeId: number, code: string): string {
    return `${employeeId}|${code}`;
  }
}
