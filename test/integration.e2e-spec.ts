import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { EmployeeBalance } from '../src/modules/employee-balance/employee-balance.entity';
import { TimeOffRequest, TimeOffRequestStatus } from '../src/modules/time-off-request/time-off-request.entity';

describe('Integration flows (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let employeeBalanceRepository: Repository<EmployeeBalance>;
  let timeOffRequestRepository: Repository<TimeOffRequest>;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.PORT = '3000';
    process.env.DB_TYPE = 'sqlite';
    process.env.DB_PATH = ':memory:';
    process.env.DB_SYNCHRONIZE = 'true';
    process.env.DB_LOGGING = 'false';
    process.env.HCM_INTEGRATION_MODE = 'mock';
    process.env.HCM_BASE_URL = 'http://localhost:4000';
    process.env.HCM_API_TIMEOUT_MS = '3000';
    process.env.HCM_API_MAX_RETRIES = '3';
    process.env.HCM_MOCK_RANDOM_FAILURE_RATE = '0';
    process.env.HCM_MOCK_DELAY_MS = '0';
    process.env.HCM_SYNC_SERVICE_TOKEN = 'change-me-sync-token';
    process.env.HCM_SYNC_SIGNATURE_TTL_SECONDS = '300';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();

    dataSource = app.get(DataSource);
    await dataSource.synchronize(true);
    employeeBalanceRepository = dataSource.getRepository(EmployeeBalance);
    timeOffRequestRepository = dataSource.getRepository(TimeOffRequest);
  });

  beforeEach(async () => {
    await timeOffRequestRepository.clear();
    await employeeBalanceRepository.clear();
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates time-off request and persists it in database', async () => {
    await employeeBalanceRepository.save(
      employeeBalanceRepository.create({
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
        balance: 12,
        lastSyncedAt: new Date(),
      }),
    );

    const response = await request(app.getHttpServer())
      .post('/api/time-off-requests')
      .send({
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
        daysRequested: 2,
        idempotencyKey: 'idem-create-1001',
      })
      .expect(201);

    expect(response.body).toEqual(
      expect.objectContaining({
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
        daysRequested: 2,
        status: TimeOffRequestStatus.PENDING,
      }),
    );

    const persisted = await timeOffRequestRepository.findOne({
      where: { id: response.body.id },
    });
    expect(persisted).not.toBeNull();
    expect(persisted?.pendingRequestKey).toBe('emp-001::loc-nyc::2000');
  });

  it('rejects create request for invalid input and insufficient balance', async () => {
    await employeeBalanceRepository.save(
      employeeBalanceRepository.create({
        employeeId: 'emp-002',
        locationId: 'loc-ldn',
        balance: 1,
        lastSyncedAt: new Date(),
      }),
    );

    await request(app.getHttpServer())
      .post('/api/time-off-requests')
      .send({
        employeeId: 'emp-002',
        locationId: 'loc-ldn',
        daysRequested: 0,
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/time-off-requests')
      .send({
        employeeId: 'emp-002',
        locationId: 'loc-ldn',
        daysRequested: 2,
      })
      .expect(409);
  });

  it('approves request, uses HCM mock integration, and updates local balance', async () => {
    await employeeBalanceRepository.save(
      employeeBalanceRepository.create({
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
        balance: 10,
        lastSyncedAt: new Date(),
      }),
    );

    const createResponse = await request(app.getHttpServer())
      .post('/api/time-off-requests')
      .send({
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
        daysRequested: 2,
        idempotencyKey: 'idem-approve-1001',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/time-off-requests/${createResponse.body.id}/approve`)
      .send({ approvalOperationId: 'approval-op-1' })
      .expect(201);

    const updatedRequest = await timeOffRequestRepository.findOne({
      where: { id: createResponse.body.id },
    });
    const updatedBalance = await employeeBalanceRepository.findOne({
      where: { employeeId: 'emp-001', locationId: 'loc-nyc' },
    });

    expect(updatedRequest?.status).toBe(TimeOffRequestStatus.APPROVED);
    expect(updatedBalance?.balance).toBe(8);
  });

  it('protects /hcm/sync and updates balances only with valid token', async () => {
    const syncPayload = {
      balances: [
        {
          employeeId: 'emp-003',
          locationId: 'loc-sgp',
          balance: 7.5,
          lastSyncedAt: '2026-04-24T00:00:00.000Z',
        },
      ],
    };

    await request(app.getHttpServer()).post('/api/hcm/sync').send(syncPayload).expect(401);

    await request(app.getHttpServer())
      .post('/api/hcm/sync')
      .set('x-service-token', 'change-me-sync-token')
      .send(syncPayload)
      .expect(201)
      .expect({
        received: 1,
        processed: 1,
        created: 1,
        updated: 0,
        skippedStale: 0,
      });

    const syncedBalance = await employeeBalanceRepository.findOne({
      where: { employeeId: 'emp-003', locationId: 'loc-sgp' },
    });
    expect(syncedBalance?.balance).toBe(7.5);
  });

  it('skips stale sync updates to avoid overwriting newer local data', async () => {
    await employeeBalanceRepository.save(
      employeeBalanceRepository.create({
        employeeId: 'emp-004',
        locationId: 'loc-tor',
        balance: 9,
        lastSyncedAt: new Date('2026-04-24T12:00:00.000Z'),
      }),
    );

    const response = await request(app.getHttpServer())
      .post('/api/hcm/sync')
      .set('x-service-token', 'change-me-sync-token')
      .send({
        balances: [
          {
            employeeId: 'emp-004',
            locationId: 'loc-tor',
            balance: 2,
            lastSyncedAt: '2026-04-24T10:00:00.000Z',
          },
        ],
      })
      .expect(201);

    expect(response.body).toEqual(
      expect.objectContaining({
        updated: 0,
        skippedStale: 1,
      }),
    );

    const unchangedBalance = await employeeBalanceRepository.findOne({
      where: { employeeId: 'emp-004', locationId: 'loc-tor' },
    });
    expect(unchangedBalance?.balance).toBe(9);
  });
});
