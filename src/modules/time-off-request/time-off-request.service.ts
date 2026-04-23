import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { EmployeeBalance } from '../employee-balance/employee-balance.entity';
import { EmployeeBalanceService } from '../employee-balance/employee-balance.service';
import { HCMEventStatus } from '../hcm-integration/hcm-integration.entity';
import { HCMIntegrationService } from '../hcm-integration/hcm-integration.service';
import { toFixedPointDays } from '../../common/transformers/fixed-point-days.transformer';
import { ApproveTimeOffRequestDto } from './dto/approve-time-off-request.dto';
import { CreateTimeOffRequestDto } from './dto/create-time-off-request.dto';
import { RejectTimeOffRequestDto } from './dto/reject-time-off-request.dto';
import { TimeOffRequest, TimeOffRequestStatus } from './time-off-request.entity';

@Injectable()
export class TimeOffRequestService {
  private readonly logger = new Logger(TimeOffRequestService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly employeeBalanceService: EmployeeBalanceService,
    private readonly hcmIntegrationService: HCMIntegrationService,
    @InjectRepository(TimeOffRequest)
    private readonly timeOffRequestRepository: Repository<TimeOffRequest>,
  ) {}

  findAll(): Promise<TimeOffRequest[]> {
    return this.timeOffRequestRepository.find({
      order: { createdAt: 'DESC' },
    });
  }

  async createRequest(createDto: CreateTimeOffRequestDto): Promise<TimeOffRequest> {
    this.logger.log(
      `Create request started for employeeId=${createDto.employeeId}, locationId=${createDto.locationId}`,
    );

    if (createDto.daysRequested <= 0) {
      throw new BadRequestException('daysRequested must be greater than 0');
    }

    if (createDto.idempotencyKey) {
      const existingByIdempotencyKey = await this.timeOffRequestRepository.findOne({
        where: { idempotencyKey: createDto.idempotencyKey },
      });

      if (existingByIdempotencyKey) {
        this.assertMatchingCreatePayload(existingByIdempotencyKey, createDto);
        this.logger.warn(
          `Idempotent replay detected for key=${createDto.idempotencyKey}; returning existing request ${existingByIdempotencyKey.id}`,
        );
        return existingByIdempotencyKey;
      }
    }

    const localBalance = await this.employeeBalanceService.findByEmployeeAndLocation(
      createDto.employeeId,
      createDto.locationId,
    );

    if (!localBalance) {
      throw new NotFoundException('Employee balance record was not found');
    }

    if (localBalance.balance < createDto.daysRequested) {
      throw new ConflictException('Insufficient local balance for requested days');
    }

    const existingPendingDuplicate = await this.timeOffRequestRepository.findOne({
      where: {
        employeeId: createDto.employeeId,
        locationId: createDto.locationId,
        daysRequested: createDto.daysRequested,
        status: TimeOffRequestStatus.PENDING,
      },
    });
    if (existingPendingDuplicate) {
      this.logger.warn(
        `Duplicate pending request prevented. existingRequestId=${existingPendingDuplicate.id}`,
      );
      throw new ConflictException('A matching pending request already exists');
    }

    const request = this.timeOffRequestRepository.create({
      ...createDto,
      status: TimeOffRequestStatus.PENDING,
      idempotencyKey: createDto.idempotencyKey ?? null,
      pendingRequestKey: this.buildPendingRequestKey(
        createDto.employeeId,
        createDto.locationId,
        createDto.daysRequested,
      ),
    });

    try {
      const savedRequest = await this.timeOffRequestRepository.save(request);
      this.logger.log(`Request created successfully. requestId=${savedRequest.id}`);
      return savedRequest;
    } catch (error) {
      if (
        createDto.idempotencyKey &&
        error instanceof QueryFailedError &&
        `${error.message}`.includes('UNIQUE')
      ) {
        const existingByIdempotencyKey = await this.timeOffRequestRepository.findOne({
          where: { idempotencyKey: createDto.idempotencyKey },
        });
        if (existingByIdempotencyKey) {
          this.assertMatchingCreatePayload(existingByIdempotencyKey, createDto);
          this.logger.warn(
            `Recovered idempotent request after race for key=${createDto.idempotencyKey}`,
          );
          return existingByIdempotencyKey;
        }
      }

      throw error;
    }
  }

