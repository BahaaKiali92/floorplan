package com.acme.shop.orders;

import java.util.List;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/orders")
public class OrderController {
    private final OrderService orderService;
    // Seeded issue: a controller using a repository directly.
    private final OrderRepository orderRepository;

    public OrderController(OrderService orderService, OrderRepository orderRepository) {
        this.orderService = orderService;
        this.orderRepository = orderRepository;
    }

    @GetMapping
    public List<OrderDto> list() {
        return orderService.findAll();
    }

    @GetMapping("/{id}")
    public OrderDto get(@PathVariable("id") Long id) {
        return orderService.findById(id);
    }

    @DeleteMapping("/{id}")
    public void cancel(@PathVariable("id") Long id) {
        orderService.cancel(id);
    }

    @GetMapping(value = "/export", produces = "text/csv")
    public String export() {
        return orderService.exportCsv();
    }

    @GetMapping("/count")
    public long count() {
        return orderRepository.count();
    }
}
