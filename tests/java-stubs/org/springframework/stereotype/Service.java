package org.springframework.stereotype;
import java.lang.annotation.*;
@Retention(RetentionPolicy.RUNTIME)
public @interface Service {
    String[] value() default {};
    String[] path() default {};
    String[] topics() default {};
    String[] produces() default {};
}
