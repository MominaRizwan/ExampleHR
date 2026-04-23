import { EmployeeBalanceService } from './employee-balance.service';

describe('EmployeeBalanceService', () => {
  const repository = {
    find: jest.fn(),
    findOne: jest.fn(),
  };

  let service: EmployeeBalanceService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new EmployeeBalanceService(repository as never);
  });

  it('returns all balances', async () => {
    repository.find.mockResolvedValue([{ id: '1' }]);
    await expect(service.findAll()).resolves.toEqual([{ id: '1' }]);
  });

  it('finds by employee and location', async () => {
    repository.findOne.mockResolvedValue({ id: 'bal-1' });
    await expect(service.findByEmployeeAndLocation('emp-1', 'loc-1')).resolves.toEqual({
      id: 'bal-1',
    });
    expect(repository.findOne).toHaveBeenCalledWith({
      where: { employeeId: 'emp-1', locationId: 'loc-1' },
    });
  });
});
