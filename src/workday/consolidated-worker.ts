/**
 * "Worker consolidado": forma normalizada que o mapeador (Task 7) e o job
 * (Task 9) consomem, reunindo num único objeto os campos relevantes que hoje
 * vêm de common/v1 e staffing/v6, mais os campos que dependem de WQL/SOAP
 * (hireDate, terminationDate, active, legalEntity, cpf) — estes opcionais até a
 * decisão registrada em docs/de-para-workday-pmovel.md.
 *
 * O WorkdayClient é quem monta esse objeto a partir dos endpoints; o mapeador
 * não conhece a estrutura crua do Workday, só esta forma estável.
 */
export interface ConsolidatedWorker {
  /** WID técnico do worker. */
  id: string;
  /** Nome de exibição (worker.descriptor). */
  descriptor: string;
  /** workerId legível (ex.: matrícula). */
  workerId: string;
  /** E-mail de trabalho (person.email). */
  email?: string;
  /** Data de nascimento (PII). */
  dateOfBirth?: string;
  isManager?: boolean;
  /** Cargo (primaryJob.descriptor), possivelmente com sufixo do nome. */
  jobTitle?: string;
  /** País ISO 3166-1 alpha-2 (ex.: BR). */
  countryAlpha2?: string;
  /** País ISO 3166-1 alpha-3 (ex.: BRA). */
  countryAlpha3?: string;
  supervisoryOrganization?: string;

  // --- Campos que dependem de WQL/SOAP (gaps — ver de/para) ---
  hireDate?: string | null;
  terminationDate?: string | null;
  active?: boolean;
  /** Legal entity/company do Workday (para resolver o CNPJ). */
  legalEntity?: string | null;
  legalEntityId?: string | null;
  /** National ID / CPF (PII). */
  cpf?: string | null;
}
