package org.springframework.boot.autoconfigure;
import java.lang.annotation.*;
@Retention(RetentionPolicy.RUNTIME)
public @interface SpringBootApplication {
    String[] value() default {};
    String[] path() default {};
    String[] topics() default {};
    String[] produces() default {};
}
