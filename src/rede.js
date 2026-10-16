import os from 'node:os';

// Endereços IPv4 desta máquina na rede local (o que os celulares devem acessar).
export function enderecosLocais(porta) {
  let interfaces;
  try {
    interfaces = os.networkInterfaces();
  } catch {
    // Alguns adaptadores de rede no Windows fazem o Node falhar aqui; melhor mostrar "sem rede" do que cair.
    return [];
  }
  return Object.values(interfaces)
    .flat()
    .filter((i) => i && (i.family === 'IPv4' || i.family === 4) && !i.internal)
    .map((i) => `http://${i.address}${porta === 80 ? '' : `:${porta}`}`);
}

// Texto do QR code que conecta o celular direto no Wi-Fi.
export function textoWifi(nome, senha) {
  const escapar = (s) => String(s).replace(/([\\;,:"])/g, '\\$1');
  return senha ? `WIFI:T:WPA;S:${escapar(nome)};P:${escapar(senha)};;` : `WIFI:T:nopass;S:${escapar(nome)};;`;
}
