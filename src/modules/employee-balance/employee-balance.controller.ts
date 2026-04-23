import { Controller, Get } from '@nestjs/common';
import { EmployeeBalanceService } from './employee-balance.service';
import { EmployeeBalance } from './employee-balance.entity';

@Controller('employee-balances')
export class EmployeeBalanceController {
  constructor(private readonly employeeBalanceService: EmployeeBalanceService) {}

  @Get()
  findAll(): Promise<EmployeeBalance[]> {
    return this.employeeBalanceService.findAll();
  }
}
