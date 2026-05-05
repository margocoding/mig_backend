import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { OrderService } from './order.service';
import { ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { OrdersRdo } from './rdo/orders.rdo';
import { AuthJwtGuard } from '../auth/auth.guard';
import { User } from '../../common/decorators/User';
import { UserRdo } from '../user/rdo/user.rdo';
import { SuccessRdo } from '../../common/rdo/success.rdo';
import { AdminGuard } from '../user/admin.guard';
import { ChangeOrderStatusDto } from './dto/change-order-status.dto';
import { FetchOrdersDto } from './dto/fetch-orders.dto';
import { OrderRdo } from './rdo/order.rdo';

@Controller('order')
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  @ApiOperation({ summary: 'Fetch all orders' })
  @ApiOkResponse({ type: OrdersRdo })
  @UseGuards(AuthJwtGuard)
  @Get('/')
  fetchOrders(@User() user: UserRdo, @Query() dto: FetchOrdersDto) {
    return this.orderService.getOrders(
      user.id,
      user.isAdmin,
      +(dto.page || 1),
      +(dto.limit || 15),
      dto.status,
    );
  }

  @ApiOperation({ summary: 'Skip proccessing' })
  @ApiOkResponse({ type: OrderRdo })
  @UseGuards(AuthJwtGuard)
  @Post('/skip-proccessing/:id')
  skipProccessing(@Param('id') id: string, @User() user: UserRdo) {
    return this.orderService.skipProccessing(id, user.id);
  }

  @ApiOperation({ summary: 'Change order status' })
  @ApiOkResponse({ type: SuccessRdo })
  @UseGuards(AuthJwtGuard, AdminGuard)
  @Put(`/status/:id`)
  changeStatus(@Param('id') id: string, @Body() dto: ChangeOrderStatusDto) {
    return this.orderService.changeStatus(id, dto.status);
  }

  @ApiOperation({ summary: 'Fetch order by id' })
  @ApiOkResponse({ type: OrderRdo })
  @UseGuards(AuthJwtGuard)
  @Get('/:id')
  fetchOrder(@Param('id') id: string, @User() user: UserRdo) {
    return this.orderService.getOrder(id, user.id, user.isAdmin);
  }
}
