// Minimal type stubs so the sample compiles without node_modules. Real projects use @angular/* types.
declare module '@angular/core' {
  export function inject<T>(token: abstract new (...args: any[]) => T): T;
  export function Injectable(options?: any): ClassDecorator;
  export function Component(options: any): ClassDecorator;
  export function Directive(options: any): ClassDecorator;
  export function Pipe(options: any): ClassDecorator;
  export interface PipeTransform { transform(value: any, ...args: any[]): any; }
  export interface Signal<T> { (): T; }
  export interface WritableSignal<T> extends Signal<T> { set(v: T): void; }
  export function signal<T>(initial: T): WritableSignal<T>;
  export type ApplicationConfig = any;
}
declare module '@angular/common/http' {
  export class HttpClient { get<T>(url: string): { subscribe(fn: (v: T) => void): void }; }
  export type HttpInterceptorFn = (req: any, next: any) => any;
  export function provideHttpClient(...a: any[]): any;
  export function withInterceptors(a: any[]): any;
}
declare module '@angular/router' {
  export type Routes = any[];
  export function provideRouter(r: any): any;
}
declare const jasmine: any;
declare function describe(name: string, fn: () => void): void;
declare function it(name: string, fn: () => void): void;
