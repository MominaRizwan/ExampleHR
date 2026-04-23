import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { InjectRepository } from '@nestjs/typeorm';
import { AxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import { DataSource, Repository } from 'typeorm';
import { EmployeeBalance } from '../employee-balance/employee-balance.entity';
import { HCMEventStatus, HCMIntegrationEvent } from './hcm-integration.entity';
import { HCMMockService } from './hcm-mock.service';
import { SyncBalanceItemDto, SyncBalancesDto } from './dto/sync-balance.dto';

type ValidateBalancePayload = {
  employeeId: string;
  locationId: string;
  daysRequested: number;
};

@Injectable()
export class HCMIntegrationService {
  private readonly logger = new Logger(HCMIntegrationService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
    private readonly hcmMockService: HCMMockService,
    @InjectRepository(HCMIntegrationEvent)
    private readonly hcmIntegrationRepository: Repository<HCMIntegrationEvent>,
  ) {}

  findAll(): Promise<HCMIntegrationEvent[]> {
    return this.hcmIntegrationRepository.find({
      order: { createdAt: 'DESC' },
    });
  }

  async validateBalance(payload: ValidateBalancePayload): Promise<boolean> {
    if (this.isMockMode()) {
      return this.executeWithRetry(() => this.validateBalanceViaMock(payload), 'validateBalance(mock)');
    }

    const baseUrl = this.configService.getOrThrow<string>('HCM_BASE_URL');
    const timeout = this.configService.get<number>('HCM_API_TIMEOUT_MS', 5000);
    const url = `${baseUrl}/api/v1/time-off/validate-balance`;

    return this.executeWithRetry(async () => {
      const response = await firstValueFrom(
        this.httpService.post<{ isValid: boolean }>(url, payload, { timeout }),
      );

      const isValid = Boolean(response.data?.isValid);
      await this.logEvent('time_off_balance_validation', payload, HCMEventStatus.SUCCESS);
      return isValid;
    }, 'validateBalance(api)', async (error) => {
      const message = error instanceof Error ? error.message : 'Unknown HCM API error';
      await this.logEvent('time_off_balance_validation', payload, HCMEventStatus.FAILED, message);
    });
  }

  async updateBalance(payload: ValidateBalancePayload): Promise<number> {
    if (this.isMockMode()) {
      return this.executeWithRetry(() => this.updateBalanceViaMock(payload), 'updateBalance(mock)');
    }

    const baseUrl = this.configService.getOrThrow<string>('HCM_BASE_URL');
    const timeout = this.configService.get<number>('HCM_API_TIMEOUT_MS', 5000);
    const url = `${baseUrl}/api/v1/time-off/update-balance`;

    return this.executeWithRetry(async () => {
      const response = await firstValueFrom(
        this.httpService.post<{ remainingBalance: number }>(
          url,
          {
            employeeId: payload.employeeId,
            locationId: payload.locationId,
            days: payload.daysRequested,
          },
          { timeout },
        ),
      );

      const remainingBalance = Number(response.data?.remainingBalance);
      await this.logEvent('time_off_balance_update', payload, HCMEventStatus.SUCCESS);
      return remainingBalance;
    }, 'updateBalance(api)', async (error) => {
      const message = error instanceof Error ? error.message : 'Unknown HCM API error';
      await this.logEvent('time_off_balance_update', payload, HCMEventStatus.FAILED, message);
    });
  }

  async logBusinessEvent(
    eventType: string,
    payload: Record<string, unknown>,
    status: HCMEventStatus,
    errorMessage: string | null = null,
  ): Promise<void> {
    await this.logEvent(eventType, payload, status, errorMessage);
  }

  async syncBalances(syncBalancesDto: SyncBalancesDto): Promise<{
    received: number;
    processed: number;
    created: number;
    updated: number;
    skippedStale: number;
  }> {
    this.logger.log(`Starting HCM batch sync. records=${syncBalancesDto.balances.length}`);
    const dedupedItems = this.dedupeByLatestTimestamp(syncBalancesDto.balances);

    const result = await this.dataSource.transaction(async (manager) => {
      let created = 0;
      let updated = 0;
      let skippedStale = 0;

      for (const item of dedupedItems) {
        const incomingTimestamp = new Date(item.lastSyncedAt);
        const existing = await manager.getRepository(EmployeeBalance).findOne({
          where: { employeeId: item.employeeId, locationId: item.locationId },
        });

        if (!existing) {
          // Assumption: If a record does not exist locally, HCM is source of truth and we create it.
          await manager.getRepository(EmployeeBalance).save(
            manager.getRepository(EmployeeBalance).create({
              employeeId: item.employeeId,
              locationId: item.locationId,
              balance: item.balance,
              lastSyncedAt: incomingTimestamp,
            }),
          );
          created += 1;
          continue;
        }

        // Assumption: We only apply changes newer than local state to avoid stale overwrites.
        if (incomingTimestamp <= existing.lastSyncedAt) {
          skippedStale += 1;
          continue;
        }

        existing.balance = item.balance;
        existing.lastSyncedAt = incomingTimestamp;
        await manager.getRepository(EmployeeBalance).save(existing);
        updated += 1;
      }

      return { created, updated, skippedStale };
    });

    await this.logEvent(
      'hcm_balance_batch_sync',
      {
        received: syncBalancesDto.balances.length,
        processed: dedupedItems.length,
        created: result.created,
        updated: result.updated,
        skippedStale: result.skippedStale,
      },
      HCMEventStatus.SUCCESS,
    );

    this.logger.log(
      `HCM batch sync completed. processed=${dedupedItems.length}, created=${result.created}, updated=${result.updated}, skippedStale=${result.skippedStale}`,
    );

    return {
      received: syncBalancesDto.balances.length,
      processed: dedupedItems.length,
      created: result.created,
      updated: result.updated,
      skippedStale: result.skippedStale,
    };
  }

  private async logEvent(
    eventType: string,
    payload: Record<string, unknown>,
    status: HCMEventStatus,
    errorMessage: string | null = null,
  ): Promise<void> {
    await this.hcmIntegrationRepository.save(
      this.hcmIntegrationRepository.create({
        eventType,
        payload,
        status,
        errorMessage,
      }),
    );
  }

  private dedupeByLatestTimestamp(items: SyncBalanceItemDto[]): SyncBalanceItemDto[] {
    const deduped = new Map<string, SyncBalanceItemDto>();

    for (const item of items) {
      const key = `${item.employeeId}::${item.locationId}`;
      const existing = deduped.get(key);

      if (!existing) {
        deduped.set(key, item);
        continue;
      }

      // Assumption: Within one batch payload, keep the newest update per employee/location pair.
      if (new Date(item.lastSyncedAt) > new Date(existing.lastSyncedAt)) {
        deduped.set(key, item);
      }
    }

    return [...deduped.values()];
  }

  private isMockMode(): boolean {
    return this.configService.get<string>('HCM_INTEGRATION_MODE', 'mock') === 'mock';
  }

  private async validateBalanceViaMock(payload: ValidateBalancePayload): Promise<boolean> {
    try {
      const isValid = await this.hcmMockService.validateBalance(
        payload.employeeId,
        payload.locationId,
        payload.daysRequested,
      );
      await this.logEvent('time_off_balance_validation_mock', payload, HCMEventStatus.SUCCESS);
      return isValid;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown mock HCM error';
      await this.logEvent('time_off_balance_validation_mock', payload, HCMEventStatus.FAILED, message);
      throw error;
    }
  }

  private async updateBalanceViaMock(payload: ValidateBalancePayload): Promise<number> {
    try {
      const remainingBalance = await this.hcmMockService.updateBalance(
        payload.employeeId,
        payload.locationId,
        payload.daysRequested,
      );
      await this.logEvent('time_off_balance_update_mock', payload, HCMEventStatus.SUCCESS);
      return remainingBalance;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown mock HCM error';
      await this.logEvent('time_off_balance_update_mock', payload, HCMEventStatus.FAILED, message);
      throw error;
    }
  }

  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
    onFinalFailure?: (error: unknown) => Promise<void>,
  ): Promise<T> {
    const maxRetries = this.configService.get<number>('HCM_API_MAX_RETRIES', 3);
    let attempt = 0;
    let lastError: unknown;

    while (attempt < maxRetries) {
      attempt += 1;
      try {
        if (attempt > 1) {
          this.logger.warn(`${operationName} retry attempt ${attempt}/${maxRetries}`);
        }
        return await operation();
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(`${operationName} failed on attempt ${attempt}/${maxRetries}: ${message}`);

        const isTransient = this.isTransientError(error);
        // Intentional policy: retry only transient failures (network/timeout/5xx).
        // 4xx errors are treated as deterministic business failures and fail fast.
        if (!isTransient) {
          this.logger.warn(`${operationName} encountered non-transient error; skipping retries`);
          break;
        }

        if (attempt < maxRetries) {
          await this.sleep(200 * attempt);
        }
      }
    }

    if (onFinalFailure) {
      await onFinalFailure(lastError);
    }

    throw lastError;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private isTransientError(error: unknown): boolean {
    if (error instanceof AxiosError) {
      const status = error.response?.status;
      if (status !== undefined) {
        return status >= 500;
      }

      const transientCodes = new Set([
        'ECONNABORTED',
        'ETIMEDOUT',
        'ENOTFOUND',
        'ECONNREFUSED',
        'ECONNRESET',
        'EAI_AGAIN',
      ]);
      return transientCodes.has(error.code ?? '');
    }

    if (error instanceof Error) {
      return /timeout|network|socket|temporar/i.test(error.message);
    }

    return false;
  }
}
