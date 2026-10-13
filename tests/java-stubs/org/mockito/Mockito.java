package org.mockito;
public class Mockito {
    public static <T> T mock(Class<T> c) { return null; }
    public static <T> T verify(T mock) { return mock; }
    public static <T> OngoingStubbing<T> when(T call) { return new OngoingStubbing<>(); }
    public static class OngoingStubbing<T> { public OngoingStubbing<T> thenReturn(T value) { return this; } }
}
