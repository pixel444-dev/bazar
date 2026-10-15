import fs from 'node:fs';
import path from 'node:path';

const MANTER_LOCAL = 60;

function carimbo(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

// Faz uma cópia consistente do banco (VACUUM INTO) em data/backups e, se configurado,
// numa pasta extra (ex.: pendrive) junto com as fotos de comprovantes.
export function criarBackup(db, pastaDados, pastaExtra) {
  const pasta = path.join(pastaDados, 'backups');
  const pastaComprovantes = path.join(pastaDados, 'comprovantes');
  let ultimo = null;

  function fazer() {
    fs.mkdirSync(pasta, { recursive: true });
    let nome = `bazar_${carimbo()}.db`;
    for (let n = 2; fs.existsSync(path.join(pasta, nome)); n++) nome = `bazar_${carimbo()}_${n}.db`;
    const destino = path.join(pasta, nome);
    db.exec(`VACUUM INTO '${destino.replaceAll("'", "''")}'`);

    const antigos = fs.readdirSync(pasta).filter((n) => n.startsWith('bazar_') && n.endsWith('.db')).sort();
    for (const n of antigos.slice(0, Math.max(0, antigos.length - MANTER_LOCAL))) fs.rmSync(path.join(pasta, n), { force: true });

    ultimo = { quando: Date.now(), arquivo: destino, extra: null, erro_extra: null };
    const extra = String(pastaExtra() ?? '').trim();
    if (extra) {
      try {
        fs.mkdirSync(extra, { recursive: true });
        fs.copyFileSync(destino, path.join(extra, nome));
        fs.copyFileSync(destino, path.join(extra, 'bazar_ULTIMO.db'));
        if (fs.existsSync(pastaComprovantes)) {
          fs.cpSync(pastaComprovantes, path.join(extra, 'comprovantes'), { recursive: true, force: false });
        }
        ultimo.extra = extra;
      } catch (e) {
        ultimo.erro_extra = `Não consegui copiar para ${extra}: ${e.message}`;
      }
    }
    return ultimo;
  }

  return { fazer, ultimo: () => ultimo };
}
