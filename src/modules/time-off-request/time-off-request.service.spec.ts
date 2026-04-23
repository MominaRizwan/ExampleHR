import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { EmployeeBalanceService } from '../employee-balance/employee-balance.service';
import { HCMIntegrationService } from '../hcm-integration/hcm-integration.service';
import { TimeOffRequestService } from './time-off-request.service';
import { TimeOffRequestStatus } from './time-off-request.entity';

describe('TimeOffRequestService', () => {
  const timeOffRequestRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  const employeeBalanceService: jest.Mocked<EmployeeBalanceService> = {
    findAll: jest.fn(),
    findByEmployeeAndLocation: jest.fn(),
  } as unknown as jest.Mocked<EmployeeBalanceService>;

  const hcmIntegrationService: jest.Mocked<HCMIntegrationService> = {
    validateBalance: jest.fn(),
    updateBalance: jest.fn(),
    logBusinessEvent: jest.fn(),
  } as unknown as jest.Mocked<HCMIntegrationService>;

  const dataSource = {
    transaction: jest.fn(),
  } as unknown as DataSource;

  let service: TimeOffRequestService;

  beforeEach(() => {
    jest.resetAllMocks();

    service = new TimeOffRequestService(
      dataSource,
      employeeBalanceService,
      hcmIntegrationService,
      timeOffRequestRepository as never,
    );
  });

  describe('createRequest', () => {
    it('creates a request when input and balance are valid', async () => {
      const dto = { employeeId: 'emp-001', locationId: 'loc-nyc', daysRequested: 1.5 };

      timeOffRequestRepository.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      employeeBalanceService.findByEmployeeAndLocation.mockResolvedValue({
        employeeId: dto.employeeId,
        locationId: dto.locationId,
        balance: 10,
      } as never);

      const created = { id: 'req-1', ...dto, status: TimeOffRequestStatus.PENDING };
      timeOffRequestRepository.create.mockReturnValue(created);
      timeOffRequestRepository.save.mockResolvedValue(created);

      const result = await service.createRequest(dto);

      expect(result).toEqual(created);
      expect(employeeBalanceService.findByEmployeeAndLocation).toHaveBeenCalledWith(
        dto.employeeId,
        dto.locationId,
      );
      expect(timeOffRequestRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          employeeId: dto.employeeId,
          locationId: dto.locationId,
          daysRequested: dto.daysRequested,
          status: TimeOffRequestStatus.PENDING,
          pendingRequestKey: 'emp-001::loc-nyc::1500',
        }),
      );
    });

    it('throws BadRequestException for invalid daysRequested input', async () => {
      await expect(
        service.createRequest({
          employeeId: 'emp-001',
          locationId: 'loc-nyc',
          daysRequested: 0,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws ConflictException when local balance is insufficient', async () => {
      const dto = { employeeId: 'emp-001', locationId: 'loc-nyc', daysRequested: 2 };

      timeOffRequestRepository.findOne.mockResolvedValueOnce(null);
      employeeBalanceService.findByEmployeeAndLocation.mockResolvedValue({
        employeeId: dto.employeeId,
        locationId: dto.locationId,
        balance: 1,
      } as never);

      await expect(service.createRequest(dto)).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws ConflictException when idempotency key payload mismatches existing request', async () => {
      const dto = {
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
        daysRequested: 2,
        idempotencyKey: 'idem-key-1234',
      };

      timeOffRequestRepository.findOne.mockResolvedValue({
        id: 'req-123',
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
        daysRequested: 1,
      });

      await expect(service.createRequest(dto)).rejects.toBeInstanceOf(ConflictException);
      expect(employeeBalanceService.findByEmployeeAndLocation).not.toHaveBeenCalled();
    });

    it('returns existing request for idempotent replay with matching payload', async () => {
      const dto = {
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
        daysRequested: 2,
        idempotencyKey: 'idem-key-5678',
      };
      const existing = {
        id: 'req-existing',
        employeeId: dto.employeeId,
        locationId: dto.locationId,
        daysRequested: dto.daysRequested,
      };

      timeOffRequestRepository.findOne.mockResolvedValue(existing);

      await expect(service.createRequest(dto)).resolves.toEqual(existing);
      expect(timeOffRequestRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('approveRequest', () => {
    it('approves request when validation, HCM update, and local transaction succeed', async () => {
      const request = {
        id: 'req-1',
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
        daysRequested: 2,
        status: TimeOffRequestStatus.PENDING,
      };
      const markedInProgress = {
        ...request,
        status: TimeOffRequestStatus.APPROVAL_IN_PROGRESS,
        approvalOperationId: 'op-1',
      };
      const approvedRequest = {
        ...markedInProgress,
        status: TimeOffRequestStatus.APPROVED,
        pendingRequestKey: null,
      };

      const approvalStateRepo = {
        findOne: jest.fn().mockResolvedValue(request),
        save: jest.fn().mockResolvedValue(markedInProgress),
      };
      const approvalFinalizeRepo = {
        findOne: jest.fn().mockResolvedValue(markedInProgress),
        save: jest.fn().mockResolvedValue(approvedRequest),
      };
      const balanceRepo = {
        findOne: jest.fn().mockResolvedValue({
          employeeId: 'emp-001',
          locationId: 'loc-nyc',
          balance: 10,
          lastSyncedAt: new Date(),
        }),
        save: jest.fn(),
      };

      timeOffRequestRepository.findOne.mockResolvedValue(request);
      (dataSource.transaction as jest.Mock)
        .mockImplementationOnce((cb) =>
          cb({
            getRepository: () => approvalStateRepo,
          }),
        )
        .mockImplementationOnce((cb) =>
          cb({
            getRepository: (entity: { name: string }) =>
              entity.name === 'TimeOffRequest' ? approvalFinalizeRepo : balanceRepo,
          }),
        );

      hcmIntegrationService.validateBalance.mockResolvedValue(true);
      hcmIntegrationService.updateBalance.mockResolvedValue(8);

      const result = await service.approveRequest('req-1', { approvalOperationId: 'op-1' });

      expect(result).toEqual(approvedRequest);
      expect(hcmIntegrationService.validateBalance).toHaveBeenCalledTimes(1);
      expect(hcmIntegrationService.updateBalance).toHaveBeenCalledTimes(1);
      expect(balanceRepo.save).toHaveBeenCalledTimes(1);
    });

    it('throws ServiceUnavailableException when HCM validation fails', async () => {
      const request = {
        id: 'req-1',
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
        daysRequested: 2,
        status: TimeOffRequestStatus.PENDING,
      };
      const markedInProgress = {
        ...request,
        status: TimeOffRequestStatus.APPROVAL_IN_PROGRESS,
        approvalOperationId: 'op-1',
      };

      timeOffRequestRepository.findOne.mockResolvedValue(request);
      (dataSource.transaction as jest.Mock).mockImplementationOnce((cb) =>
        cb({
          getRepository: () => ({
            findOne: jest.fn().mockResolvedValue(request),
            save: jest.fn().mockResolvedValue(markedInProgress),
          }),
        }),
      );

      hcmIntegrationService.validateBalance.mockRejectedValue(new Error('HCM timeout'));
      hcmIntegrationService.logBusinessEvent.mockResolvedValue(undefined);

      await expect(
        service.approveRequest('req-1', { approvalOperationId: 'op-1' }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);

      expect(hcmIntegrationService.updateBalance).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when request does not exist', async () => {
      timeOffRequestRepository.findOne.mockResolvedValue(null);

      await expect(service.approveRequest('missing-id', {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns approved request when same operation replays', async () => {
      const approved = {
        id: 'req-1',
        status: TimeOffRequestStatus.APPROVED,
        approvalOperationId: 'op-1',
      };
      timeOffRequestRepository.findOne.mockResolvedValue(approved);

      await expect(
        service.approveRequest('req-1', { approvalOperationId: 'op-1' }),
      ).resolves.toEqual(approved);
    });

    it('throws ConflictException when approval in progress with different operation id', async () => {
      timeOffRequestRepository.findOne.mockResolvedValue({
        id: 'req-1',
        status: TimeOffRequestStatus.APPROVAL_IN_PROGRESS,
        approvalOperationId: 'op-1',
      });

      await expect(
        service.approveRequest('req-1', { approvalOperationId: 'op-2' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws ConflictException when HCM validation says balance is invalid', async () => {
      const request = {
        id: 'req-1',
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
        daysRequested: 5,
        status: TimeOffRequestStatus.PENDING,
      };
      const inProgress = {
        ...request,
        status: TimeOffRequestStatus.APPROVAL_IN_PROGRESS,
        approvalOperationId: 'op-1',
      };
      timeOffRequestRepository.findOne.mockResolvedValue(request);
      (dataSource.transaction as jest.Mock).mockImplementationOnce((cb) =>
        cb({
          getRepository: () => ({
            findOne: jest.fn().mockResolvedValue(request),
            save: jest.fn().mockResolvedValue(inProgress),
          }),
        }),
      );
      hcmIntegrationService.validateBalance.mockResolvedValue(false);

      await expect(
        service.approveRequest('req-1', { approvalOperationId: 'op-1' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(hcmIntegrationService.updateBalance).not.toHaveBeenCalled();
    });
  });

  describe('rejectRequest', () => {
    it('rejects a pending request', async () => {
      const request = {
        id: 'req-1',
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
        status: TimeOffRequestStatus.PENDING,
      };
      const rejected = { ...request, status: TimeOffRequestStatus.REJECTED, pendingRequestKey: null };
      timeOffRequestRepository.findOne.mockResolvedValue(request);
      timeOffRequestRepository.save.mockResolvedValue(rejected);
      hcmIntegrationService.logBusinessEvent.mockResolvedValue(undefined);

      await expect(service.rejectRequest('req-1', { reason: 'Policy' })).resolves.toEqual(rejected);
    });

    it('throws NotFoundException when rejecting unknown request', async () => {
      timeOffRequestRepository.findOne.mockResolvedValue(null);
      await expect(service.rejectRequest('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
