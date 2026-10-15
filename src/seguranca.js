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
  return crypto.timingSafeEqual(calculado, Buffer.from(hash, 'hex'));
}

export const novoToken = () => crypto.randomBytes(24).toString('hex');
