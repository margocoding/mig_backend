import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsDate, IsOptional } from "class-validator";

export class ProcessEventZipDto {
    @ApiPropertyOptional({ title: 'Event zip deadline', example: '2025-12-23'})
    @IsOptional()
    @Type(() => Date)
    @IsDate()
    orderDeadline?: Date;
}