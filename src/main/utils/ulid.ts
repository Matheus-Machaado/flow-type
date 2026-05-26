/**
 * Wrapper sobre o package `ulid`. Centraliza pra facilitar mock em testes
 * e eventual swap futuro (UUIDv7 etc).
 */

import { ulid as ulidFn } from 'ulid';

export function newId(): string {
  return ulidFn();
}

export { ulidFn as ulid };
