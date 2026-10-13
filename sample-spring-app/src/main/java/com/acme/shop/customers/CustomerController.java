package com.acme.shop.customers;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/customers")
public class CustomerController {
    private final CustomerService customerService;

    public CustomerController(CustomerService customerService) {
        this.customerService = customerService;
    }

    // Seeded warning: returns the JPA entity instead of a DTO.
    @GetMapping("/{id}")
    public Customer get(@PathVariable("id") Long id) {
        return customerService.findById(id);
    }
}
