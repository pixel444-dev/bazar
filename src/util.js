export class ErroHttp extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

export const reais = (centavos) =>
  (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const codigoFmt = (n) => String(n).padStart(3, '0');

export const texto = (v) => String(v ?? '').trim();

// Converte erros de restrição do SQLite em mensagens que o usuário entende.
export function traduzirErroBanco(e) {
  const msg = String(e?.message ?? '');
  if (msg.includes('UNIQUE constraint failed')) return new ErroHttp(409, 'Já existe um cadastro com esse nome.');
  if (msg.includes('FOREIGN KEY constraint failed')) return new ErroHttp(409, 'Não dá para excluir: esse cadastro está em uso.');
  return null;
}
