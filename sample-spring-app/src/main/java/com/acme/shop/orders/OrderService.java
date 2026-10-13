package com.acme.shop.orders;

import com.acme.shop.customers.Customer;
import com.acme.shop.customers.CustomerRepository;
import com.acme.shop.shared.NotFoundException;
import java.time.Instant;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class OrderService {
    private static final String CSV_HEADER = "id;customer;product;quantity;status";

    private final OrderRepository orderRepository;
    // Seeded issue: uses another feature's repository instead of its service.
    private final CustomerRepository customerRepository;

    private int exportCount = 0;
    private Instant lastExportAt;

    public OrderService(OrderRepository orderRepository, CustomerRepository customerRepository) {
        this.orderRepository = orderRepository;
        this.customerRepository = customerRepository;
    }

    public List<OrderDto> findAll() {
        return orderRepository.findAll().stream().map(this::toDto).toList();
    }

    public OrderDto findById(Long id) {
        return toDto(load(id));
    }

    @Transactional
    public void cancel(Long id) {
        Order order = load(id);
        order.setStatus(OrderStatus.CANCELLED);
        orderRepository.save(order);
    }

    public String exportCsv() {
        StringBuilder csv = new StringBuilder(CSV_HEADER).append('\n');
        for (Order order : orderRepository.findAll()) {
            csv.append(formatCsvRow(order)).append('\n');
        }
        exportCount++;
        lastExportAt = Instant.now();
        return csv.toString();
    }

    public String stats() {
        return "exports: " + exportCount + ", orders: " + orderRepository.count();
    }

    private String formatCsvRow(Order order) {
        return String.join(";", String.valueOf(order.getId()), customerName(order), order.getProduct(),
                String.valueOf(order.getQuantity()), order.getStatus().name());
    }

    private String customerName(Order order) {
        return customerRepository.findById(order.getCustomerId()).map(Customer::getName).orElse("?");
    }

    private Order load(Long id) {
        return orderRepository.findById(id).orElseThrow(() -> new NotFoundException("Order", id));
    }

    private OrderDto toDto(Order order) {
        return new OrderDto(order.getId(), customerName(order), order.getProduct(), order.getQuantity(), order.getStatus().name());
    }
}
