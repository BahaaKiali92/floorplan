package org.springframework.context.annotation;
import java.lang.annotation.*;
@Retention(RetentionPolicy.RUNTIME)
public @interface Bean {
    String[] value() default {};
    String[] path() default {};
    String[] topics() default {};
    String[] produces() default {};
}
