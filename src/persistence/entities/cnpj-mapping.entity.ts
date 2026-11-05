import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * De/para manual entre a **legal entity/company** do Workday e o **CNPJ** do
 * Pmovel. Populado pela operação (não automático): cada empresa do Workday é
 * associada ao CNPJ correspondente no Pmovel.
 *
 * `legalEntityId` guarda o identificador estável da legal entity no Workday
 * (ex.: Organization_Reference_ID) quando disponível; `legalEntityName` é o
 * descritor legível, usado como fallback/visualização.
 */
@Entity('cnpj_mapping')
@Index(['legalEntityId'])
export class CnpjMapping {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 128, nullable: true })
  legalEntityId!: string | null;

  @Column({ length: 255 })
  legalEntityName!: string;

  /** CNPJ no Pmovel (somente números, ou alfanumérico para outros países). */
  @Column({ length: 32 })
  cnpj!: string;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
