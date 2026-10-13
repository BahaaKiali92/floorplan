package org.springframework.web.bind.annotation;
import java.lang.annotation.*;
@Retention(RetentionPolicy.RUNTIME)
public @interface GetMapping {
    String[] value() default {};
    String[] path() default {};
    String[] topics() default {};
    String[] produces() default {};
}
