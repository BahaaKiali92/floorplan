package com.acme.shop.shared;

import com.acme.shop.orders.Order;
import org.springframework.stereotype.Service;

// Seeded issue: an orders service placed in shared/, and shared/ depends on a feature.
@Service
public class OrderPricingService {
    public Money totalFor(Order order) {
        return order.getUnitPrice().times(order.getQuantity());
    }
}
