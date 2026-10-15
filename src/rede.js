import os from 'node:os';

// Endereços IPv4 desta máquina na rede local (o que os celulares devem acessar).
export function enderecosLocais(porta) {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && (i.family === 'IPv4' || i.family === 4) && !i.internal)
    .map((i) => `http://${i.address}${porta === 80 ? '' : `:${porta}`}`);
}

// Texto do QR code que conecta o celular direto no Wi-Fi.
export function textoWifi(nome, senha) {
  const escapar = (s) => String(s).replace(/([\\;,:"])/g, '\\$1');
  return senha ? `WIFI:T:WPA;S:${escapar(nome)};P:${escapar(senha)};;` : `WIFI:T:nopass;S:${escapar(nome)};;`;
}
