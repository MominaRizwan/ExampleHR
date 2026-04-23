import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HCMIntegrationEvent } from './hcm-integration.entity';
import { HCMIntegrationController } from './hcm-integration.controller';
import { HCMIntegrationService } from './hcm-integration.service';
import { HCMMockService } from './hcm-mock.service';
import { EmployeeBalance } from '../employee-balance/employee-balance.entity';
import { HCMSyncAuthGuard } from './guards/hcm-sync-auth.guard';

@Module({
  imports: [HttpModule, TypeOrmModule.forFeature([HCMIntegrationEvent, EmployeeBalance])],
  controllers: [HCMIntegrationController],
  providers: [HCMIntegrationService, HCMMockService, HCMSyncAuthGuard],
  exports: [HCMIntegrationService],
})
export class HCMIntegrationModule {}
