import { WorkdayClient } from '../../../workday/workday.client';
import {
  el,
  findIdByType,
  ref,
  WORKDAY_SOAP_VERSION,
} from '../../../workday/soap/workday-soap';
import { PayrollInputLine, PayrollInputWriter } from './payroll-input-writer';

/**
 * Destino `external_payroll_input`: folha de **terceiro** (Payroll Interface).
 * SOAP `Put_External_Payroll_Input` (serviço `Payroll_Interface`). Validado no
 * tenant de dev: o mesmo `Payroll_Input_ID` atualiza o lançamento; a moeda é
 * obrigatória, mesmo para horas.
 *
 * Os elementos seguem a ordem do XSD (o Workday valida a sequência).
 */
export class ExternalPayrollInputWriter implements PayrollInputWriter {
  readonly destination = 'external_payroll_input';

  constructor(private readonly workday: WorkdayClient) {}

  static buildRequest(line: PayrollInputLine): string {
    if (!line.currency) {
      throw new Error(
        'moeda obrigatória no Payroll Interface: configure currency em cnpj_mapping',
      );
    }
    const codeType = line.type === 'D' ? 'Deduction_Code' : 'Earning_Code';
    return (
      `<wd:Put_External_Payroll_Input_Request wd:version="${WORKDAY_SOAP_VERSION}"><wd:External_Payroll_Input_Data>` +
      el('Payroll_Input_ID', line.inputId) +
      ref('Payee_Reference', 'Employee_ID', line.externalId) +
      ref('Pay_Component_Workday_Reference', codeType, line.code) +
      el('Batch_ID', line.batchId) +
      el('Start_Date', line.startDate) +
      el('End_Date', line.endDate) +
      el('Unit', line.hours) +
      el('Comment', line.comment) +
      ref('Currency_Reference', 'Currency_ID', line.currency) +
      `</wd:External_Payroll_Input_Data></wd:Put_External_Payroll_Input_Request>`
    );
  }

  async upsert(line: PayrollInputLine): Promise<{ wid: string | null }> {
    const body = await this.workday.callSoap(
      'Payroll_Interface',
      'Put_External_Payroll_Input',
      ExternalPayrollInputWriter.buildRequest(line),
    );
    return { wid: findIdByType(body, 'WID') };
  }
}
