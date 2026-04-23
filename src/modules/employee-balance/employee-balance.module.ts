import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmployeeBalance } from './employee-balance.entity';
import { EmployeeBalanceController } from './employee-balance.controller';
import { EmployeeBalanceService } from './employee-balance.service';

@Module({
  imports: [TypeOrmModule.forFeature([EmployeeBalance])],
  controllers: [EmployeeBalanceController],
  providers: [EmployeeBalanceService],
  exports: [EmployeeBalanceService],
})
export class EmployeeBalanceModule {}
