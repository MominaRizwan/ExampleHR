import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { HCMIntegrationService } from './hcm-integration.service';
import { HCMIntegrationEvent } from './hcm-integration.entity';
import { SyncBalancesDto } from './dto/sync-balance.dto';
import { HCMSyncAuthGuard } from './guards/hcm-sync-auth.guard';

@Controller('hcm')
export class HCMIntegrationController {
  constructor(private readonly hcmIntegrationService: HCMIntegrationService) {}

  @Get('events')
  findAll(): Promise<HCMIntegrationEvent[]> {
    return this.hcmIntegrationService.findAll();
  }

  @Post('sync')
  @UseGuards(HCMSyncAuthGuard)
  syncBalances(@Body() syncBalancesDto: SyncBalancesDto) {
    return this.hcmIntegrationService.syncBalances(syncBalancesDto);
  }
}
