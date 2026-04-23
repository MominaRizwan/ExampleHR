import { IsNumber, IsOptional, IsString, Length, Min } from 'class-validator';

export class CreateTimeOffRequestDto {
  @IsString()
  @Length(1, 64)
  employeeId: string;

  @IsString()
  @Length(1, 64)
  locationId: string;

  @IsNumber()
  @Min(0.5)
  daysRequested: number;

  @IsOptional()
  @IsString()
  @Length(8, 128)
  idempotencyKey?: string;
}
