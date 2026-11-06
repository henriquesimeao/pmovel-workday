import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableIndex,
  TableForeignKey,
} from 'typeorm';

/**
 * Schema inicial (Fase 1): sync_run, sync_item, cnpj_mapping, sync_cursor.
 * Dialeto MySQL. Gerada à mão para refletir as entidades da Task 6.
 */
export class InitialSchema1730800000000 implements MigrationInterface {
  name = 'InitialSchema1730800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'sync_run',
        columns: [
          {
            name: 'id',
            type: 'int',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          { name: 'phase', type: 'varchar', length: '64' },
          { name: 'type', type: 'varchar', length: '64' },
          {
            name: 'trigger',
            type: 'varchar',
            length: '16',
            default: "'manual'",
          },
          {
            name: 'status',
            type: 'varchar',
            length: '16',
            default: "'running'",
          },
          { name: 'startedAt', type: 'datetime', precision: 6, default: 'CURRENT_TIMESTAMP(6)' },
          { name: 'finishedAt', type: 'datetime', isNullable: true },
          { name: 'totalCount', type: 'int', default: 0 },
          { name: 'successCount', type: 'int', default: 0 },
          { name: 'failureCount', type: 'int', default: 0 },
          { name: 'skippedCount', type: 'int', default: 0 },
          { name: 'errorMessage', type: 'text', isNullable: true },
        ],
      }),
      true,
    );
    await queryRunner.createIndex(
      'sync_run',
      new TableIndex({
        columnNames: ['phase', 'type'],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'sync_item',
        columns: [
          {
            name: 'id',
            type: 'int',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          { name: 'run_id', type: 'int' },
          { name: 'externalId', type: 'varchar', length: '128' },
          { name: 'operation', type: 'varchar', length: '16' },
          { name: 'status', type: 'varchar', length: '16' },
          { name: 'errorMessage', type: 'text', isNullable: true },
          { name: 'payloadSummary', type: 'text', isNullable: true },
          {
            name: 'processedAt',
            type: 'datetime',
            precision: 6,
            default: 'CURRENT_TIMESTAMP(6)',
          },
        ],
      }),
      true,
    );
    await queryRunner.createIndex(
      'sync_item',
      new TableIndex({
        columnNames: ['externalId'],
      }),
    );
    await queryRunner.createForeignKey(
      'sync_item',
      new TableForeignKey({
        columnNames: ['run_id'],
        referencedTableName: 'sync_run',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'cnpj_mapping',
        columns: [
          {
            name: 'id',
            type: 'int',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          {
            name: 'legalEntityId',
            type: 'varchar',
            length: '128',
            isNullable: true,
          },
          { name: 'legalEntityName', type: 'varchar', length: '255' },
          { name: 'cnpj', type: 'varchar', length: '32' },
          { name: 'active', type: 'tinyint', width: 1, default: 1 },
          { name: 'createdAt', type: 'datetime', precision: 6, default: 'CURRENT_TIMESTAMP(6)' },
          {
            name: 'updatedAt',
            type: 'datetime',
            precision: 6,
            default: 'CURRENT_TIMESTAMP(6)',
            onUpdate: 'CURRENT_TIMESTAMP(6)',
          },
        ],
      }),
      true,
    );
    await queryRunner.createIndex(
      'cnpj_mapping',
      new TableIndex({
        columnNames: ['legalEntityId'],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'sync_cursor',
        columns: [
          { name: 'jobKey', type: 'varchar', length: '128', isPrimary: true },
          { name: 'lastRunAt', type: 'datetime', isNullable: true },
          {
            name: 'lastValue',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'updatedAt',
            type: 'datetime',
            precision: 6,
            default: 'CURRENT_TIMESTAMP(6)',
            onUpdate: 'CURRENT_TIMESTAMP(6)',
          },
        ],
      }),
      true,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('sync_cursor', true);
    await queryRunner.dropTable('cnpj_mapping', true);
    await queryRunner.dropTable('sync_item', true);
    await queryRunner.dropTable('sync_run', true);
  }
}
