import { UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { HCMSyncAuthGuard } from './hcm-sync-auth.guard';

describe('HCMSyncAuthGuard', () => {
  const configService = {
    getOrThrow: jest.fn(),
    get: jest.fn(),
  };

  const makeContext = (headers: Record<string, string>, body: unknown = {}) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ headers, body }),
      }),
    }) as never;

  beforeEach(() => {
    jest.resetAllMocks();
    configService.getOrThrow.mockReturnValue('svc-token');
    configService.get.mockImplementation((key: string, defaultValue?: unknown) => {
      if (key === 'HCM_SYNC_SIGNING_SECRET') return undefined;
      if (key === 'HCM_SYNC_SIGNATURE_TTL_SECONDS') return 300;
      return defaultValue;
    });
  });

  it('allows request with valid service token and no signature mode', () => {
    const guard = new HCMSyncAuthGuard(configService as never);
    expect(guard.canActivate(makeContext({ 'x-service-token': 'svc-token' }))).toBe(true);
  });

  it('rejects invalid service token', () => {
    const guard = new HCMSyncAuthGuard(configService as never);
    expect(() => guard.canActivate(makeContext({ 'x-service-token': 'wrong' }))).toThrow(
      UnauthorizedException,
    );
  });

  it('validates signature when signing secret is configured', () => {
    const now = Math.floor(Date.now() / 1000).toString();
    configService.get.mockImplementation((key: string, defaultValue?: unknown) => {
      if (key === 'HCM_SYNC_SIGNING_SECRET') return 'super-secret-signing';
      if (key === 'HCM_SYNC_SIGNATURE_TTL_SECONDS') return 300;
      return defaultValue;
    });
    const body = { balances: [{ employeeId: 'emp-1' }] };
    const signature = createHmac('sha256', 'super-secret-signing')
      .update(`${now}.${JSON.stringify(body)}`)
      .digest('hex');

    const guard = new HCMSyncAuthGuard(configService as never);
    expect(
      guard.canActivate(
        makeContext(
          {
            'x-service-token': 'svc-token',
            'x-timestamp': now,
            'x-signature': signature,
          },
          body,
        ),
      ),
    ).toBe(true);
  });
});
