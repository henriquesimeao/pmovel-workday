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
