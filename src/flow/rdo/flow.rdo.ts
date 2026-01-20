import { ApiProperty } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsInt,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { SpeechRdo } from 'src/speech/rdo/speech.rdo';

export class FlowRdo {
  @ApiProperty({ title: 'ID', example: 'clz9q1h5f0000w3x5o4x1b2c3' })
  @IsString()
  @Expose()
  id: string;

  @ApiProperty({ title: 'Flow name', example: 'Opening Ceremony' })
  @IsString()
  @Expose()
  name: string;

  @ApiProperty({ title: 'Start date', example: '2025-10-07T09:00:00.000Z' })
  @IsDateString()
  @Expose()
  from: Date;

  @ApiProperty({ title: 'End date', example: '2025-10-07T11:00:00.000Z' })
  @IsDateString()
  @Expose()
  to: Date;

  @ApiProperty({ type: [SpeechRdo], title: 'Speeches attached to this flow' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SpeechRdo)
  @Expose()
  speeches: SpeechRdo[];

  @ApiProperty({ title: 'Event id', example: 'vjsdfkjghfgq345gfsd' })
  @IsString()
  @Expose()
  eventId: string;

  @ApiProperty({ title: 'Creation date', example: '2025-10-06T22:12:45.000Z' })
  @IsDateString()
  @Expose()
  createdAt: Date;
}
