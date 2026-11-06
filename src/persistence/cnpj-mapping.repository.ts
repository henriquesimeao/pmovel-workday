import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CnpjMapping } from './entities/cnpj-mapping.entity';

/**
 * Acesso ao de/para CNPJ ↔ legal entity (Workday). Resolve o CNPJ do Pmovel a
 * partir da legal entity do worker. Usado pelo CnpjMappingService (Task 7).
 */
@Injectable()
export class CnpjMappingRepository {
  constructor(
    @InjectRepository(CnpjMapping)
    private readonly mappings: Repository<CnpjMapping>,
  ) {}

  /** Cria/atualiza um de/para. */
  upsert(input: {
    legalEntityId?: string | null;
    legalEntityName: string;
    cnpj: string;
    active?: boolean;
  }): Promise<CnpjMapping> {
    return this.mappings.save(
      this.mappings.create({
        legalEntityId: input.legalEntityId ?? null,
        legalEntityName: input.legalEntityName,
        cnpj: input.cnpj,
        active: input.active ?? true,
      }),
    );
  }

  /**
   * Resolve o CNPJ ativo por id da legal entity (preferido) ou, na ausência,
   * pelo nome. Retorna null se não houver de/para ativo.
   */
  async resolveCnpj(
    legalEntityId?: string | null,
    legalEntityName?: string | null,
  ): Promise<string | null> {
    if (legalEntityId) {
      const byId = await this.mappings.findOne({
        where: { legalEntityId, active: true },
      });
      if (byId) return byId.cnpj;
    }
    if (legalEntityName) {
      const byName = await this.mappings.findOne({
        where: { legalEntityName, active: true },
      });
      if (byName) return byName.cnpj;
    }
    return null;
  }

  findAll(): Promise<CnpjMapping[]> {
    return this.mappings.find();
  }
}
