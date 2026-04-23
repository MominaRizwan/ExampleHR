import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppConfigModule } from './config/app-config.module';
import { DatabaseModule } from './database/database.module';
import { EmployeeBalanceModule } from './modules/employee-balance/employee-balance.module';
import { TimeOffRequestModule } from './modules/time-off-request/time-off-request.module';
import { HCMIntegrationModule } from './modules/hcm-integration/hcm-integration.module';

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    EmployeeBalanceModule,
    TimeOffRequestModule,
    HCMIntegrationModule,
  ],
  controllers: [AppController],
  providers: [],
})
export class AppModule {}
