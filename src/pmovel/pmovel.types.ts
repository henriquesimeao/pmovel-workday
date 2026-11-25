/**
 * DTOs da API Pmovel v3, tipados a partir do OpenAPI (v3.0.59).
 * Apenas os recursos usados na Fase 1 (Auth + Employees). Demais recursos
 * (vacations, absences, reports) entram nas Fases 2-4.
 */

/** POST /v3/auth/login — corpo. */
export interface LoginDto {
  access_key_id: string;
  secret_access_key: string;
}

/** POST /v3/auth/login — resposta 200. */
export interface LoginOkResponseDto {
  access_token: string;
}

/**
 * POST /v3/employees — corpo.
 * Campos obrigatórios (OpenAPI `required`): cnpj, matricula, name, cpf, email,
 * employeegroup_code, syndicate_code, workday_code, dt_admissao, country,
 * is_manager, external_id.
 */
export interface CreateEmployeeDto {
  cnpj: string;
  matricula: string;
  name: string;
  social_name?: string;
  preferred_name?: string;
  cpf: string;
  rg?: string;
  pis?: string;
  email: string;
  employeegroup_code: string;
  employeegroup_name?: string;
  syndicate_code: string;
  syndicate_name?: string;
  workday_code: string;
  workday_name?: string;
  costcenter_code?: string;
  costcenter_name?: string;
  gmt?: number;
  dt_nascimento?: string | null;
  dt_admissao: string | null;
  dt_demissao?: string | null;
  country: string;
  job_position?: string | null;
  job_level?: string | null;
  job_family?: string | null;
  job_family_sub?: string | null;
  job_family_description?: string | null;
  manager_external_id?: string | null;
  is_manager: boolean;
  is_hr_manager?: boolean;
  home_office?: boolean;
  join_history?: boolean;
  external_id: string;
}

/** PUT /v3/employees/external_id/{external_id} — corpo (todos opcionais). */
export type UpdateEmployeeDto = Partial<
  Omit<CreateEmployeeDto, 'cnpj' | 'external_id'>
> & {
  workday_start_date?: string | null;
};

/** POST /v3/employees/inactivate/external_id/{external_id} — corpo. */
export interface FireEmployeeId {
  dt_demissao?: string | null;
}

/** POST /v3/employees/reactivate/external_id/{external_id} — corpo. */
export interface RehireEmployeeId {
  clean_dt_demissao?: boolean;
}

/** Resposta de employee (GET/POST). Campos de código vêm como objeto na API. */
export interface EmployeeResponse {
  id: number;
  external_id: string;
  cnpj: string;
  matricula: string;
  name: string;
  email: string;
  country: string;
  dt_admissao: string;
  dt_demissao: string;
  is_manager: boolean;
  active: boolean;
  [key: string]: unknown;
}

/** Erro padrão dos recursos de Employees. */
export interface EmployeesErrorResponseDto {
  status_code: number;
  error: string;
  message: string[];
}

export interface ListEmployeesParams {
  limit?: number;
  page?: number;
  include_inactive?: boolean;
}

// --- Fase 2: solicitações de envio de verbas (payroll_exports) ---
// Contrato em docs/fase-2-api-pmovel.md (rotas novas, a construir no Pmovel).

export type PayrollExportStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'completed_with_errors'
  | 'failed'
  | 'canceled';

export type PayrollExportScope = 'global' | 'individual';

/** Ciclo do Pmovel, como vem nas rotas de `payroll_exports`. */
export interface PayrollExportCycle {
  id: number;
  year?: string;
  month?: string;
  start_date: string;
  end_date: string;
  closed: boolean;
  closed_at?: string | null;
}

/** Uma solicitação de envio (`GET /v3/payroll_exports/{id}`). */
export interface PayrollExport {
  id: number;
  cnpj: string;
  cycle: PayrollExportCycle;
  scope: PayrollExportScope;
  /** Só no `individual`. */
  external_id: string | null;
  target: string;
  status: PayrollExportStatus;
  requested_at?: string;
}

/** Total de uma verba de um colaborador no ciclo. */
export interface PayrollExportTotalsEvent {
  /** `ehevents.e_code`, igual ao código da verba no Workday. */
  code: string;
  name: string;
  /** `P` provento (earning), `D` desconto (deduction). */
  type: 'P' | 'D';
  total_seconds: number;
  hours_decimal: number;
  hours: string;
}

export interface PayrollExportTotalsEmployee {
  /** Id interno do Pmovel (`users.id`). */
  employee_id: number;
  external_id: string;
  matricula: string;
  name: string;
  active: boolean;
  dt_demissao: string | null;
  events: PayrollExportTotalsEvent[];
}

/** Uma página de `GET /v3/payroll_exports/{id}/totals`. */
export interface PayrollExportTotalsPage {
  export_id: number;
  scope: PayrollExportScope;
  cnpj: string;
  cycle: PayrollExportCycle;
  page: number;
  limit: number;
  total_employees: number;
  employees: PayrollExportTotalsEmployee[];
}

/** Corpo de `POST /v3/payroll_exports/{id}/finish`. */
export interface PayrollExportFinishDto {
  status: 'completed' | 'completed_with_errors' | 'failed';
  summary: {
    employees: number;
    inputs_sent: number;
    inputs_zeroed: number;
    failures: number;
    warnings: string[];
  } | null;
  errors: Array<{
    external_id: string | null;
    code: string | null;
    message: string;
  }>;
  error_message: string | null;
}
