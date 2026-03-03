import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsOptional, IsString } from 'class-validator';

export class ProcessEventZipDto {
  @ApiPropertyOptional({ title: 'Event zip deadline', example: '2025-12-23' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  orderDeadline?: Date;

  @ApiProperty({ title: 'Filename' })
  @IsString()
  filename: string;
}