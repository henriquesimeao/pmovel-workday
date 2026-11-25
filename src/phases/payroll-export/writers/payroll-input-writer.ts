/**
 * Um lançamento de verba no Workday (colaborador × verba × ciclo), já pronto
 * para gravar, independente do destino.
 */
export interface PayrollInputLine {
  /** `Payroll_Input_ID`: definido pelo integrador; o mesmo id atualiza. */
  inputId: string;
  /** Lote do envio (um por solicitação). */
  batchId: string;
  /** `employeeID` do Workday (= `external_id` do Pmovel). */
  externalId: string;
  /** Código da verba (= `e_code` do Pmovel). */
  code: string;
  /** `P` → earning, `D` → deduction. */
  type: 'P' | 'D';
  /** Horas decimais, com 2 casas (ex.: `"1.50"`). */
  hours: string;
  /** Início e fim do ciclo (`YYYY-MM-DD`). */
  startDate: string;
  endDate: string;
  /** Moeda ISO 4217; obrigatória no Payroll Interface. */
  currency: string | null;
  comment: string;
}

/** Destino das verbas no Workday. Uma implementação por tipo de folha. */
export interface PayrollInputWriter {
  readonly destination: string;
  /** Cria ou atualiza o lançamento. Devolve o WID do Workday. */
  upsert(line: PayrollInputLine): Promise<{ wid: string | null }>;
}

/** Token de injeção do gravador escolhido por `PAYROLL_EXPORT_DESTINATION`. */
export const PAYROLL_INPUT_WRITER = Symbol('PAYROLL_INPUT_WRITER');
