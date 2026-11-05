import { Module } from '@nestjs/common';
import { PersistenceModule } from '../persistence/persistence.module';
import { FieldMappingService } from './field-mapping.service';
import { CnpjMappingService } from './cnpj-mapping.service';
import { EmployeeMapper } from './employee.mapper';
import { CnpjMappingRepository } from '../persistence/cnpj-mapping.repository';
import { DEFAULT_EMPLOYEE_MAPPING } from './mapping.config';

/**
 * Módulo de mapeamento Workday → Pmovel.
 *
 * O EmployeeMapper recebe a config de mapeamento via factory (hoje a
 * DEFAULT_EMPLOYEE_MAPPING; no futuro, carregável de arquivo/env).
 */
@Module({
  imports: [PersistenceModule],
  providers: [
    FieldMappingService,
    CnpjMappingService,
    {
      provide: EmployeeMapper,
      inject: [FieldMappingService, CnpjMappingService],
      useFactory: (fields: FieldMappingService, cnpj: CnpjMappingService) =>
        new EmployeeMapper(fields, cnpj, DEFAULT_EMPLOYEE_MAPPING),
    },
  ],
  exports: [EmployeeMapper, FieldMappingService, CnpjMappingService],
})
export class MappingModule {}

// Garante que o CnpjMappingRepository é visível para o CnpjMappingService
// (vem do PersistenceModule, importado acima).
void CnpjMappingRepository;
