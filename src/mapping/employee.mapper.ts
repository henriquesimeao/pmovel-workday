import { Injectable } from '@nestjs/common';
import { ConsolidatedWorker } from '../workday/consolidated-worker';
import { CreateEmployeeDto, UpdateEmployeeDto } from '../pmovel/pmovel.types';
import { FieldMappingService } from './field-mapping.service';
import { CnpjMappingService } from './cnpj-mapping.service';
import {
  DEFAULT_EMPLOYEE_MAPPING,
  EmployeeMappingConfig,
} from './mapping.config';

/** Erro de mapeamento de um worker (ex.: campo obrigatório ausente). */
export class MappingError extends Error {
  constructor(
    message: string,
    readonly externalId: string,
    readonly missingFields: string[],
  ) {
    super(message);
    this.name = 'MappingError';
  }
}

/** Campos obrigatórios do CreateEmployeeDto (OpenAPI `required`). */
const REQUIRED_CREATE_FIELDS: Array<keyof CreateEmployeeDto> = [
  'cnpj',
  'matricula',
  'name',
  'cpf',
  'email',
  'employeegroup_code',
  'syndicate_code',
  'workday_code',
  'dt_admissao',
  'country',
  'is_manager',
  'external_id',
];

/**
 * Converte um worker consolidado do Workday em DTOs do Pmovel.
 *
 * - Usa o FieldMappingService (direct/default) e o CnpjMappingService (lookup).
 * - Valida os campos obrigatórios do CreateEmployeeDto e lança `MappingError`
 *   com a lista de ausentes — o job (Task 9) transforma isso em falha de item,
 *   sem abortar o lote.
 * - `is_manager` é normalizado para booleano (default false).
 */
@Injectable()
export class EmployeeMapper {
  constructor(
    private readonly fields: FieldMappingService,
    private readonly cnpj: CnpjMappingService,
    private readonly config: EmployeeMappingConfig = DEFAULT_EMPLOYEE_MAPPING,
  ) {}

  /** Monta e valida o CreateEmployeeDto. Lança MappingError se faltar obrigatório. */
  async toCreateDto(worker: ConsolidatedWorker): Promise<CreateEmployeeDto> {
    const externalId = this.stringOrEmpty(worker[this.config.externalIdSource]);
    const matricula = this.stringOrEmpty(worker[this.config.matriculaSource]);

    const cnpj = await this.resolveCnpj(worker);

    const dto: CreateEmployeeDto = {
      external_id: externalId,
      matricula,
      cnpj: cnpj ?? '',
      name: this.stringOrEmpty(
        this.fields.resolve(worker, this.config.fields.name),
      ),
      email: this.stringOrEmpty(
        this.fields.resolve(worker, this.config.fields.email),
      ),
      cpf: this.stringOrEmpty(
        this.fields.resolve(worker, this.config.fields.cpf),
      ),
      employeegroup_code: this.stringOrEmpty(
        this.fields.resolve(worker, this.config.fields.employeegroup_code),
      ),
      syndicate_code: this.stringOrEmpty(
        this.fields.resolve(worker, this.config.fields.syndicate_code),
      ),
      workday_code: this.stringOrEmpty(
        this.fields.resolve(worker, this.config.fields.workday_code),
      ),
      country: this.stringOrEmpty(
        this.fields.resolve(worker, this.config.fields.country),
      ),
      is_manager: Boolean(
        this.fields.resolve(worker, this.config.fields.is_manager),
      ),
      dt_admissao: this.optionalString(
        this.config.fields.dt_admissao
          ? this.fields.resolve(worker, this.config.fields.dt_admissao)
          : worker.hireDate,
      ),
      dt_nascimento: this.optionalString(
        this.config.fields.dt_nascimento
          ? this.fields.resolve(worker, this.config.fields.dt_nascimento)
          : worker.dateOfBirth,
      ),
      job_position: this.config.fields.job_position
        ? this.optionalString(
            this.fields.resolve(worker, this.config.fields.job_position),
          )
        : undefined,
    };

    this.validateRequired(dto, externalId);
    return dto;
  }

  /**
   * Monta o UpdateEmployeeDto (subconjunto sem cnpj/external_id). Não valida
   * obrigatórios: na atualização, só enviamos o que foi mapeado.
   */
  async toUpdateDto(worker: ConsolidatedWorker): Promise<UpdateEmployeeDto> {
    const create = await this.toCreateDtoSafe(worker);
    // Remove os campos que a atualização não aceita.
    const { cnpj: _cnpj, external_id: _ext, ...rest } = create;
    void _cnpj;
    void _ext;
    return rest;
  }

  /** Versão que não valida obrigatórios (para montar o update parcial). */
  private async toCreateDtoSafe(
    worker: ConsolidatedWorker,
  ): Promise<CreateEmployeeDto> {
    try {
      return await this.toCreateDto(worker);
    } catch (e) {
      if (e instanceof MappingError) {
        // devolve o parcial mesmo com faltas (update tolera)
        return this.buildPartial(worker);
      }
      throw e;
    }
  }

  private async buildPartial(
    worker: ConsolidatedWorker,
  ): Promise<CreateEmployeeDto> {
    const cnpj = await this.resolveCnpj(worker);
    return {
      external_id: this.stringOrEmpty(worker[this.config.externalIdSource]),
      matricula: this.stringOrEmpty(worker[this.config.matriculaSource]),
      cnpj: cnpj ?? '',
      name: this.stringOrEmpty(
        this.fields.resolve(worker, this.config.fields.name),
      ),
      email: this.stringOrEmpty(
        this.fields.resolve(worker, this.config.fields.email),
      ),
      cpf: this.stringOrEmpty(
        this.fields.resolve(worker, this.config.fields.cpf),
      ),
      employeegroup_code: this.stringOrEmpty(
        this.fields.resolve(worker, this.config.fields.employeegroup_code),
      ),
      syndicate_code: this.stringOrEmpty(
        this.fields.resolve(worker, this.config.fields.syndicate_code),
      ),
      workday_code: this.stringOrEmpty(
        this.fields.resolve(worker, this.config.fields.workday_code),
      ),
      country: this.stringOrEmpty(
        this.fields.resolve(worker, this.config.fields.country),
      ),
      is_manager: Boolean(
        this.fields.resolve(worker, this.config.fields.is_manager),
      ),
      dt_admissao: this.optionalString(worker.hireDate),
    };
  }

  private resolveCnpj(worker: ConsolidatedWorker): Promise<string | null> {
    if (this.config.fields.cnpj.mode === 'lookup') {
      return this.cnpj.resolveForWorker(worker);
    }
    // cnpj como default/direct
    return Promise.resolve(
      this.optionalString(
        this.fields.resolve(worker, this.config.fields.cnpj),
      ) ?? null,
    );
  }

  private validateRequired(dto: CreateEmployeeDto, externalId: string): void {
    const missing: string[] = [];
    for (const field of REQUIRED_CREATE_FIELDS) {
      const value = dto[field];
      // is_manager é booleano: false é válido. Os demais não podem ser vazio.
      if (field === 'is_manager') continue;
      if (value === undefined || value === null || value === '') {
        missing.push(field);
      }
    }
    if (missing.length) {
      throw new MappingError(
        `Worker ${externalId}: campos obrigatórios ausentes: ${missing.join(', ')}`,
        externalId,
        missing,
      );
    }
  }

  private stringOrEmpty(value: unknown): string {
    if (value === undefined || value === null) return '';
    return String(value);
  }

  private optionalString(value: unknown): string | null {
    if (value === undefined || value === null || value === '') return null;
    return String(value);
  }
}
