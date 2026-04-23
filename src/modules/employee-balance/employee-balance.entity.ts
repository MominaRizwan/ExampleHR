import { IsDate, IsNumber, IsString, Length, Min } from 'class-validator';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { fixedPointDaysTransformer } from '../../common/transformers/fixed-point-days.transformer';

@Index('IDX_EMPLOYEE_BALANCE_EMPLOYEE_ID', ['employeeId'])
@Index('IDX_EMPLOYEE_BALANCE_LOCATION_ID', ['locationId'])
@Index('UQ_EMPLOYEE_BALANCE_EMPLOYEE_LOCATION', ['employeeId', 'locationId'], { unique: true })
@Entity({ name: 'employee_balances' })
export class EmployeeBalance {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @IsString()
  @Length(1, 64)
  @Column({ type: 'varchar', length: 64 })
  employeeId: string;

  @IsString()
  @Length(1, 64)
  @Column({ type: 'varchar', length: 64 })
  locationId: string;

  @IsNumber()
  @Min(0)
  @Column({ type: 'integer', default: 0, transformer: fixedPointDaysTransformer })
  balance: number;

  @IsDate()
  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  lastSyncedAt: Date;
}
