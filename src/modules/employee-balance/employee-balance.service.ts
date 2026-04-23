import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EmployeeBalance } from './employee-balance.entity';

@Injectable()
export class EmployeeBalanceService {
  constructor(
    @InjectRepository(EmployeeBalance)
    private readonly employeeBalanceRepository: Repository<EmployeeBalance>,
  ) {}

  findAll(): Promise<EmployeeBalance[]> {
    return this.employeeBalanceRepository.find();
  }

  findByEmployeeAndLocation(
    employeeId: string,
    locationId: string,
  ): Promise<EmployeeBalance | null> {
    return this.employeeBalanceRepository.findOne({
      where: { employeeId, locationId },
    });
  }
}
