import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsNumber, IsOptional, IsString } from 'class-validator';

export class ProcessEventZipDto {
  @ApiPropertyOptional({ title: 'Event zip deadline', example: '2025-12-23' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  orderDeadline?: Date;
}

export class InitEventZipUploadDto extends ProcessEventZipDto {
  @ApiPropertyOptional({ title: 'Original archive filename' })
  @IsOptional()
  @IsString()
  filename?: string;

  @ApiPropertyOptional({ title: 'Expected archive size in bytes' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  size?: number;
}
