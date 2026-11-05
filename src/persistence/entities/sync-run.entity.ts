import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { SyncItem } from './sync-item.entity';

/** Status de uma execução de sincronização. */
export enum SyncRunStatus {
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

/**
 * Uma execução de sincronização (um lote), de uma fase/tipo específicos.
 * Guarda contadores agregados e o vínculo com os itens processados.
 */
@Entity('sync_run')
@Index(['phase', 'type'])
export class SyncRun {
  @PrimaryGeneratedColumn()
  id!: number;

  /** Fase da integração (ex.: 'employees'). */
  @Column({ length: 64 })
  phase!: string;

  /** Tipo/operação dentro da fase (ex.: 'full', 'admission', 'termination'). */
  @Column({ length: 64 })
  type!: string;

  /** Como foi disparada: 'manual' (HTTP) ou 'scheduled' (cron). */
  @Column({ length: 16, default: 'manual' })
  trigger!: string;

  @Column({ type: 'varchar', length: 16, default: SyncRunStatus.RUNNING })
  status!: SyncRunStatus;

  @CreateDateColumn()
  startedAt!: Date;

  @Column({ type: 'datetime', nullable: true })
  finishedAt!: Date | null;

  @Column({ type: 'int', default: 0 })
  totalCount!: number;

  @Column({ type: 'int', default: 0 })
  successCount!: number;

  @Column({ type: 'int', default: 0 })
  failureCount!: number;

  @Column({ type: 'int', default: 0 })
  skippedCount!: number;

  /** Mensagem de erro, quando a run inteira falha (ex.: origem indisponível). */
  @Column({ type: 'text', nullable: true })
  errorMessage!: string | null;

  @OneToMany(() => SyncItem, (item) => item.run)
  items!: SyncItem[];
}
