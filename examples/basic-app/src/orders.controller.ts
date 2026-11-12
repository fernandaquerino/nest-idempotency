import { Body, Controller, Get, Header, Param, ParseIntPipe, Post } from '@nestjs/common';
import { Idempotent } from 'nest-idempotency';
import type { CreateOrderDto } from './orders.service';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  /** The Idempotency-Key header is required: retries never create a second order. */
  @Post()
  @Idempotent()
  @Header('Cache-Control', 'no-store')
  create(@Body() dto: CreateOrderDto) {
    return this.orders.create(dto);
  }

  /** The header is optional: without it the route behaves like any other route. */
  @Post('quote')
  @Idempotent({ required: false })
  quote(@Body() dto: CreateOrderDto) {
    return this.orders.quote(dto);
  }

  @Get('count')
  count() {
    return { count: this.orders.count() };
  }

  @Get(':id')
  find(@Param('id', ParseIntPipe) id: number) {
    return this.orders.find(id);
  }
}
