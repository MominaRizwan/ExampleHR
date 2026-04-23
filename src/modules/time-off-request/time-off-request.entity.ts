import { IsDate, IsEnum, IsNumber, IsOptional, IsString, Length, Min } from 'class-validator';
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { fixedPointDaysTransformer } from '../../common/transformers/fixed-point-days.transformer';

export enum TimeOffRequestStatus {
  PENDING = 'pending',
  APPROVAL_IN_PROGRESS = 'approval_in_progress',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

@Index('IDX_TIME_OFF_REQUEST_EMPLOYEE_ID', ['employeeId'])
@Index('IDX_TIME_OFF_REQUEST_LOCATION_ID', ['locationId'])
@Index('IDX_TIME_OFF_REQUEST_STATUS', ['status'])
@Index('IDX_TIME_OFF_REQUEST_EMPLOYEE_LOCATION_CREATED_AT', ['employeeId', 'locationId', 'createdAt'])
@Index('UQ_TIME_OFF_REQUEST_IDEMPOTENCY_KEY', ['idempotencyKey'], { unique: true })
@Index('IDX_TIME_OFF_REQUEST_APPROVAL_OPERATION_ID', ['approvalOperationId'])
@Index('UQ_TIME_OFF_REQUEST_PENDING_KEY', ['pendingRequestKey'], { unique: true })
@Entity({ name: 'time_off_requests' })
export class TimeOffRequest {
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
  @Min(0.5)
  @Column({ type: 'integer', transformer: fixedPointDaysTransformer })
  daysRequested: number;

  @IsOptional()
  @IsString()
  @Length(8, 128)
  @Column({ type: 'varchar', length: 128, nullable: true })
  idempotencyKey: string | null;

  @IsOptional()
  @IsString()
  @Length(8, 128)
  @Column({ type: 'varchar', length: 128, nullable: true })
  approvalOperationId: string | null;

  @IsOptional()
  @IsString()
  @Length(8, 200)
  @Column({ type: 'varchar', length: 200, nullable: true })
  pendingRequestKey: string | null;

  @IsEnum(TimeOffRequestStatus)
  @Column({
    type: 'simple-enum',
    enum: TimeOffRequestStatus,
    default: TimeOffRequestStatus.PENDING,
  })
  status: TimeOffRequestStatus;

  @IsDate()
  @CreateDateColumn()
  createdAt: Date;

  @IsDate()
  @UpdateDateColumn()
  updatedAt: Date;
}
