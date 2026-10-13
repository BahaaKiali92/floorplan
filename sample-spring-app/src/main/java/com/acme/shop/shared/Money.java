package com.acme.shop.shared;

import java.math.BigDecimal;
import java.math.RoundingMode;

/** Amounts in EUR, always two decimals. */
public record Money(BigDecimal amount) {
    public static Money of(String value) {
        return new Money(new BigDecimal(value).setScale(2, RoundingMode.HALF_UP));
    }

    public Money plus(Money other) {
        return new Money(amount.add(other.amount));
    }

    public Money times(int quantity) {
        return new Money(amount.multiply(BigDecimal.valueOf(quantity)));
    }
}
