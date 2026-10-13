package com.acme.shop.orders;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.Test;

class OrderControllerTest {
    private final OrderService orderService = mock(OrderService.class);
    private final OrderController controller = new OrderController(orderService, mock(OrderRepository.class));

    @Test
    void exportDelegates() {
        when(orderService.exportCsv()).thenReturn("csv");
        controller.export();
        verify(orderService).exportCsv();
    }
}