  async approveRequest(id: string, approveDto: ApproveTimeOffRequestDto): Promise<TimeOffRequest> {
    this.logger.log(`Approval started for requestId=${id}`);

    const providedOperationId = approveDto.approvalOperationId;
    const request = await this.timeOffRequestRepository.findOne({ where: { id } });
    if (!request) {
      throw new NotFoundException(`Time-off request ${id} was not found`);
    }

    if (request.status === TimeOffRequestStatus.APPROVED) {
      if (providedOperationId && request.approvalOperationId !== providedOperationId) {
        throw new ConflictException('Request already approved by a different approval operation');
      }
      return request;
    }

    if (request.status === TimeOffRequestStatus.APPROVAL_IN_PROGRESS) {
      if (providedOperationId && request.approvalOperationId === providedOperationId) {
        return request;
      }
      throw new ConflictException(
        'Approval already in progress. Retry with the same approvalOperationId.',
      );
    }

    if (request.status !== TimeOffRequestStatus.PENDING) {
      throw new ConflictException('Only pending requests can be approved');
    }

    const operationId = providedOperationId ?? randomUUID();

    // Consistency strategy: persist local "approval_in_progress" intent before any external side effect.
    // This gives us a durable checkpoint for safe retries and replay control via approvalOperationId.
    const requestMarkedForApproval = await this.dataSource.transaction(async (manager) => {
      const requestRepository = manager.getRepository(TimeOffRequest);
      const currentRequest = await requestRepository.findOne({ where: { id } });
      if (!currentRequest) {
        throw new NotFoundException(`Time-off request ${id} was not found`);
      }

      if (currentRequest.status !== TimeOffRequestStatus.PENDING) {
        throw new ConflictException('Only pending requests can be approved');
      }

      currentRequest.status = TimeOffRequestStatus.APPROVAL_IN_PROGRESS;
      currentRequest.approvalOperationId = operationId;
      return requestRepository.save(currentRequest);
    });

    if (
      requestMarkedForApproval.status !== TimeOffRequestStatus.APPROVAL_IN_PROGRESS ||
      requestMarkedForApproval.approvalOperationId !== operationId
    ) {
      throw new ConflictException('Could not start approval operation safely');
    }

    let hcmValidationPassed = false;
    try {
      hcmValidationPassed = await this.hcmIntegrationService.validateBalance({
        employeeId: requestMarkedForApproval.employeeId,
        locationId: requestMarkedForApproval.locationId,
        daysRequested: requestMarkedForApproval.daysRequested,
      });
    } catch {
      this.logger.error(`HCM validateBalance failed for requestId=${id}`);
      await this.hcmIntegrationService.logBusinessEvent(
        'time_off_request_approval_failed',
        { requestId: id, reason: 'hcm_validate_balance_failed' },
        HCMEventStatus.FAILED,
        'HCM validateBalance failed after retries',
      );
      throw new ServiceUnavailableException(
        'HCM validation failed; request remains in approval_in_progress for safe retry.',
      );
    }

    if (!hcmValidationPassed) {
      this.logger.warn(`HCM rejected approval for requestId=${id}`);
      throw new ConflictException('HCM validation rejected this request');
    }

    // HCM update happens before final local approval commit; operationId + in-progress state
    // are used to keep retries idempotent and prevent duplicated processing on client retries.
    try {
      await this.hcmIntegrationService.updateBalance({
        employeeId: requestMarkedForApproval.employeeId,
        locationId: requestMarkedForApproval.locationId,
        daysRequested: requestMarkedForApproval.daysRequested,
      });
    } catch {
      this.logger.error(`HCM updateBalance failed for requestId=${id}`);
      await this.hcmIntegrationService.logBusinessEvent(
        'time_off_request_approval_failed',
        { requestId: id, reason: 'hcm_update_balance_failed' },
        HCMEventStatus.FAILED,
        'HCM updateBalance failed after retries',
      );
      throw new ServiceUnavailableException(
        'HCM balance update failed; request remains in approval_in_progress for safe retry.',
      );
    }

    try {
      // Finalize local state only when remote side accepted and updated successfully.
      // Trade-off: pragmatic orchestration without full saga/outbox to minimize complexity.
      return await this.dataSource.transaction(async (manager) => {
        const requestRepository = manager.getRepository(TimeOffRequest);
        const employeeBalanceRepository = manager.getRepository(EmployeeBalance);

        const requestInTx = await requestRepository.findOne({ where: { id } });
        if (!requestInTx) {
          throw new NotFoundException(`Time-off request ${id} was not found`);
        }

        if (
          requestInTx.status !== TimeOffRequestStatus.APPROVAL_IN_PROGRESS ||
          requestInTx.approvalOperationId !== operationId
        ) {
          throw new ConflictException('Approval operation state mismatch');
        }

        const balance = await employeeBalanceRepository.findOne({
          where: {
            employeeId: requestInTx.employeeId,
            locationId: requestInTx.locationId,
          },
        });
        if (!balance) {
          throw new NotFoundException('Employee balance record was not found');
        }

        if (balance.balance < requestInTx.daysRequested) {
          throw new ConflictException('Insufficient local balance for approval');
        }

        balance.balance -= requestInTx.daysRequested;
        balance.lastSyncedAt = new Date();
        await employeeBalanceRepository.save(balance);

        requestInTx.status = TimeOffRequestStatus.APPROVED;
        requestInTx.approvalOperationId = operationId;
        requestInTx.pendingRequestKey = null;
        const savedRequest = await requestRepository.save(requestInTx);
        this.logger.log(`Approval completed for requestId=${savedRequest.id}`);
        return savedRequest;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown transaction error';
      this.logger.error(`Approval transaction failed for requestId=${id}: ${message}`);
      throw error;
    }
  }

  async rejectRequest(id: string, rejectDto?: RejectTimeOffRequestDto): Promise<TimeOffRequest> {
    this.logger.log(`Rejection started for requestId=${id}`);

    const request = await this.timeOffRequestRepository.findOne({ where: { id } });
    if (!request) {
      throw new NotFoundException(`Time-off request ${id} was not found`);
    }

    if (
      request.status !== TimeOffRequestStatus.PENDING &&
      request.status !== TimeOffRequestStatus.APPROVAL_IN_PROGRESS
    ) {
      throw new ConflictException('Only pending or approval_in_progress requests can be rejected');
    }

    request.status = TimeOffRequestStatus.REJECTED;
    request.pendingRequestKey = null;
    const saved = await this.timeOffRequestRepository.save(request);

    await this.hcmIntegrationService.logBusinessEvent(
      'time_off_request_rejected',
      {
        requestId: saved.id,
        employeeId: saved.employeeId,
        locationId: saved.locationId,
        reason: rejectDto?.reason ?? null,
      },
      HCMEventStatus.SUCCESS,
    );

    this.logger.log(`Rejection completed for requestId=${id}`);
    return saved;
  }

  private assertMatchingCreatePayload(
    existingRequest: TimeOffRequest,
    createDto: CreateTimeOffRequestDto,
  ): void {
    const isSamePayload =
      existingRequest.employeeId === createDto.employeeId &&
      existingRequest.locationId === createDto.locationId &&
      existingRequest.daysRequested === createDto.daysRequested;

    if (!isSamePayload) {
      throw new ConflictException(
        'Idempotency key was already used with a different request payload',
      );
    }
  }

  private buildPendingRequestKey(employeeId: string, locationId: string, daysRequested: number): string {
    return `${employeeId}::${locationId}::${toFixedPointDays(daysRequested)}`;
  }
}
