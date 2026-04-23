import { IsOptional, IsString, Length } from 'class-validator';

export class ApproveTimeOffRequestDto {
  @IsOptional()
  @IsString()
  @Length(8, 128)
  approvalOperationId?: string;
}
