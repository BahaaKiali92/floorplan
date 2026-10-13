package com.acme.shop.customers;

import com.acme.shop.shared.NotFoundException;
import org.springframework.stereotype.Service;

@Service
public class CustomerService {
    private final CustomerRepository customerRepository;

    public CustomerService(CustomerRepository customerRepository) {
        this.customerRepository = customerRepository;
    }

    public Customer findById(Long id) {
        return customerRepository.findById(id).orElseThrow(() -> new NotFoundException("Customer", id));
    }

    public String nameOf(Long id) {
        return findById(id).getName();
    }
}
