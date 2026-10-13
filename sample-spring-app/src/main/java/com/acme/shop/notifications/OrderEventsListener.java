package com.acme.shop.notifications;

import com.acme.shop.orders.OrderService;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

@Component
public class OrderEventsListener {
    private final OrderService orderService;

    public OrderEventsListener(OrderService orderService) {
        this.orderService = orderService;
    }

    @KafkaListener(topics = "payments.failed")
    public void onPaymentFailed(String orderId) {
        orderService.cancel(Long.valueOf(orderId));
    }
}
