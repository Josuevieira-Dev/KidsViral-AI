# KidsViral AI

Plataforma web para roteiros infantis, personagens, projetos e geração de cenas em vídeo.

## Stack
- Node.js 20 + Express
- PostgreSQL
- OpenAI e/ou Google Gemini para roteiros
- MiniMax/Hailuo para geração de vídeo
- Interface web responsiva sem etapa de build

## Rodar localmente
1. Instale Node.js 20+ e PostgreSQL.
2. Crie o banco `kidsviral`.
3. Copie `.env.example` para `.env` e preencha `DATABASE_URL`, `JWT_SECRET` e as chaves dos provedores.
4. Execute:
   ```bash
   npm install
   npm run check
   npm start
   ```
5. Abra `http://localhost:3000`.

## Integrações de IA
- Roteiros: configure `OPENAI_API_KEY` e/ou `GEMINI_API_KEY`. Se as duas estiverem configuradas, a aplicação prioriza OpenAI.
- Vídeo: configure `MINIMAX_API_KEY`, com acesso à API de vídeo e saldo/créditos. `MINIMAX_GROUP_ID` é mantida como variável de compatibilidade para contas/fluxos que ainda a exijam.
- A integração MiniMax usa resolução 768P para permitir clipes de 6 ou 10 segundos; para preservar exatamente o enquadramento vertical 9:16, envie uma imagem de primeiro quadro vertical (o texto do prompt sozinho não fixa a proporção). A integração usa criação de tarefa em `/v1/video_generation`, consulta em `/v1/query/video_generation` e recuperação de arquivo em `/v1/files/retrieve`. Confira no portal MiniMax se a região e o modelo liberado para sua conta correspondem à configuração.
- A geração usa a fila assíncrona simplificada no processo web e é consultada pelo navegador. Para escala comercial, mover o executor para worker dedicado/Redis e adicionar retries e idempotência.

## Deploy Render
1. Crie um repositório GitHub e envie todos os arquivos.
2. No Render, escolha **New > Blueprint** e conecte o repositório que contém `render.yaml`.
3. Revise os serviços e clique em Apply.
4. Preencha os segredos `OPENAI_API_KEY`, `GEMINI_API_KEY` e `MINIMAX_API_KEY` no serviço.
5. Configure armazenamento persistente para uploads ou, preferencialmente, bucket S3 compatível. O upload local é apenas demonstração/desenvolvimento porque o filesystem do serviço Render pode ser efêmero.
6. Atualize `APP_URL` com o domínio real do serviço.

## Importante antes de comercializar
Este pacote é uma base funcional inicial, não uma plataforma SaaS pronta para cobrar clientes. Antes de abrir ao público: implemente verificação de e-mail, recuperação de senha, limites e cobrança por créditos, isolamento/quotas de arquivos, moderação de conteúdo, política de privacidade/LGPD, termos, logs, fila de worker persistente, armazenamento S3 e revisão de segurança. Proteja as chaves exclusivamente no servidor. Vídeos infantis devem ser originais, seguros e classificados corretamente como conteúdo destinado a crianças quando aplicável.
