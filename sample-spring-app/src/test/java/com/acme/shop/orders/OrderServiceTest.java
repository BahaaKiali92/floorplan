package com.acme.shop.orders;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.acme.shop.customers.CustomerRepository;
import java.util.List;
import org.junit.jupiter.api.Test;

class OrderServiceTest {
    private final OrderRepository orderRepository = mock(OrderRepository.class);
    private final CustomerRepository customerRepository = mock(CustomerRepository.class);
    private final OrderService service = new OrderService(orderRepository, customerRepository);

    @Test
    void exportHasHeader() {
        when(orderRepository.findAll()).thenReturn(List.of());
        String csv = service.exportCsv();
        assert csv.startsWith("id;");
    }
}
