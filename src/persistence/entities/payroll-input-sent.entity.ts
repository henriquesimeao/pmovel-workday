import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Escopo do envio que gravou o lançamento por último. */
export type PayrollExportScope = 'global' | 'individual';

/**
 * Registro de envio da Fase 2: um lançamento (colaborador × verba × ciclo) que o
 * integrador gravou no Workday.
 *
 * No Workday, cada lançamento tem o `Payroll_Input_ID` definido pelo
 * integrador; reenviar com o mesmo id atualiza o lançamento no lugar. Este
 * registro guarda o que foi enviado por último, para:
 * - saber se um reenvio cria ou atualiza;
 * - zerar no Workday a verba que deixou de vir num reenvio (não há operação de
 *   exclusão);
 * - auditar o que foi para a folha.
 *
 * Chave única: ciclo + colaborador (id interno do Pmovel) + código da verba.
 */
@Entity('payroll_input_sent')
@Index(['cycleId', 'employeeId', 'eventCode'], { unique: true })
@Index(['cycleId', 'scope'])
export class PayrollInputSent {
  @PrimaryGeneratedColumn()
  id!: number;

  /** Ciclo do Pmovel (`cycles.id`). */
  @Column({ type: 'int' })
  cycleId!: number;

  @Column({ length: 32 })
  cnpj!: string;

  /** Escopo do último envio que gravou este lançamento. */
  @Column({ type: 'varchar', length: 16 })
  scope!: PayrollExportScope;

  /** Id interno do colaborador no Pmovel (`users.id`). */
  @Column({ type: 'int' })
  employeeId!: number;

  @Column({ length: 128 })
  externalId!: string;

  /** Código da verba (`ehevents.e_code`), igual no Workday. */
  @Column({ length: 64 })
  eventCode!: string;

  /** `P` (provento, earning) ou `D` (desconto, deduction). */
  @Column({ type: 'varchar', length: 1 })
  eventType!: 'P' | 'D';

  /** Total enviado, em segundos (valor exato vindo do Pmovel). */
  @Column({ type: 'int' })
  totalSeconds!: number;

  /** Horas enviadas ao Workday (decimal, arredondado a 2 casas). */
  @Column({ type: 'decimal', precision: 12, scale: 2 })
  hours!: string;

  /** Destino usado (`payroll_input` / `external_payroll_input`). */
  @Column({ length: 32 })
  destination!: string;

  /** `Payroll_Input_ID` no Workday (definido pelo integrador). */
  @Column({ length: 128 })
  workdayInputId!: string;

  /** WID devolvido pelo Workday. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  workdayWid!: string | null;

  /** Solicitação de envio do Pmovel (`payroll_exports.id`) do último envio. */
  @Column({ type: 'int' })
  exportId!: number;

  /** Run do integrador (`sync_run.id`) do último envio. */
  @Column({ type: 'int' })
  runId!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
