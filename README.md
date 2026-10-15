# Sistema do Bazar de Móveis

Sistema de vendas que funciona **sem internet**, só com a rede local de um roteador.
Um notebook vira a central; vendedores usam o próprio celular pelo navegador e os caixas usam notebooks.

O que ele resolve:

- **Nenhum móvel é vendido duas vezes.** Quando o vendedor digita o número da etiqueta, o móvel fica
  reservado no nome dele na hora. Se outro vendedor tentar, aparece "Já reservado por Ana (pedido #12)".
- **Sem fichas de papel.** Nome, telefone e endereço de entrega ficam no sistema.
- **Controle do caixa.** Cada pagamento é registrado como dinheiro, Pix, cartão ou **pagamento na entrega**
  (pode dividir), com cálculo de troco e foto opcional do comprovante Pix.
- **Romaneio de entrega** em A4, agrupado por cidade e bairro, com a lista do que carregar no caminhão.

## Como ligar

1. Ligue o roteador e conecte o notebook central no Wi-Fi dele.
2. Dê dois cliques em **`iniciar.bat`**. Uma janela preta abre mostrando os endereços. **Não feche essa janela.**
3. Na primeira vez, o Windows pergunta se libera o Node.js no firewall: marque **Redes privadas** e permita.
4. No notebook, abra `http://localhost:3000` e entre como **Admin**, PIN **1234**. Troque o PIN em *Equipe, cidades e tipos*.

Para os celulares, abra *Configurações → Acesso dos celulares* e imprima a página com os QR codes
(Wi-Fi e endereço do sistema). Cole na entrada do galpão.

> Dica: no roteador, reserve um IP fixo para o notebook central (DHCP estático). Assim o endereço
> impresso no QR code não muda de um dia para o outro.

## Antes do bazar

1. **Equipe, cidades e tipos:** cadastre vendedores, caixas (cada um com PIN), as cidades atendidas na entrega e os tipos de móvel que faltarem (também dá para criar um tipo na hora, pela opção "+ Novo tipo…" no cadastro do móvel).
2. **Móveis e etiquetas:** crie as etiquetas (ex.: 300) e imprima em A4 (24 por folha). Cole nos móveis.
3. **Cadastro rápido:** com as etiquetas coladas, ande pelo galpão com o celular, digite o número, escolha
   o tipo e o preço. Ao salvar, ele já abre o próximo número com o mesmo tipo e preço preenchidos.
   Para vários iguais, use o **cadastro em lote** (ex.: do 001 ao 018, Cama, R$ 150).
4. Em *Configurações*, informe a pasta do pendrive para backup (ex.: `E:\backup-bazar`).
5. No *Painel*, a **Previsão de faturamento** mostra quanto entra se todos os móveis cadastrados forem
   vendidos pelo preço da etiqueta (e quanto disso já foi vendido). Etiquetas sem cadastro ainda não entram na conta.

## No dia

- **Vendedor:** digita o número → *Reservar* → *Continuar* → dados do cliente → *Finalizar*.
  Fala para o cliente: "vai no caixa e diz o número 47".
- **Caixa:** digita 47 → escolhe a forma de pagamento → *Confirmar*. O comprovante sai na térmica de 58 mm.
- **Ranking:** na aba *Ranking* do celular, cada vendedor vê a classificação ao vivo (valor vendido e móveis),
  em que lugar está e quanto falta para alcançar o próximo. Só conta venda já paga no caixa; se o vendedor
  subir de posição, aparece um aviso na tela mesmo que ele esteja em outra aba.
- A reserva vale **20 minutos** (configurável). Se o cliente demorar na fila e expirar, o caixa clica em
  *Reativar*: o sistema reserva de novo o que ainda estiver livre.
- **Pagamento na entrega:** o cliente paga ao entregador quando recebe o móvel. O caixa lança o valor no
  campo *Na entrega* (pode juntar com uma parte em Pix, por exemplo). O romaneio mostra em destaque
  **COBRAR DO CLIENTE NA ENTREGA** com o valor, e o comprovante do cliente avisa quanto ele vai pagar.
- **Fechamento:** aba *Fechamento do caixa* mostra dinheiro / Pix / cartão / na entrega de cada caixa.
  O valor "na entrega" não está na gaveta: é o que os entregadores vão cobrar.

Para imprimir o comprovante sem a janela de impressão aparecer toda vez, abra o Chrome do caixa com
`--kiosk-printing` e deixe a térmica como impressora padrão.

## Depois do bazar

- *Entregas:* marque cada pedido entregue. *Imprimir romaneio* gera a folha A4 para o motorista.
  Nos pedidos com pagamento na entrega, o sistema pergunta se o entregador recebeu o valor antes de marcar;
  o painel mostra quanto ainda falta cobrar.
- *Painel → Relatório de vendas (PDF)* abre o relatório em A4 para entregar ao dono do bazar: total vendido,
  formas de pagamento, fechamento de cada caixa, desempenho de cada vendedor, vendas por tipo, a lista de
  pedidos e os móveis que sobraram. Clique em *Salvar PDF / Imprimir* e escolha **Salvar como PDF** em *Destino*.
- *Painel → Planilha de vendas (Excel)* exporta tudo.

## Segurança dos dados

- O banco fica em `data\bazar.db`. A cada 3 minutos com mudanças é feito um backup em `data\backups`
  e, se configurado, no pendrive (junto com as fotos dos comprovantes).
- Se o notebook desligar, basta ligar de novo e rodar o `iniciar.bat`: nada se perde.
- Para restaurar um backup: feche a central, copie o arquivo de backup por cima de `data\bazar.db`
  e apague `bazar.db-wal` e `bazar.db-shm` se existirem.

## Para quem for mexer no código

- Node.js 22.13+ (usa o SQLite embutido `node:sqlite`). Única dependência: `qrcode`.
- `npm start` liga a central; `npm test` roda os testes (inclui dois vendedores disputando o mesmo móvel).
- `node server.js --porta 3100 --dados C:\outra\pasta` para testar sem mexer nos dados reais.
- Código: `src/vendas.js` (reserva, pagamento, expiração), `src/catalogo.js` (móveis e cadastros),
  `src/app.js` (rotas HTTP), `public/` (telas).
