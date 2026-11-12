import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

export interface CreateOrderDto {
  item: string;
  quantity: number;
}

export interface Order extends CreateOrderDto {
  id: number;
  createdAt: string;
}

@Injectable()
export class OrdersService {
  private readonly orders = new Map<number, Order>();
  private nextId = 1;

  /** Simulates a slow write, so a retry sent meanwhile gets 409. */
  async create(dto: CreateOrderDto): Promise<Order> {
    if (typeof dto?.item !== 'string' || !Number.isInteger(dto?.quantity) || dto.quantity < 1) {
      throw new BadRequestException('item must be a string and quantity a positive integer');
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const order: Order = { id: this.nextId++, ...dto, createdAt: new Date().toISOString() };
    this.orders.set(order.id, order);
    return order;
  }

  find(id: number): Order {
    const order = this.orders.get(id);
    if (!order) throw new NotFoundException(`Order ${id} not found`);
    return order;
  }

  count(): number {
    return this.orders.size;
  }

  quote(dto: CreateOrderDto): { item: string; quantity: number; total: number } {
    return { item: dto.item, quantity: dto.quantity, total: dto.quantity * 9.99 };
  }
}
