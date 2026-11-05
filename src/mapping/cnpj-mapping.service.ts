import { Injectable } from '@nestjs/common';
import { CnpjMappingRepository } from '../persistence/cnpj-mapping.repository';
import { ConsolidatedWorker } from '../workday/consolidated-worker';

/**
 * Resolve o CNPJ do Pmovel a partir da legal entity do worker, usando o de/para
 * manual (`cnpj_mapping`). Fina camada sobre o repositório, mas isola o domínio
 * de mapeamento do de persistência e facilita o teste do EmployeeMapper.
 */
@Injectable()
export class CnpjMappingService {
  constructor(private readonly repo: CnpjMappingRepository) {}

  /** @returns o CNPJ, ou null se não houver de/para ativo para a legal entity. */
  resolveForWorker(worker: ConsolidatedWorker): Promise<string | null> {
    return this.repo.resolveCnpj(
      worker.legalEntityId ?? null,
      worker.legalEntity ?? null,
    );
  }
}
