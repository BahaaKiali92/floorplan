package org.springframework.stereotype;
import java.lang.annotation.*;
@Retention(RetentionPolicy.RUNTIME)
public @interface Component {
    String[] value() default {};
    String[] path() default {};
    String[] topics() default {};
    String[] produces() default {};
}
