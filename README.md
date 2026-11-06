# Pasta de Magic

Uma pasta virtual para folhear uma coleção de cartas de Magic. O site é só HTML, CSS e JS, hospedado no GitHub Pages. Dados e imagens vêm da [Scryfall](https://scryfall.com) e ficam gravados no repositório, então o site não faz nenhuma chamada à Scryfall.

## Atualizar a coleção

1. Edite `data/collection.csv`, com uma linha por impressão:

   ```csv
   set,collector_number,lang,foil,qty
   m11,149,en,false,4
   dmu,40,pt,false,1
   ```

   `set` e `collector_number` aparecem na página da carta na Scryfall. `lang` usa os códigos da Scryfall (`en`, `pt`, `ja`...).

2. Gere os dados e as imagens (precisa de Node 18 ou mais novo):

   ```bash
   node scripts/build-cards.mjs
   ```

   Imagens já baixadas são reaproveitadas. Se uma linha der erro, o script informa o número dela e não altera `data/cards.json`.

3. Faça commit e push. O GitHub Pages publica sozinho.

## Rodar localmente

O site precisa de um servidor, porque abrir o arquivo direto do disco bloqueia o `fetch` do JSON:

```bash
python3 -m http.server 8123
```

Depois abra http://localhost:8123.

## Cartas em português

A Scryfall tem imagens reais para as edições recentes, mas algumas impressões antigas usam a imagem em inglês com o selo "Localized Image Not Available". Os metadados não distinguem esses casos com segurança, porque os dois aparecem como `lowres`. Vale olhar as cartas em português depois de gerar os dados.

## Preço

O botão "Ver preço" abre a página da carta na Liga Magic. O link usa o nome em inglês e, em cartas de 2 faces, só o nome da frente. O preço não aparece no próprio site porque a Liga Magic não tem API pública.

## Aviso legal

Conteúdo de fã não oficial, permitido pela Política de Conteúdo de Fãs. Não é aprovado nem endossado pela Wizards. Partes dos materiais usados são propriedade da Wizards of the Coast. ©Wizards of the Coast LLC.
