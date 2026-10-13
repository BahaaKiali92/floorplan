package org.springframework.stereotype;
import java.lang.annotation.*;
@Retention(RetentionPolicy.RUNTIME)
public @interface Repository {
    String[] value() default {};
    String[] path() default {};
    String[] topics() default {};
    String[] produces() default {};
}
