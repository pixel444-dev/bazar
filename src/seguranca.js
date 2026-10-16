import crypto from 'node:crypto';

export function hashPin(pin) {
  const sal = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pin), sal, 32).toString('hex');
  return `${sal}:${hash}`;
}

export function conferePin(pin, guardado) {
  const [sal, hash] = String(guardado).split(':');
  if (!sal || !hash) return false;
  const calculado = crypto.scryptSync(String(pin ?? ''), sal, 32);
  const esperado = Buffer.from(hash, 'hex');
  // timingSafeEqual lança erro se os tamanhos forem diferentes (PIN guardado danificado).
  return esperado.length === calculado.length && crypto.timingSafeEqual(calculado, esperado);
}

export const novoToken = () => crypto.randomBytes(24).toString('hex');
