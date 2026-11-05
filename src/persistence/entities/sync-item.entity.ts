import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { SyncRun } from './sync-run.entity';

/** Resultado do processamento de um item dentro de uma run. */
export enum SyncItemStatus {
  SUCCESS = 'success',
  FAILURE = 'failure',
  SKIPPED = 'skipped',
}

/** Operação aplicada a um item (destino). */
export enum SyncOperation {
  CREATE = 'create',
  UPDATE = 'update',
  INACTIVATE = 'inactivate',
  REACTIVATE = 'reactivate',
  NONE = 'none',
}

/**
 * Um registro processado dentro de uma run. Guarda o resultado por item, com a
 * mensagem de erro quando falha — base da política "continua o lote e registra
 * as falhas". O `payloadSummary` guarda um resumo (não o payload inteiro) para
 * auditoria, evitando persistir PII em excesso.
 */
@Entity('sync_item')
@Index(['externalId'])
export class SyncItem {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => SyncRun, (run) => run.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'run_id' })
  run!: SyncRun;

  @Column({ name: 'run_id' })
  runId!: number;

  /** Chave de correlação no destino (external_id do Pmovel). */
  @Column({ length: 128 })
  externalId!: string;

  @Column({ type: 'varchar', length: 16 })
  operation!: SyncOperation;

  @Column({ type: 'varchar', length: 16 })
  status!: SyncItemStatus;

  @Column({ type: 'text', nullable: true })
  errorMessage!: string | null;

  /** Resumo do que foi enviado/decidido (sem PII sensível em texto livre). */
  @Column({ type: 'text', nullable: true })
  payloadSummary!: string | null;

  @CreateDateColumn()
  processedAt!: Date;
}
