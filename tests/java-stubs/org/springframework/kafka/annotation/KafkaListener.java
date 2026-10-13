package org.springframework.kafka.annotation;
import java.lang.annotation.*;
@Retention(RetentionPolicy.RUNTIME)
public @interface KafkaListener {
    String[] value() default {};
    String[] path() default {};
    String[] topics() default {};
    String[] produces() default {};
}
