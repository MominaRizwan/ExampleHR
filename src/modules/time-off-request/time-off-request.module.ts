import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmployeeBalanceModule } from '../employee-balance/employee-balance.module';
import { HCMIntegrationModule } from '../hcm-integration/hcm-integration.module';
import { TimeOffRequest } from './time-off-request.entity';
import { TimeOffRequestController } from './time-off-request.controller';
import { TimeOffRequestService } from './time-off-request.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([TimeOffRequest]),
    EmployeeBalanceModule,
    HCMIntegrationModule,
  ],
  controllers: [TimeOffRequestController],
  providers: [TimeOffRequestService],
  exports: [TimeOffRequestService],
})
export class TimeOffRequestModule {}
