# We-Text

MVP de bloco de notas online. Cada URL `/:slug` representa um documento independente. Abrir uma URL nova mostra um editor vazio; o documento só é criado no primeiro salvamento.

## Requisitos

- .NET SDK 10 e `dotnet-ef` 10
- Node.js 22.22.3 ou superior e npm
- Docker Desktop com o daemon em execução

Se o comando `dotnet ef` não existir, instale a ferramenta uma vez:

```bash
dotnet tool install --global dotnet-ef --version 10.0.5
```

## Executar localmente

Na raiz do projeto, inicie **somente o PostgreSQL**:

```bash
docker compose up -d
```

Em outro terminal, aplique a migration e inicie a API:

```bash
cd backend/WeText.Api
dotnet ef database update
dotnet run
```

A API escuta em `http://localhost:5036`.

Em mais um terminal, inicie o Angular:

```bash
cd frontend/we-text-web
npm install
npm start
```

O script `npm start` executa o Angular CLI local (`ng serve`). Acesse [http://localhost:4200/wilson](http://localhost:4200/wilson), escreva algo, aguarde **Salvo** e atualize a página. O conteúdo deve reaparecer. Acesse `/teste` para usar outro documento.

O Angular encaminha `/api/documents` para `http://localhost:5036` em desenvolvimento. Se mudar a porta da API, atualize `frontend/we-text-web/proxy.conf.json`.

## API

- `GET /api/documents/{slug}` retorna `200` com o documento ou `404` se ele não existir. A consulta não cria registros.
- `PUT /api/documents/{slug}` recebe `{ "content": "texto" }` e retorna `201` ao criar ou `200` ao atualizar.

Slugs aceitam de 1 a 100 caracteres: letras ASCII, números, `_` e `-`; o primeiro caractere deve ser letra ou número. O índice `UNIQUE` no PostgreSQL garante um documento por slug. O editor usa debounce de 500 ms e exibe o estado do salvamento. Edições simultâneas seguem a regra de última gravação vence.

## Banco de dados

O Compose expõe a porta `5432`, cria o banco `wetext` com usuário `wetext` e senha de desenvolvimento `wetext_dev`. A connection string está em `backend/WeText.Api/appsettings.json` e pode ser sobrescrita pela variável de ambiente `ConnectionStrings__Postgres`.

Para parar o banco:

```bash
docker compose down
```

O volume `postgres_data` conserva os documentos após `docker compose down`. A API usa migrations do EF Core; ela não cria o esquema automaticamente.
