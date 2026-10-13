package com.acme.shop.orders;

public record OrderDto(Long id, String customerName, String product, int quantity, String status) {
}
