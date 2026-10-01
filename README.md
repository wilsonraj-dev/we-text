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

- `GET /api/documents/{slug}` retorna `200` com o documento, `404` se ele não existir ou `401` se estiver protegido e o token estiver ausente, inválido ou expirado. A consulta não cria registros.
- `PUT /api/documents/{slug}` recebe `{ "content": "texto" }` e retorna `201` ao criar ou `200` ao atualizar. Documentos protegidos exigem token válido; sem ele, retorna `401` e não altera o texto.
- `POST /api/documents/{slug}/password` recebe `{ "password": "minha-senha" }` e protege um documento público existente. Retorna `200` com `{ "token": "...", "expiresAt": "..." }`, `400` para senha inválida ou `404` para documento inexistente. Não cria um documento nem substitui uma senha já definida: se já estiver protegido, retorna `401` sem acesso válido ou `409` com acesso válido.
- `POST /api/documents/{slug}/unlock` recebe `{ "password": "minha-senha" }` e retorna `200` com um novo token e sua expiração. Senha incorreta retorna `401`; documento inexistente retorna `404`; documento público ou body inválido retorna `400`.

Slugs aceitam de 1 a 100 caracteres: letras ASCII, números, `_` e `-`; o primeiro caractere deve ser letra ou número. O índice `UNIQUE` no PostgreSQL garante um documento por slug. O editor usa debounce de 500 ms e exibe o estado do salvamento. Edições simultâneas seguem a regra de última gravação vence.

## Banco de dados

O Compose expõe a porta `5432`, cria o banco `wetext` com usuário `wetext` e senha de desenvolvimento `wetext_dev`. A connection string está em `backend/WeText.Api/appsettings.json` e pode ser sobrescrita pela variável de ambiente `ConnectionStrings__Postgres`.

Para parar o banco:

```bash
docker compose down
```

O volume `postgres_data` conserva os documentos após `docker compose down`. A API usa migrations do EF Core; ela não cria o esquema automaticamente.

## Proteção opcional por senha

Para atualizar uma instalação existente, pare a API e execute `dotnet ef database update` em `backend/WeText.Api`, depois inicie-a novamente com `dotnet run`. A migration `AddDocumentPassword` adiciona somente a coluna nullable `PasswordHash`. Documentos anteriores continuam públicos e mantêm seu conteúdo.

1. Acesse `/wilson`, escreva e aguarde **Salvo**. Para documentos novos, a proteção fica disponível após o primeiro salvamento.
2. Escolha **Proteger com senha**, informe e confirme uma senha de 6 a 128 caracteres. O cliente atual recebe acesso imediatamente e pode continuar editando.
3. Abra a mesma URL em outro navegador ou janela anônima: a interface apresenta a tela de senha e não exibe o editor.
4. Uma senha incorreta mostra **Senha incorreta.**. A senha correta libera o editor com o conteúdo existente.
5. Atualize a página: o acesso continua enquanto o token for válido. Outro documento público continua funcionando sem senha.

O Angular guarda apenas o token em `sessionStorage`, na chave `we-text:document-token:<slug>`, e o envia no header `X-Document-Token` nas leituras e gravações. A senha não é persistida pelo frontend nem enviada em URLs. Tokens inválidos ou expirados são removidos e a tela de senha reaparece. Se uma gravação for rejeitada por perda de acesso, o rascunho permanece em memória nesta página e é salvo depois de desbloquear novamente; atualizar a página antes disso descarta esse rascunho.

Cada token usa 32 bytes aleatórios criptograficamente seguros, vale por **6 horas** e autoriza somente o documento para o qual foi emitido. Os tokens ficam na memória de uma única instância da API: reiniciar o backend invalida os acessos, exigindo novo desbloqueio. Não há renovação automática do prazo.

O hash usa [`PasswordHasher<Document>`](https://learn.microsoft.com/en-us/dotnet/api/microsoft.aspnetcore.identity.passwordhasher-1?view=aspnetcore-10.0), sem configurar Identity ou autenticação de usuários. A geração do token usa [`RandomNumberGenerator.GetBytes`](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.randomnumbergenerator.getbytes?view=net-10.0). A API retorna DTOs que nunca incluem senha ou hash e impede o armazenamento de suas respostas em cache. A proteção controla o acesso pela aplicação; o conteúdo permanece armazenado normalmente no PostgreSQL. Não há remoção, alteração ou recuperação de senha nesta etapa.

### Conferir a proteção pela API

Sem token, `GET /api/documents/wilson` de um documento protegido retorna `401` com apenas:

```json
{ "slug": "wilson", "isProtected": true }
```

O conteúdo só é retornado quando a requisição inclui `X-Document-Token: <token>`. Um `PUT` sem token válido também retorna `401` e mantém o conteúdo anterior. Para obter um token, envie a senha no body de `POST /api/documents/wilson/unlock`. Usar esse token para ler ou alterar outro documento protegido retorna `401`.

Com PostgreSQL e API em execução na configuração local padrão, você também pode executar uma verificação simples na raiz:

```bash
node scripts/verify-document-protection.mjs
```

O script verifica leitura e gravação protegidas, senhas incorretas, isolamento de tokens e documentos públicos. Ele cria documentos com nomes aleatórios e remove somente esses documentos do banco do Compose ao terminar. Não modifica documentos existentes.
