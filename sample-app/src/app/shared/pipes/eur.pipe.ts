import { Pipe, PipeTransform } from '@angular/core';
@Pipe({ name: 'eur', standalone: true })
export class EurPipe implements PipeTransform { transform(v: number) { return v; } }
