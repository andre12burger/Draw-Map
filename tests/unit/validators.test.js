import { describe, expect, it } from 'vitest';
import {
  analisarCoordenada,
  normalizarPerfil,
  validarLonLats,
  validarTermoBusca,
} from '../../server/lib/validators.js';

describe('validators', () => {
  it('aceita e normaliza pares lon,lat', () => {
    const resultado = validarLonLats('-52.0986,-32.0332|-52.1,-32.04');
    expect(resultado.valido).toBe(true);
    expect(resultado.pontos).toBe(2);
    expect(resultado.valor).toBe('-52.0986,-32.0332|-52.1,-32.04');
  });

  it('rejeita ausência, ponto único e coordenadas fora do intervalo', () => {
    expect(validarLonLats(undefined).valido).toBe(false);
    expect(validarLonLats('-52,-32').valido).toBe(false);
    expect(validarLonLats('-181,-32|-52,-32').valido).toBe(false);
    expect(validarLonLats('-52,-91|-52,-32').valido).toBe(false);
  });

  it('bloqueia injeção de parâmetros na string de coordenadas', () => {
    expect(validarLonLats('-52,-32&profile=car|-52,-33').valido).toBe(false);
    expect(validarLonLats('-52,-32;drop|-52,-33').valido).toBe(false);
    expect(validarLonLats('-52,-32|').valido).toBe(false);
  });

  it('limita a 50 pontos', () => {
    const pontos = Array.from({ length: 51 }, (_, i) => `${i / 10},${i / 10}`).join('|');
    const resultado = validarLonLats(pontos);
    expect(resultado.valido).toBe(false);
    expect(resultado.erro).toContain('50');
  });

  it('aplica allowlist de perfis', () => {
    expect(normalizarPerfil('trekking')).toBe('trekking');
    expect(normalizarPerfil('naoexiste')).toBe('shortest');
    expect(normalizarPerfil('shortest&format=gpx')).toBe('shortest');
    expect(normalizarPerfil(undefined)).toBe('shortest');
  });

  it('valida termos de busca', () => {
    expect(validarTermoBusca('  Praça   Saraiva  ').valor).toBe('Praça Saraiva');
    expect(validarTermoBusca('a').valido).toBe(false);
    expect(validarTermoBusca('x'.repeat(201)).valido).toBe(false);
    expect(validarTermoBusca('Rio\u0000Grande').valor).toBe('Rio Grande');
  });

  it('analisa coordenadas individuais', () => {
    expect(analisarCoordenada('-52.1,-32.0')).toEqual({ lon: -52.1, lat: -32 });
    expect(analisarCoordenada('-52.1')).toBeNull();
    expect(analisarCoordenada('-52.1,-32.0,99')).toBeNull();
    expect(analisarCoordenada('abc,def')).toBeNull();
  });
});
