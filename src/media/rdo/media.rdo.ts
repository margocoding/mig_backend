import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, IsString } from 'class-validator';

export class MediaRdo {
  @ApiProperty({ title: 'ID', example: 'cmgas45bsfdgq33g' })
  @IsString()
  @Expose()
  id: string;

  @ApiProperty({
    title: 'Preview',
    example: 'https://cloud.yandex.ru/preview/123.png',
  })
  @IsString()
  @Expose()
  preview: string;

  @ApiProperty({
    title: 'Preview',
    example: 'https://cloud.yandex.ru/original/123.png',
  })
  @IsOptional()
  @Expose()
  fullVersion: string;

  @ApiProperty({
    title: 'Media id',
    example: 'cmgas45bsfdgq33g',
  })
  @IsString()
  @Expose()
  eventId: string;

  @ApiProperty({ title: 'Order', example: 1 })
  @IsNumber()
  @Expose()
  order: number;
}
