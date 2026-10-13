package org.junit.jupiter.api;
import java.lang.annotation.*;
@Retention(RetentionPolicy.RUNTIME)
public @interface Test {
    String[] value() default {};
    String[] path() default {};
    String[] topics() default {};
    String[] produces() default {};
}
