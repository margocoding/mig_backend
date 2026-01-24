import { ApiProperty } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { MemberRdo } from 'src/member/rdo/member.rdo';

export class SpeechRdo {
  @ApiProperty({ title: 'ID', example: 'klkjfdlskjadsf1234' })
  @IsString()
  @Expose()
  id: string;

  @ApiProperty({ title: 'Name', example: 'The last speech', required: false })
  @IsOptional()
  @IsString()
  @Expose()
  name: string;

  @ApiProperty({ title: 'Flow ID', example: 'dfjaskfl3424lfa34' })
  @IsString()
  @Expose()
  flowId: string;

  @ApiProperty({ title: 'Single photos price', example: 500 })
  @IsInt()
  @Expose()
  singlePhotoPrice: number;

  @ApiProperty({ title: 'Price', example: 2000 })
  @IsInt()
  @Min(501)
  @Expose()
  price: number;

  @ApiProperty({ title: 'Is speech group', example: true })
  @IsBoolean()
  @Expose()
  isGroup: boolean;

  @ApiProperty({ title: 'Members', type: [MemberRdo] })
  @ValidateNested({ each: true })
  @Type(() => MemberRdo)
  @Expose()
  members: MemberRdo[];
}
