import { ConsolidatedWorker } from '../workday/consolidated-worker';

/**
 * Modos de mapeamento de um campo do Pmovel a partir do worker consolidado:
 *
 * - `direct`: lê um atributo do worker (`source`), opcionalmente transformado.
 * - `lookup`: resolve via tabela de-para (ex.: CNPJ por legal entity). O
 *   mapeador delega ao serviço específico; aqui só se marca o tipo.
 * - `default`: valor fixo configurável (para gaps sem origem no Workday).
 */
export type FieldMappingRule =
  | {
      mode: 'direct';
      source: keyof ConsolidatedWorker;
      transform?: TransformName;
    }
  | { mode: 'default'; value: string | number | boolean | null }
  | { mode: 'lookup'; lookup: 'cnpj' };

/** Transformações nomeadas aplicáveis em regras `direct`. */
export type TransformName = 'trimJobTitle' | 'alpha3ToAlpha2';

/**
 * Configuração de mapeamento por campo do Pmovel. Parte do de/para aprovado na
 * Task 4: campos 🟢/🟡 como `direct`, gaps como `default` (configurável) ou
 * `lookup` (CNPJ). Esta é a config inicial; pode ser externalizada para um
 * arquivo/env quando a operação precisar ajustar sem recompilar.
 */
export interface EmployeeMappingConfig {
  /** Qual atributo do worker vira a chave external_id. */
  externalIdSource: keyof ConsolidatedWorker;
  /** Qual atributo vira a matrícula. */
  matriculaSource: keyof ConsolidatedWorker;
  /** Regras por campo do CreateEmployeeDto. */
  fields: {
    name: FieldMappingRule;
    email: FieldMappingRule;
    cpf: FieldMappingRule;
    cnpj: FieldMappingRule;
    employeegroup_code: FieldMappingRule;
    syndicate_code: FieldMappingRule;
    workday_code: FieldMappingRule;
    country: FieldMappingRule;
    is_manager: FieldMappingRule;
    job_position?: FieldMappingRule;
    dt_nascimento?: FieldMappingRule;
    dt_admissao?: FieldMappingRule;
  };
  /**
   * Campos definidos na **admissão**, mas **nunca enviados na atualização** —
   * o integrador não deve sobrescrever valores que podem ter sido ajustados
   * manualmente no Pmovel (ex.: grupo, sindicato, jornada).
   */
  immutableOnUpdate: Array<keyof CreateEmployeeDtoWritable>;
}

/** Campos do CreateEmployeeDto que podem aparecer no update (para tipar immutableOnUpdate). */
type CreateEmployeeDtoWritable = {
  employeegroup_code: string;
  syndicate_code: string;
  workday_code: string;
  name: string;
  email: string;
  cpf: string;
  country: string;
  is_manager: boolean;
  job_position: string | null;
  dt_nascimento: string | null;
  dt_admissao: string | null;
  matricula: string;
};

/**
 * Config DEFAULT inicial, coerente com docs/de-para-workday-pmovel.md.
 *
 * - external_id/matricula = `workerId` (decisão sugerida).
 * - Campos confirmados = `direct`.
 * - Gaps obrigatórios (employeegroup_code, syndicate_code, workday_code) =
 *   `default` com placeholders explícitos, até a decisão do usuário.
 * - cnpj = `lookup` (resolvido via cnpj_mapping).
 */
export const DEFAULT_EMPLOYEE_MAPPING: EmployeeMappingConfig = {
  externalIdSource: 'workerId',
  matriculaSource: 'workerId',
  fields: {
    name: { mode: 'direct', source: 'descriptor' },
    email: { mode: 'direct', source: 'email' },
    // CPF vem do WQL (nationalIdentifiers). Pode estar vazio em tenants não-BR;
    // nesse caso a validação registra o item como falha, sem abortar o lote.
    cpf: { mode: 'direct', source: 'cpf' },
    cnpj: { mode: 'lookup', lookup: 'cnpj' },
    // Gaps obrigatórios sem origem no Workday — defaults placeholder; o usuário
    // decide o valor real ou um de-para por dimensão (ver de/para).
    employeegroup_code: { mode: 'default', value: 'DEFAULT' },
    syndicate_code: { mode: 'default', value: 'DEFAULT' },
    workday_code: { mode: 'default', value: 'DEFAULT' },
    // country não vem na query WQL atual; default BR (tenant brasileiro).
    country: { mode: 'default', value: 'BR' },
    is_manager: { mode: 'direct', source: 'isManager' },
    // jobCode é um código (ex.: "Analista_Sistemas"); mantido como cargo.
    job_position: { mode: 'direct', source: 'jobTitle' },
    dt_nascimento: { mode: 'direct', source: 'dateOfBirth' },
    dt_admissao: { mode: 'direct', source: 'hireDate' },
  },
  // Definidos só na admissão; nunca sobrescritos na atualização (podem ter sido
  // ajustados manualmente no Pmovel).
  immutableOnUpdate: ['employeegroup_code', 'syndicate_code', 'workday_code'],
};
