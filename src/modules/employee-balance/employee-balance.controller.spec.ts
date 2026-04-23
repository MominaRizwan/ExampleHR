import { EmployeeBalanceController } from './employee-balance.controller';

describe('EmployeeBalanceController', () => {
  it('delegates findAll to service', async () => {
    const service = { findAll: jest.fn().mockResolvedValue([{ id: 'bal-1' }]) };
    const controller = new EmployeeBalanceController(service as never);

    await expect(controller.findAll()).resolves.toEqual([{ id: 'bal-1' }]);
    expect(service.findAll).toHaveBeenCalledTimes(1);
  });
});
