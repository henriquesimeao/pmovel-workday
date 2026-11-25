import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableColumn,
  TableIndex,
} from 'typeorm';

/**
 * Fase 2 (envio de verbas): moeda por empresa em `cnpj_mapping` e o registro de
 * envio `payroll_input_sent`. Dialeto MySQL, gerada à mão a partir das
 * entidades.
 */
export class PayrollExport1732600000000 implements MigrationInterface {
  name = 'PayrollExport1732600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'cnpj_mapping',
      new TableColumn({
        name: 'currency',
        type: 'varchar',
        length: '3',
        isNullable: true,
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'payroll_input_sent',
        columns: [
          {
            name: 'id',
            type: 'int',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          { name: 'cycleId', type: 'int' },
          { name: 'cnpj', type: 'varchar', length: '32' },
          { name: 'scope', type: 'varchar', length: '16' },
          { name: 'employeeId', type: 'int' },
          { name: 'externalId', type: 'varchar', length: '128' },
          { name: 'eventCode', type: 'varchar', length: '64' },
          { name: 'eventType', type: 'varchar', length: '1' },
          { name: 'totalSeconds', type: 'int' },
          { name: 'hours', type: 'decimal', precision: 12, scale: 2 },
          { name: 'destination', type: 'varchar', length: '32' },
          { name: 'workdayInputId', type: 'varchar', length: '128' },
          {
            name: 'workdayWid',
            type: 'varchar',
            length: '64',
            isNullable: true,
          },
          { name: 'exportId', type: 'int' },
          { name: 'runId', type: 'int' },
          {
            name: 'createdAt',
            type: 'datetime',
            precision: 6,
            default: 'CURRENT_TIMESTAMP(6)',
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
    await queryRunner.createIndex(
      'payroll_input_sent',
      new TableIndex({
        columnNames: ['cycleId', 'employeeId', 'eventCode'],
        isUnique: true,
      }),
    );
    await queryRunner.createIndex(
      'payroll_input_sent',
      new TableIndex({ columnNames: ['cycleId', 'scope'] }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('payroll_input_sent', true);
    await queryRunner.dropColumn('cnpj_mapping', 'currency');
  }
}
