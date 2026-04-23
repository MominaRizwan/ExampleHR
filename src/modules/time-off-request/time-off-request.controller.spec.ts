import { TimeOffRequestController } from './time-off-request.controller';

describe('TimeOffRequestController', () => {
  it('delegates endpoint actions to service', async () => {
    const service = {
      findAll: jest.fn().mockResolvedValue([{ id: 'req-1' }]),
      createRequest: jest.fn().mockResolvedValue({ id: 'req-2' }),
      approveRequest: jest.fn().mockResolvedValue({ id: 'req-3' }),
      rejectRequest: jest.fn().mockResolvedValue({ id: 'req-4' }),
    };
    const controller = new TimeOffRequestController(service as never);

    await expect(controller.findAll()).resolves.toEqual([{ id: 'req-1' }]);
    await expect(
      controller.create({ employeeId: 'emp-1', locationId: 'loc-1', daysRequested: 1 }),
    ).resolves.toEqual({ id: 'req-2' });
    await expect(controller.approve('id-1', { approvalOperationId: 'op-1' })).resolves.toEqual({
      id: 'req-3',
    });
    await expect(controller.reject('id-1', { reason: 'n/a' })).resolves.toEqual({ id: 'req-4' });
  });
});
