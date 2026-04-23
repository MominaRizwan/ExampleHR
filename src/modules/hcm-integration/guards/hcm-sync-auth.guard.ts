import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

@Injectable()
export class HCMSyncAuthGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      body: unknown;
    }>();

    const configuredToken = this.configService.getOrThrow<string>('HCM_SYNC_SERVICE_TOKEN');
    const headerToken = this.readHeader(request.headers, 'x-service-token');

    if (!headerToken || headerToken !== configuredToken) {
      throw new UnauthorizedException('Invalid service token');
    }

    const signingSecret = this.configService.get<string>('HCM_SYNC_SIGNING_SECRET');
    if (!signingSecret) {
      return true;
    }

    const providedSignature = this.readHeader(request.headers, 'x-signature');
    const providedTimestamp = this.readHeader(request.headers, 'x-timestamp');
    if (!providedSignature || !providedTimestamp) {
      throw new UnauthorizedException('Missing signature headers');
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const timestampSeconds = Number(providedTimestamp);
    const ttl = this.configService.get<number>('HCM_SYNC_SIGNATURE_TTL_SECONDS', 300);
    if (!Number.isFinite(timestampSeconds) || Math.abs(nowSeconds - timestampSeconds) > ttl) {
      throw new UnauthorizedException('Signature timestamp outside allowed window');
    }

    const payload = `${providedTimestamp}.${JSON.stringify(request.body ?? {})}`;
    const expected = createHmac('sha256', signingSecret).update(payload).digest('hex');

    if (!this.safeEqual(providedSignature, expected)) {
      throw new UnauthorizedException('Invalid request signature');
    }

    return true;
  }

  private readHeader(
    headers: Record<string, string | string[] | undefined>,
    key: string,
  ): string | null {
    const value = headers[key];
    if (Array.isArray(value)) {
      return value[0] ?? null;
    }

    return value ?? null;
  }

  private safeEqual(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);

    if (left.length !== right.length) {
      return false;
    }

    return timingSafeEqual(left, right);
  }
}
