import {
  Column,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Cursor de sincronização por job: marca o ponto até onde a última execução
 * processou, para que a próxima busque apenas o que mudou desde então (diffs).
 *
 * A chave é o nome do job (ex.: 'employees:full'). `lastRunAt` é o carimbo da
 * última execução bem-sucedida; `lastValue` guarda um marcador opaco adicional
 * (ex.: um token/offset da origem) quando o job precisar de algo além da data.
 */
@Entity('sync_cursor')
export class SyncCursor {
  @PrimaryColumn({ length: 128 })
  jobKey!: string;

  @Column({ type: 'datetime', nullable: true })
  lastRunAt!: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  lastValue!: string | null;

  @UpdateDateColumn()
  updatedAt!: Date;
}
