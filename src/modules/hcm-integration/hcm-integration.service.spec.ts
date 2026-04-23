import { AxiosError } from 'axios';
import { of, throwError } from 'rxjs';
import { DataSource } from 'typeorm';
import { HCMEventStatus } from './hcm-integration.entity';
import { HCMIntegrationService } from './hcm-integration.service';

describe('HCMIntegrationService', () => {
  const httpService = {
    post: jest.fn(),
  };

  const configService = {
    get: jest.fn(),
    getOrThrow: jest.fn(),
  };

  const hcmMockService = {
    validateBalance: jest.fn(),
    updateBalance: jest.fn(),
  };

  const hcmIntegrationRepository = {
    find: jest.fn(),
    create: jest.fn((payload) => payload),
    save: jest.fn(),
  };

  const dataSource = {
    transaction: jest.fn(),
  } as unknown as DataSource;

  let service: HCMIntegrationService;

  beforeEach(() => {
    jest.resetAllMocks();

    configService.get.mockImplementation((key: string, defaultValue?: unknown) => {
      if (key === 'HCM_INTEGRATION_MODE') return 'api';
      if (key === 'HCM_API_TIMEOUT_MS') return 5000;
      if (key === 'HCM_API_MAX_RETRIES') return 3;
      return defaultValue;
    });
    configService.getOrThrow.mockImplementation((key: string) => {
      if (key === 'HCM_BASE_URL') return 'http://hcm.example';
      throw new Error(`Missing config for ${key}`);
    });
    hcmIntegrationRepository.create.mockImplementation((payload) => payload);
    hcmIntegrationRepository.save.mockResolvedValue(undefined);

    service = new HCMIntegrationService(
      httpService as never,
      configService as never,
      dataSource,
      hcmMockService as never,
      hcmIntegrationRepository as never,
    );
  });

  describe('validateBalance', () => {
    it('returns true for successful balance validation response', async () => {
      httpService.post.mockReturnValue(
        of({
          data: { isValid: true },
        }),
      );

      const result = await service.validateBalance({
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
        daysRequested: 2,
      });

      expect(result).toBe(true);
      expect(httpService.post).toHaveBeenCalledTimes(1);
      expect(hcmIntegrationRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'time_off_balance_validation',
          status: HCMEventStatus.SUCCESS,
        }),
      );
    });

    it('retries on transient 5xx error and eventually succeeds', async () => {
      const transientError = new AxiosError(
        'Server error',
        'ERR_BAD_RESPONSE',
        undefined,
        undefined,
        { status: 503, statusText: 'Service Unavailable', headers: {}, config: {} as never, data: {} },
      );

      httpService.post
        .mockReturnValueOnce(throwError(() => transientError))
        .mockReturnValueOnce(of({ data: { isValid: true } }));

      const result = await service.validateBalance({
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
        daysRequested: 1,
      });

      expect(result).toBe(true);
      expect(httpService.post).toHaveBeenCalledTimes(2);
    });

    it('does not retry on 4xx business error', async () => {
      const businessError = new AxiosError(
        'Bad request',
        'ERR_BAD_REQUEST',
        undefined,
        undefined,
        { status: 400, statusText: 'Bad Request', headers: {}, config: {} as never, data: {} },
      );

      httpService.post.mockReturnValue(throwError(() => businessError));

      await expect(
        service.validateBalance({
          employeeId: 'emp-001',
          locationId: 'loc-nyc',
          daysRequested: 5,
        }),
      ).rejects.toBeInstanceOf(AxiosError);

      expect(httpService.post).toHaveBeenCalledTimes(1);
      expect(hcmIntegrationRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'time_off_balance_validation',
          status: HCMEventStatus.FAILED,
        }),
      );
    });
  });

  describe('mock mode and sync flows', () => {
    it('uses mock mode for validate and update', async () => {
      configService.get.mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'HCM_INTEGRATION_MODE') return 'mock';
        if (key === 'HCM_API_MAX_RETRIES') return 3;
        return defaultValue;
      });
      hcmMockService.validateBalance.mockResolvedValue(true);
      hcmMockService.updateBalance.mockResolvedValue(9);

      await expect(
        service.validateBalance({ employeeId: 'emp-1', locationId: 'loc-1', daysRequested: 1 }),
      ).resolves.toBe(true);
      await expect(
        service.updateBalance({ employeeId: 'emp-1', locationId: 'loc-1', daysRequested: 1 }),
      ).resolves.toBe(9);
    });

    it('syncs balances with create, update and stale-skip handling', async () => {
      const state = new Map<string, { balance: number; lastSyncedAt: Date }>();
      state.set('emp-2::loc-2', { balance: 2, lastSyncedAt: new Date('2026-01-02T00:00:00.000Z') });

      const repo = {
        findOne: jest.fn(async ({ where }: { where: { employeeId: string; locationId: string } }) => {
          const key = `${where.employeeId}::${where.locationId}`;
          const record = state.get(key);
          if (!record) return null;
          return {
            employeeId: where.employeeId,
            locationId: where.locationId,
            balance: record.balance,
            lastSyncedAt: record.lastSyncedAt,
          };
        }),
        create: jest.fn((payload) => payload),
        save: jest.fn(async (record) => {
          state.set(`${record.employeeId}::${record.locationId}`, {
            balance: record.balance,
            lastSyncedAt: new Date(record.lastSyncedAt),
          });
          return record;
        }),
      };
      (dataSource.transaction as jest.Mock).mockImplementation(async (cb) =>
        cb({
          getRepository: () => repo,
        }),
      );

      const result = await service.syncBalances({
        balances: [
          {
            employeeId: 'emp-1',
            locationId: 'loc-1',
            balance: 10,
            lastSyncedAt: '2026-01-01T00:00:00.000Z',
          },
          {
            employeeId: 'emp-2',
            locationId: 'loc-2',
            balance: 5,
            lastSyncedAt: '2026-01-01T00:00:00.000Z',
          },
          {
            employeeId: 'emp-2',
            locationId: 'loc-2',
            balance: 8,
            lastSyncedAt: '2026-01-03T00:00:00.000Z',
          },
        ],
      });

      expect(result).toEqual({
        received: 3,
        processed: 2,
        created: 1,
        updated: 1,
        skippedStale: 0,
      });
      expect(hcmIntegrationRepository.save).toHaveBeenCalled();
    });
  });
});
