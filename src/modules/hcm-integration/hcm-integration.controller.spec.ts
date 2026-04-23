import { HCMIntegrationController } from './hcm-integration.controller';

describe('HCMIntegrationController', () => {
  it('delegates to service methods', async () => {
    const service = {
      findAll: jest.fn().mockResolvedValue([{ id: 'evt-1' }]),
      syncBalances: jest.fn().mockResolvedValue({ processed: 1 }),
    };
    const controller = new HCMIntegrationController(service as never);

    await expect(controller.findAll()).resolves.toEqual([{ id: 'evt-1' }]);
    await expect(controller.syncBalances({ balances: [] } as never)).resolves.toEqual({
      processed: 1,
    });
    expect(service.findAll).toHaveBeenCalledTimes(1);
    expect(service.syncBalances).toHaveBeenCalledTimes(1);
  });
});
