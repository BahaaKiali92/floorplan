package com.acme.shop.orders;

import com.acme.shop.shared.Money;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;

@Entity
public class Order {
    @Id
    private Long id;
    private Long customerId;
    private String product;
    private int quantity;
    private Money unitPrice;
    private OrderStatus status = OrderStatus.NEW;

    public Long getId() { return id; }
    public Long getCustomerId() { return customerId; }
    public String getProduct() { return product; }
    public int getQuantity() { return quantity; }
    public Money getUnitPrice() { return unitPrice; }
    public OrderStatus getStatus() { return status; }
    public void setStatus(OrderStatus status) { this.status = status; }
}
