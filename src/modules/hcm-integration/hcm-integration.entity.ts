import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export enum HCMEventStatus {
  SUCCESS = 'success',
  FAILED = 'failed',
}

@Entity({ name: 'hcm_integration_events' })
export class HCMIntegrationEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  eventType: string;

  @Column({ type: 'simple-json' })
  payload: Record<string, unknown>;

  @Column({
    type: 'simple-enum',
    enum: HCMEventStatus,
    default: HCMEventStatus.SUCCESS,
  })
  status: HCMEventStatus;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
