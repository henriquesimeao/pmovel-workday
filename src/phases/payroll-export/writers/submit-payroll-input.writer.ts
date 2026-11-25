import { WorkdayClient } from '../../../workday/workday.client';
import {
  el,
  findIdByType,
  ref,
  WORKDAY_SOAP_VERSION,
} from '../../../workday/soap/workday-soap';
import { PayrollInputLine, PayrollInputWriter } from './payroll-input-writer';

/**
 * Destino `payroll_input`: folha processada no **Workday Payroll**.
 * SOAP `Submit_Payroll_Input` (serviço `Payroll`). Validado no tenant de dev:
 * o mesmo `Payroll_Input_ID` atualiza o lançamento; moeda é opcional.
 *
 * Os elementos seguem a ordem do XSD (o Workday valida a sequência).
 */
export class SubmitPayrollInputWriter implements PayrollInputWriter {
  readonly destination = 'payroll_input';

  constructor(private readonly workday: WorkdayClient) {}

  static buildRequest(line: PayrollInputLine): string {
    const component =
      line.type === 'D'
        ? ref('Deduction_Reference', 'Deduction_Code', line.code)
        : ref('Earning_Reference', 'Earning_Code', line.code);
    return (
      `<wd:Submit_Payroll_Input_Request wd:version="${WORKDAY_SOAP_VERSION}"><wd:Payroll_Input_Data>` +
      el('Payroll_Input_ID', line.inputId) +
      el('Batch_ID', line.batchId) +
      el('Start_Date', line.startDate) +
      el('End_Date', line.endDate) +
      ref('Worker_Reference', 'Employee_ID', line.externalId) +
      component +
      el('Hours', line.hours) +
      el('Comment', line.comment) +
      (line.currency
        ? ref('Currency_Reference', 'Currency_ID', line.currency)
        : '') +
      `</wd:Payroll_Input_Data></wd:Submit_Payroll_Input_Request>`
    );
  }

  async upsert(line: PayrollInputLine): Promise<{ wid: string | null }> {
    const body = await this.workday.callSoap(
      'Payroll',
      'Submit_Payroll_Input',
      SubmitPayrollInputWriter.buildRequest(line),
    );
    return { wid: findIdByType(body, 'WID') };
  }
}
