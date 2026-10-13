package jakarta.persistence;
import java.lang.annotation.*;
@Retention(RetentionPolicy.RUNTIME)
public @interface Id {
    String[] value() default {};
    String[] path() default {};
    String[] topics() default {};
    String[] produces() default {};
}
