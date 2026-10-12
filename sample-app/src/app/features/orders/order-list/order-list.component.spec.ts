import { OrderListComponent } from './order-list.component';

describe('OrderListComponent', () => {
  const ordersService = jasmine.createSpyObj('OrdersService', ['getOrders', 'exportCsv', 'exportPdf']);
  it('downloads csv', () => {
    ordersService.exportCsv.and.returnValue('a;b');
  });
});
