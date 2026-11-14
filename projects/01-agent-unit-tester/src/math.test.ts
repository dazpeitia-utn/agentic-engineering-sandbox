import { describe, it, expect } from 'vitest';
import { sumar, dividir } from './math.js';

describe('sumar', () => {
  it('debería retornar 3 cuando se suman 1 y 2', () => {
    expect(sumar(1, 2)).toBe(3);
  });

  it('debería retornar -1 cuando se suman -3 y 2', () => {
    expect(sumar(-3, 2)).toBe(-1);
  });

  it('debería retornar 0 cuando se suman 0 y 0', () => {
    expect(sumar(0, 0)).toBe(0);
  });
});

describe('dividir', () => {
  it('debería retornar 2 cuando se dividen 4 y 2', () => {
    expect(dividir(4, 2)).toBe(2);
  });

  it('debería retornar 1.5 cuando se dividen 3 y 2', () => {
    expect(dividir(3, 2)).toBe(1.5);
  });

  it('debería lanzar un error cuando se intenta dividir por cero', () => {
    expect(() => dividir(4, 0)).toThrow('No se puede dividir por cero');
  });
});
