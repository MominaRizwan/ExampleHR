import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNumber,
  IsString,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';

export class SyncBalanceItemDto {
  @IsString()
  @Length(1, 64)
  employeeId: string;

  @IsString()
  @Length(1, 64)
  locationId: string;

  @IsNumber()
  @Min(0)
  balance: number;

  @IsDateString()
  lastSyncedAt: string;
}

export class SyncBalancesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => SyncBalanceItemDto)
  balances: SyncBalanceItemDto[];
}
