import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { TimeOffRequestService } from './time-off-request.service';
import { TimeOffRequest } from './time-off-request.entity';
import { ApproveTimeOffRequestDto } from './dto/approve-time-off-request.dto';
import { CreateTimeOffRequestDto } from './dto/create-time-off-request.dto';
import { RejectTimeOffRequestDto } from './dto/reject-time-off-request.dto';

@Controller('time-off-requests')
export class TimeOffRequestController {
  constructor(private readonly timeOffRequestService: TimeOffRequestService) {}

  @Get()
  findAll(): Promise<TimeOffRequest[]> {
    return this.timeOffRequestService.findAll();
  }

  @Post()
  create(@Body() createDto: CreateTimeOffRequestDto): Promise<TimeOffRequest> {
    return this.timeOffRequestService.createRequest(createDto);
  }

  @Post(':id/approve')
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() approveDto: ApproveTimeOffRequestDto,
  ): Promise<TimeOffRequest> {
    return this.timeOffRequestService.approveRequest(id, approveDto);
  }

  @Post(':id/reject')
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() rejectDto: RejectTimeOffRequestDto,
  ): Promise<TimeOffRequest> {
    return this.timeOffRequestService.rejectRequest(id, rejectDto);
  }
}
