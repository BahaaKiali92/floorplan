package com.acme.shop.shared;

public class NotFoundException extends RuntimeException {
    public NotFoundException(String what, Object id) {
        super(what + " " + id + " not found");
    }
}
