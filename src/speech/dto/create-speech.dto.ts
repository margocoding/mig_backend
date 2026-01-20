import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateSpeechDto {
  @ApiPropertyOptional({ title: 'Name', example: 'The last speech' })
  @IsOptional()
  @IsString()
  name: string;

  @ApiProperty({ title: 'Is speech group', example: true })
  @IsBoolean()
  isGroup: boolean;

  @ApiPropertyOptional({ title: 'Price', example: 5000 })
  @IsOptional()
  @IsInt()
  price: number;

  @ApiPropertyOptional({ title: 'Single photos price', example: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(501)
  singlePhotoPrice: number;

  @ApiProperty({ title: 'Flow ID', example: 'dfjaskfl3424lfa34' })
  @IsString()
  flowId: string;
}
