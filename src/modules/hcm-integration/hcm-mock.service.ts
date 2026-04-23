import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type BalanceInput = {
  employeeId: string;
  locationId: string;
  days: number;
};

@Injectable()
export class HCMMockService {
  private readonly balances = new Map<string, number>();
  private readonly randomFailureRate: number;
  private readonly responseDelayMs: number;

  constructor(private readonly configService: ConfigService) {
    this.randomFailureRate = this.configService.get<number>('HCM_MOCK_RANDOM_FAILURE_RATE', 0.15);
    this.responseDelayMs = this.configService.get<number>('HCM_MOCK_DELAY_MS', 250);

    this.seedBalances();
  }

  async validateBalance(employeeId: string, locationId: string, days: number): Promise<boolean> {
    this.validateDays(days);
    await this.simulateNetworkBehavior();

    const key = this.getKey(employeeId, locationId);
    const currentBalance = this.balances.get(key) ?? 0;
    return currentBalance >= days;
  }

  async updateBalance(employeeId: string, locationId: string, days: number): Promise<number> {
    this.validateDays(days);
    await this.simulateNetworkBehavior();

    const key = this.getKey(employeeId, locationId);
    const currentBalance = this.balances.get(key) ?? 0;

    if (currentBalance < days) {
      throw new Error('Insufficient HCM balance');
    }

    const updatedBalance = Number((currentBalance - days).toFixed(2));
    this.balances.set(key, updatedBalance);

    return updatedBalance;
  }

  private validateDays(days: number): void {
    if (!Number.isFinite(days) || days <= 0) {
      throw new Error('days must be greater than 0');
    }
  }

  private async simulateNetworkBehavior(): Promise<void> {
    await this.sleep(this.responseDelayMs);

    if (Math.random() < this.randomFailureRate) {
      throw new ServiceUnavailableException('Mock HCM API random failure');
    }
  }

  private seedBalances(): void {
    this.balances.set(this.getKey('emp-001', 'loc-nyc'), 15);
    this.balances.set(this.getKey('emp-002', 'loc-ldn'), 7.5);
    this.balances.set(this.getKey('emp-003', 'loc-sgp'), 2);
  }

  private getKey(employeeId: string, locationId: string): string {
    return `${employeeId}::${locationId}`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
