import { ServiceUnavailableException } from '@nestjs/common';
import { HCMMockService } from './hcm-mock.service';

describe('HCMMockService', () => {
  const buildService = (failureRate = 0, delay = 0) =>
    new HCMMockService({
      get: (key: string, defaultValue?: unknown) => {
        if (key === 'HCM_MOCK_RANDOM_FAILURE_RATE') return failureRate;
        if (key === 'HCM_MOCK_DELAY_MS') return delay;
        return defaultValue;
      },
    } as never);

  it('validates and updates balance for seeded account', async () => {
    const service = buildService(0, 0);

    await expect(service.validateBalance('emp-001', 'loc-nyc', 2)).resolves.toBe(true);
    await expect(service.updateBalance('emp-001', 'loc-nyc', 2)).resolves.toBe(13);
    await expect(service.validateBalance('emp-001', 'loc-nyc', 14)).resolves.toBe(false);
  });

  it('throws on insufficient balance update', async () => {
    const service = buildService(0, 0);
    await expect(service.updateBalance('emp-003', 'loc-sgp', 4)).rejects.toThrow(
      'Insufficient HCM balance',
    );
  });

  it('throws random failure when configured to always fail', async () => {
    const service = buildService(1, 0);
    await expect(service.validateBalance('emp-001', 'loc-nyc', 1)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
