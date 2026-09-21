# PRD — Hermes WebUI

> **Status:** Draft v0.1  
> **Data:** 20 de setembro de 2026  
> **Projeto:** `hermes-webui`  
> **Produto:** Hermes WebUI  
> **Tagline:** *A modern, chat-first web interface for Hermes Agent.*  
> **Plataforma inicial:** Web, self-hosted, single-host  
> **Runtime:** Hermes Agent existente  
> **Princípio central:** *Chat first. Administration when needed.*

---

## 1. Resumo executivo

Hermes WebUI é uma interface web moderna, local e chat-first para conversar com e administrar uma instalação existente do Hermes Agent.

O produto roda **no mesmo host do Hermes**, conecta-se às APIs e à configuração real do Hermes e, quando necessário, usa uma bridge local e restrita para operações disponíveis apenas na CLI. O objetivo é permitir que o usuário faça pela WebUI praticamente tudo que faria hoje pelo TUI, CLI, `config.yaml`, `.env` e dashboard oficial — porém com uma experiência coerente, organizada e confortável em desktop e mobile.

Hermes continua sendo o runtime e a fonte de verdade. A WebUI não implementa um segundo agente, um segundo sistema de sessões, um segundo scheduler ou uma configuração paralela.

A experiência de produto combina três referências:

- **OpenClaw:** arquitetura chat-first, sidebar de conversas, workspaces de Settings, painéis/docks contextuais e boa observabilidade do agente.
- **Claude:** baixo ruído visual, foco em leitura/escrita, composer compacto, sidebar recolhível e conteúdo complexo em painéis laterais.
- **Hermes:** runtime, sessões, tools, config, providers, skills, MCP, cron, memory, messaging, gateway, diagnostics, update e demais capacidades nativas.

A regra de projeto é:

> **Everything Hermes can do should be accessible here. Everything Hermes owns should remain owned by Hermes.**

---

## 2. Problema

O Hermes já possui muitas capacidades de operação e configuração, porém a experiência atual é fragmentada entre:

- TUI/CLI;
- dashboard web;
- edição manual de `config.yaml`;
- edição manual de `.env`;
- comandos específicos para gateway, providers, models, MCP, skills, memory, cron, LSP, messaging e outras áreas;
- logs e diagnósticos separados.

O dashboard oficial oferece uma superfície administrativa ampla, mas a experiência de chat ainda é fortemente herdada do terminal/TUI. Isso cria dois problemas:

1. **O chat não parece um produto web nativo.**
2. **A configuração é poderosa, mas exige conhecimento estrutural demais do Hermes.**

O objetivo do Hermes WebUI não é reduzir as opções disponíveis. É reduzir o esforço para encontrar, compreender e operar essas opções.

---

## 3. Visão do produto

O Hermes WebUI deve se tornar a interface diária principal para usuários do Hermes que preferem uma experiência visual moderna.

Ao abrir a aplicação, o usuário cai diretamente no último chat ou em uma nova conversa. Configurações e administração existem como um workspace separado, acessível quando necessário.

Arquitetura conceitual:

    Browser do usuário
            |
            | HTTP(S)
            v
    Hermes WebUI
    mesmo host do Hermes
            |
            +--> Hermes HTTP APIs
            +--> config.yaml / .env
            +--> CLI bridge restrita
            |
            v
        Hermes Agent
      Gateway / Sessions
       Tools / Runtime

A UI pode ser acessada por localhost, LAN, Tailscale ou reverse proxy, mas o serviço Hermes WebUI e o Hermes ficam no mesmo host na primeira versão.

---

## 4. Objetivos

### 4.1 Objetivos primários

1. Tornar o **chat a home** da aplicação.
2. Oferecer uma experiência de conversa nativa da web, sem xterm como superfície principal.
3. Expor sessões reais do Hermes em uma sidebar semelhante a ChatGPT/Claude/OpenClaw.
4. Renderizar tool calls, commentary, approvals e estados de execução como componentes web.
5. Permitir administrar o Hermes sem precisar abrir um terminal para operações normais.
6. Oferecer uma UI semântica para a configuração real do Hermes.
7. Preservar acesso avançado a raw config e CLI Hermes quando necessário.
8. Permitir reiniciar o Hermes/gateway/processo gerenciado sem derrubar a própria WebUI.
9. Funcionar bem em desktop e mobile desde o MVP.
10. Acompanhar mudanças do Hermes através de capability detection e schema-driven fallback.

### 4.2 Objetivos secundários

- Ser instalável com baixo atrito.
- Ser útil tanto para usuários avançados quanto para usuários que não querem decorar o YAML.
- Ser resiliente a mudanças de versão do Hermes.
- Permitir evolução futura para recursos adicionais sem transformar a aplicação em outro runtime.

---

## 5. Não objetivos

Na primeira versão, Hermes WebUI **não** deve:

- substituir o Hermes Agent;
- implementar um agente próprio;
- executar tools fora do Hermes;
- criar uma cópia própria do histórico de conversas;
- substituir memory, cron, skills, MCP ou messaging do Hermes;
- criar configuração operacional paralela ao `config.yaml`/`.env`;
- depender de Vercel, Cloudflare ou outro SaaS para funcionar;
- gerenciar vários hosts Hermes;
- oferecer shell arbitrário no navegador;
- tentar ser uma IDE completa;
- copiar OpenClaw ou Claude pixel a pixel;
- modificar internals privados do Hermes quando API/CLI pública for suficiente.

---

## 6. Princípios de produto

### 6.1 Chat first

Abrir Hermes WebUI significa abrir o chat.

A aplicação não deve iniciar em um dashboard com CPU, memória, status, analytics ou cards administrativos.

### 6.2 Administração quando necessária

Configurações, logs, diagnostics, providers, MCP, skills, cron e outras áreas ficam em **Settings/System**, sem competir visualmente com a conversa.

### 6.3 Hermes é a fonte de verdade

Sessões, mensagens, runs, models, config, env, credentials, MCP, skills, memory, cron e messaging pertencem ao Hermes.

A WebUI só armazena estado próprio de apresentação quando necessário.

### 6.4 UI semântica sobre configuração real

A WebUI deve traduzir configuração técnica em organização humana.

Exemplo:

    auxiliary.mcp.provider = example-provider
    auxiliary.mcp.model = example-model-small

deve aparecer como:

    Settings
      > Models
        > Auxiliary
          > MCP
            Provider: Example Provider
            Model: Example Model Small

O usuário avançado continua tendo acesso a **Raw Config**.

### 6.5 API first, config second, CLI bridge last

Ordem de preferência:

1. API nativa do Hermes;
2. configuração oficial do Hermes;
3. CLI oficial do Hermes através da bridge local.

A bridge não deve ser o caminho padrão quando existir uma API estável.

### 6.6 Progressive disclosure

Recursos avançados existem, mas não ficam permanentemente visíveis.

A UI deve diferenciar:

- uso cotidiano;
- configuração comum;
- configuração avançada;
- escape hatches.

### 6.7 Same-host by design

Na primeira versão, Hermes WebUI e Hermes rodam no mesmo host.

Isso simplifica:

- autenticação interna;
- filesystem;
- restart;
- CLI bridge;
- acesso à configuração;
- segurança;
- deployment;
- compatibilidade.

---

## 7. Referências de UX

### 7.1 OpenClaw

A principal referência é a geração atual da Web UI do OpenClaw, especialmente:

- chat como home;
- sidebar centrada em conversas;
- sessões fixadas e recentes;
- estados de atividade discretos;
- Settings como workspace próprio;
- painéis laterais/docks para conteúdo contextual;
- tool activity integrada ao transcript;
- operação de restart/update com progresso;
- redução de ruído administrativo.

O que deve ser copiado conceitualmente:

- arquitetura de informação;
- fluxo entre chat e administração;
- observabilidade do run;
- comportamento de painéis contextuais.

O que não deve ser copiado:

- branding;
- layout exato;
- componentes pixel a pixel;
- decisões específicas do runtime OpenClaw que não façam sentido no Hermes.

### 7.2 Claude

Claude serve como referência para:

- densidade visual baixa;
- legibilidade;
- sidebar recolhível;
- composer compacto;
- anexos e ações secundárias agrupadas;
- painéis laterais para artefatos/conteúdo grande;
- uso cuidadoso de bordas e cards;
- foco no conteúdo da conversa.

### 7.3 Direção visual

O Hermes WebUI deve parecer mais com um **workspace conversacional moderno** do que com um painel DevOps.

Palavras-chave:

- clean;
- restrained;
- readable;
- fast;
- contextual;
- calm;
- desktop-class;
- mobile-friendly.

---

## 8. Usuários-alvo

### 8.1 Usuário avançado do Hermes

Já usa CLI/YAML e quer uma interface mais rápida sem perder controle.

Precisa de:

- raw config;
- CLI runner Hermes;
- logs;
- tools detalhadas;
- models/fallbacks/auxiliary;
- MCP;
- diagnostics;
- update/restart.

### 8.2 Usuário intermediário

Usa Hermes diariamente, mas não quer memorizar estrutura de configuração.

Precisa de:

- Settings pesquisável;
- formulários organizados;
- explicações curtas;
- validação;
- defaults;
- status claros.

### 8.3 Usuário mobile

Conversa com o Hermes pelo celular e ocasionalmente altera configuração.

Precisa de:

- chat excelente;
- sidebar em drawer;
- tool details em sheet;
- Settings navegável;
- composer que não seja destruído pelo teclado virtual.

---

## 9. Arquitetura de informação

A aplicação possui duas zonas de primeira classe:

1. **Chat**
2. **Settings**

Todo o restante pertence a uma dessas zonas ou aparece contextualmente.

### 9.1 Sidebar principal

Estrutura desejada:

    + New chat

    PINNED
      Geral
      Servidor

    TODAY
      Hermes WebUI           working
      Site
      Teste browser

    YESTERDAY
      Traduções
      Pesquisa

    ----------------

    Hermes: Connected
    Settings

A sidebar deve suportar:

- recolher/expandir;
- resize em desktop;
- drawer em mobile;
- busca;
- pin;
- rename;
- archive;
- delete;
- indicador de execução ativa;
- origem da sessão quando útil;
- abertura em nova aba.

### 9.2 O que não deve existir na navegação primária

Não manter permanentemente itens como:

- Overview;
- CPU;
- Usage;
- Channels;
- Instances;
- Cron Jobs;
- Skills;
- MCP;
- Models.

Esses itens pertencem ao workspace de Settings/System.

---

## 10. Home / Chat

### 10.1 Comportamento inicial

Ao abrir a aplicação:

- se houver última sessão válida, abrir essa sessão;
- se não houver, exibir estado de novo chat;
- nunca obrigar o usuário a passar por um dashboard;
- restaurar posição de scroll e draft quando possível.

### 10.2 Layout desktop

Estrutura padrão:

    Conversations | Chat | Optional Context Panel

O terceiro painel é fechado por padrão.

### 10.3 Layout mobile

Estrutura padrão:

    Chat

A sidebar vira drawer.

O context panel vira fullscreen sheet ou rota temporária.

---

## 11. Sessões

A WebUI deve operar sobre as sessões reais do Hermes.

### 11.1 Operações

O usuário deve poder:

- criar nova sessão;
- abrir sessão;
- renomear;
- fixar;
- arquivar;
- deletar;
- fork/branch quando suportado;
- copiar ID;
- abrir em nova aba;
- visualizar origem;
- visualizar estado do run atual.

### 11.2 Origem de sessão

A origem pode ser exibida discretamente:

- Web;
- Telegram;
- CLI;
- Slack;
- outro canal suportado.

A origem não deve dominar a interface.

### 11.3 Preferências visuais

Pins, agrupamentos e largura da sidebar podem ser estado do Hermes WebUI, desde que isso não altere o conteúdo operacional da sessão.

---

## 12. Chat nativo

### 12.1 Requisito principal

O transcript deve ser renderizado como UI web nativa.

Não usar terminal/xterm como chat principal.

### 12.2 Conteúdo suportado

- texto;
- Markdown;
- headings;
- listas;
- tabelas;
- blockquotes;
- links;
- imagens;
- code blocks;
- syntax highlighting;
- tool calls;
- commentary;
- approvals;
- erros;
- anexos;
- status do run.

### 12.3 Streaming

Markdown deve ser renderizado durante streaming sem flicker excessivo.

A implementação deve evitar:

- reparse completo caro em cada token;
- salto de layout;
- perda de seleção;
- scroll forçado quando o usuário estiver lendo mensagens anteriores.

### 12.4 Auto-scroll

Auto-scroll deve ocorrer somente quando:

- usuário está próximo do final;
- nova mensagem pertence ao run atual.

Se o usuário rolar para cima, a UI deve respeitar sua posição e exibir um botão discreto para retornar ao final.

---

## 13. Commentary / progresso

Commentary representa progresso intermediário e não deve parecer resposta final.

Exemplo conceitual:

    Ella

    Vou verificar a configuração atual.

    > Working
      Verificando gateway...

Ao final, commentary pode permanecer recolhido ou visualmente secundário.

O usuário deve poder expandir para investigar o que ocorreu.

---

## 14. Tool calls

Tool calls são componentes de primeira classe.

### 14.1 Estados

Cada tool call pode estar em:

- queued;
- running;
- waiting_approval;
- completed;
- failed;
- cancelled.

### 14.2 Padrão visual

Collapsed por padrão quando output for grande.

Exemplo:

    terminal                                      430 ms

    $ systemctl --user status hermes-gateway

    Active: active (running)

    [Open full output]

### 14.3 Renderers especializados

A WebUI deve possuir renderers específicos para categorias comuns.

#### Terminal

Mostrar:

- comando;
- exit code;
- duração;
- stdout/stderr;
- copy;
- expand.

#### Browser

Mostrar:

- ação;
- URL;
- screenshot quando disponível;
- título da página;
- erro;
- duração.

#### Files / Patch

Mostrar:

- caminho;
- additions/deletions;
- diff;
- preview;
- open full diff.

#### MCP

Mostrar:

- servidor;
- tool;
- status;
- duração;
- inputs resumidos;
- output resumido;
- details.

#### Generic tool

Fallback universal quando não houver renderer específico.

### 14.4 Raw details

Toda tool deve possuir uma visão técnica opcional com payload estruturado.

JSON cru nunca deve ser a visualização padrão.

---

## 15. Painel contextual

Inspirado em Claude Artifacts e docks do OpenClaw.

Deve abrir ao lado do chat para conteúdo que merece mais espaço:

- terminal output;
- browser screenshot;
- diff;
- arquivos;
- logs;
- session details;
- context details;
- diagnostics.

### 15.1 Regras

- fechado por padrão;
- resize em desktop;
- substituível sem perder o chat;
- full-screen sheet em mobile;
- persistência por sessão opcional.

---

## 16. Composer

### 16.1 Layout

O composer deve ser compacto e de baixa densidade visual.

Elementos primários:

- input;
- send/stop;
- botão de anexos/ações;
- model selector quando aplicável;
- reasoning selector quando aplicável.

### 16.2 Botão de ações

O botão `+` pode agrupar:

- attach file;
- skills;
- MCP;
- outras capacidades suportadas.

### 16.3 Execução ativa

Durante um run:

- Send vira Stop;
- steer pode ficar disponível;
- mensagens adicionais podem ser queued quando suportado.

### 16.4 Drafts

Draft por sessão deve sobreviver a troca de chat.

Persistência pode ser local ou WebUI-owned.

---

## 17. Runs

A WebUI deve tratar runs como entidades reconectáveis.

### 17.1 Recursos esperados

Quando suportados pelo Hermes:

- streaming de eventos;
- reconnect;
- status;
- stop;
- steer;
- approvals;
- progress;
- tool lifecycle.

### 17.2 Reload durante execução

Se o navegador for recarregado durante um run:

1. recuperar sessão;
2. detectar run ativo;
3. reconectar ao stream/status;
4. reconstruir estado visível;
5. continuar recebendo eventos.

A UI não deve fingir que o run terminou porque a conexão do browser caiu.

---

## 18. Approvals

Approvals devem aparecer inline no contexto em que foram solicitados.

Exemplo:

    Hermes wants to execute:

    rm -rf ./cache

    [Deny] [Allow once]

Requisitos:

- ação claramente descrita;
- risco visível;
- sem default perigoso;
- suporte a timeout;
- registro do resultado.

---

## 19. Settings

Settings deve ser um workspace próprio.

### 19.1 Estrutura inicial

    Settings

    Search settings...

    Agent
    Models
    Providers
    Memory

    Tools
      MCP
      Skills
      Plugins
      LSP
      Browser
      Terminal

    Messaging
      Telegram
      Slack
      Discord
      Matrix
      ...

    Automation
      Cron
      Webhooks
      Hooks

    System
      Gateway
      Profiles
      Updates
      Backups
      Diagnostics
      Logs

    Advanced
      Raw config
      Environment
      Hermes CLI

A lista final deve ser baseada nas capacidades detectadas.

---

## 20. Busca de Settings

A busca deve indexar:

- label humano;
- chave real;
- descrição;
- aliases;
- categoria;
- provider/model quando aplicável.

Exemplo:

Buscar:

    nudge

deve encontrar:

    Memory > Nudge interval
    memory.nudge_interval

Buscar:

    auxiliary.mcp

deve encontrar:

    Models > Auxiliary > MCP

A busca deve aceitar tanto linguagem humana quanto dotpaths.

---

## 21. Configuração schema-driven

A WebUI deve ler o schema/config/defaults expostos pelo Hermes quando disponíveis.

### 21.1 Camadas

    Hermes schema
         |
         v
    Normalized config model
         |
         +--> curated UX mapping
         |
         +--> generic fallback renderer

### 21.2 Curated mappings

Áreas importantes devem receber UI manual/semântica:

- Agent;
- Models;
- Fallbacks;
- Auxiliary models;
- Providers;
- Memory;
- MCP;
- Skills;
- Messaging;
- Browser;
- Terminal;
- LSP;
- Cron;
- Gateway.

### 21.3 Configuração desconhecida

Campos novos ainda não mapeados devem aparecer em:

    Settings > Advanced > Discovered settings

Isso permite acompanhar novas versões do Hermes sem esperar release da WebUI.

---

## 22. Models

A página Models deve refletir intenção, não estrutura interna do YAML.

### 22.1 Seções

- Main model;
- Reasoning;
- Fallbacks;
- Auxiliary models;
- Vision;
- model-specific settings;
- context/compression quando aplicável.

Exemplo:

    MAIN MODEL

    Example Model Large
    Provider: Example Provider
    Reasoning: Max

    FALLBACKS

    1. Example Model Small
    2. Another Provider Model

    AUXILIARY

    Memory       ...
    Compression  ...
    MCP          Example Model Small
    Vision       ...

### 22.2 Alteração

Ao salvar:

- validar;
- mostrar erro sem corromper config;
- indicar se restart é necessário;
- refletir imediatamente o valor real lido do Hermes.

---

## 23. Providers

Página Providers deve mostrar estado operacional.

Exemplo:

    Example Provider   Ready
    Provider B         Ready
    Provider C         No credential
    Provider D         Ready

Cada provider pode expor:

- credentials;
- endpoint;
- models;
- status;
- usage quando disponível;
- advanced settings.

Secrets nunca devem ser revelados por padrão.

---

## 24. MCP

### 24.1 Lista

Cada servidor deve mostrar:

- nome;
- transport;
- enabled/disabled;
- health;
- número de tools quando conhecido;
- autenticação;
- warnings.

### 24.2 Detalhe

Seções:

- General;
- Connection;
- Environment;
- Tools;
- Permissions/Trust;
- Test;
- Logs;
- Raw.

### 24.3 Operações

Quando suportadas pelo Hermes:

- add;
- remove;
- enable;
- disable;
- test;
- install;
- catalog;
- login/OAuth;
- refresh;
- tool selection.

---

## 25. Skills

### 25.1 Visual

    Skills

    Installed
    Browse

    browser-use
    pdf
    ...

### 25.2 Operações

Quando suportadas:

- inspect;
- install;
- enable;
- disable;
- update;
- uninstall;
- audit.

---

## 26. Cron / Automations

Não deve ser apenas uma tabela de crontab.

Exemplo:

    Provider status watch
    Every hour
    Next: 22:00
    Last run: success

    Weekly cleanup
    Sundays 03:00
    Paused

### 26.1 Editor

Oferecer:

- editor visual;
- cron expression avançada;
- timezone;
- enable/disable;
- run now;
- history;
- incidents quando disponíveis.

---

## 27. Messaging

### 27.1 Visão geral

    Telegram    Connected
    Slack       Connected
    Discord     Disabled
    Matrix      Disabled

### 27.2 Configuração por canal

Exemplo Telegram:

- Connection;
- Access;
- DM policy;
- Allowlist;
- Groups;
- Topics;
- Streaming;
- Commands;
- Advanced.

A organização deve refletir a config real do Hermes.

---

## 28. Gateway / System

A página System/Gateway deve ser funcional e pequena.

Exemplo:

    Hermes

    Status      Running
    PID         18342
    Version     x.y.z
    Uptime      3d 4h
    Gateway     Healthy

    [Restart Hermes]

    Update available
    [Review update]

Essa informação não pertence à Home.

---

## 29. Restart do Hermes

Restart é requisito de MVP.

### 29.1 Objetivo

A WebUI deve conseguir reiniciar:

- Hermes gateway;
- serviço/processo gerenciado do Hermes;
- componentes auxiliares oficialmente restartáveis.

A implementação concreta depende do modo de instalação detectado.

### 29.2 UX

Antes:

    Restart Hermes?

    2 active runs are currently executing.

    - Wait for active work
    - Restart when safe
    - Force restart

    [Cancel] [Restart]

Durante:

    Restarting Hermes...

    Stopping gateway        done
    Starting gateway        done
    Waiting for API         done
    Restoring connection    done

    Hermes restarted successfully.

### 29.3 Requisito arquitetural

Hermes WebUI deve ser um processo separado do Hermes.

Reiniciar Hermes não pode derrubar o próprio painel.

### 29.4 Reconexão

Ao perder Hermes por restart:

- mostrar estado `restarting`;
- retry com backoff curto;
- atualizar status;
- restaurar sessão atual;
- reabrir streams necessários.

---

## 30. Restart required

Mudanças que exigem restart devem ser acumuladas visualmente.

Exemplo:

    Changes saved.
    Restart required to apply 1 change.

    [Restart Hermes]

A WebUI não deve reiniciar automaticamente sem intenção explícita do usuário.

---

## 31. Raw Config

Raw Config é obrigatório.

### 31.1 Recursos

- editor YAML;
- syntax highlight;
- schema validation;
- autocomplete quando possível;
- warnings;
- diff antes de aplicar;
- restore previous version;
- formatação;
- indicação de restart.

### 31.2 Fonte

O arquivo salvo continua sendo o arquivo real do Hermes.

A WebUI não mantém uma cópia operacional paralela.

---

## 32. Environment / Secrets

Página própria para variáveis de ambiente e secrets.

Exemplo:

    ANTHROPIC_API_KEY

    ****************8D2A

    [Replace] [Remove]

Regras:

- nunca revelar secret automaticamente;
- não enviar secrets em logs;
- redact em erros;
- exigir confirmação em remoção;
- distinguir config normal de secret/env.

---

## 33. Paridade com CLI

### 33.1 Requisito de produto

> Toda operação estável da CLI Hermes que fizer sentido administrar graficamente deve ter um caminho na WebUI.

Isso não significa que toda operação precisa de uma tela dedicada no primeiro release.

### 33.2 Níveis de integração

**Nível A — API nativa**

Preferido.

**Nível B — config/env**

Para operações cujo contrato oficial é configuração.

**Nível C — CLI bridge**

Para operações estáveis ainda não expostas por API.

### 33.3 Meta 1.0

Um usuário não deve precisar abrir um terminal para administração normal do Hermes.

---

## 34. Hermes CLI bridge

A bridge existe para alcançar paridade sem implementar shell remoto.

### 34.1 Regra

A bridge executa **Hermes**, não comandos arbitrários.

Permitido:

    hermes lsp status
    hermes gateway restart
    hermes doctor
    hermes update --check

Não permitido como shell:

    bash -c ...
    sh -c ...
    rm ...
    curl ...
    arbitrary command

### 34.2 Execução

Usar spawn/execFile/argv semantics.

Nunca concatenar texto do navegador em shell.

### 34.3 Operações interativas

Se uma operação Hermes legítima exigir TTY:

- usar PTY restrito ao binário Hermes;
- validar subcommand;
- impedir escape para shell;
- limitar ambiente;
- aplicar timeout.

---

## 35. Command Registry

Toda ação via bridge deve ser declarada.

Exemplo conceitual:

    id: gateway.restart
    command: hermes
    argv: ["gateway", "restart"]
    mutating: true
    confirmation: required
    timeout: 60s
    stream: true

Campos mínimos:

- id;
- display name;
- command;
- argv schema;
- read-only/mutating;
- confirmação;
- risco;
- timeout;
- streaming;
- restart implications;
- version constraints;
- capability requirements.

---

## 36. Advanced Hermes CLI

Para comandos Hermes ainda sem UI dedicada:

    Settings
      > Advanced
        > Hermes CLI

### 36.1 Restrições

A interface aceita apenas comandos iniciados em `hermes`.

Não interpretar operadores de shell como:

- `;`
- `&&`
- `||`
- `|`
- `>`
- `<`
- `$()`
- backticks

### 36.2 Objetivo

Ser um escape hatch para **Hermes**, não um terminal web geral.

---

## 37. Diagnostics

### 37.1 Página

    Hermes Doctor

    Config         OK
    Dependencies   OK
    Gateway        OK
    Models         warning
    Storage        OK

    [Run again] [Attempt fixes]

### 37.2 Operações

Quando suportadas:

- doctor;
- doctor --fix;
- health;
- detailed health;
- logs relacionados.

Ação de fix deve pedir confirmação.

---

## 38. Updates

### 38.1 Fluxo

    Current     x.y.z
    Available   x.y.z+1

    [Review update]

Ao aplicar:

1. plan;
2. backup;
3. update;
4. post-install;
5. restart;
6. health check;
7. reconnect.

### 38.2 Segurança

- nunca atualizar silenciosamente;
- mostrar versão atual e alvo;
- mostrar plano quando disponível;
- preservar logs do update;
- oferecer caminho de diagnóstico em caso de falha.

---

## 39. Command palette

Atalho:

- `Cmd+K` em macOS;
- `Ctrl+K` em outras plataformas.

Pesquisa conjunta:

- Chats;
- Settings;
- Actions;
- MCP;
- Skills;
- Providers;
- Commands.

Exemplo:

    > restart

    Restart Hermes
    LSP > Restart
    Settings requiring restart

---

## 40. Estados de conexão

Estado do Hermes deve aparecer discretamente.

Estados:

- Connected;
- Reconnecting;
- Restarting;
- Offline;
- Degraded.

A aplicação deve distinguir:

- WebUI online, Hermes offline;
- Hermes online, stream quebrado;
- API parcialmente indisponível;
- restart intencional.

---

## 41. Erros

A UI nunca deve reduzir todos os erros a `HTTP 500`.

Exemplo:

    Couldn't restart Hermes.

    systemd reported:
    Unit hermes-gateway.service not found.

    [View details] [Run diagnostics]

Requisitos:

- mensagem humana;
- detalhe técnico preservado;
- redaction;
- ação sugerida quando objetiva;
- correlation/request id quando disponível.

---

# PARTE II — ARQUITETURA TÉCNICA

## 42. Stack decidida

### 42.1 Frontend

- **React**
- **TypeScript**
- **Vite**
- **Tailwind CSS**
- **shadcn/ui-style components**
- **Radix primitives** onde fizer sentido
- **TanStack Query** para server state
- **TanStack Router** para routing type-safe
- estado local mínimo com React e/ou **Zustand** apenas onde necessário
- renderer Markdown incremental com implementação escolhida após benchmark
- virtualização para transcripts/listas grandes

### 42.2 Backend local

- **Node.js — LTS**
- **TypeScript**
- **Fastify**
- schema/validation via **TypeBox** ou camada equivalente compatível com JSON Schema
- `fetch`/Undici para Hermes APIs
- SSE proxy/relay quando necessário
- WebSocket somente onde houver necessidade real
- spawn/execFile para CLI bridge; nunca shell arbitrário

### 42.3 Persistência própria

**SQLite local** apenas para dados que pertencem ao Hermes WebUI, por exemplo:

- pins;
- UI preferences;
- drafts;
- sidebar state sincronizável entre dispositivos;
- audit log da própria WebUI;
- metadata de apresentação.

Nunca duplicar:

- messages;
- sessions;
- runs;
- Hermes config;
- Hermes credentials;
- cron;
- skills;
- MCP state operacional.

Se SQLite for desnecessário no MVP inicial, a primeira implementação pode começar com state local e introduzir SQLite antes de recursos multi-client que dependam dele.

### 42.4 Tooling

- **pnpm workspaces**
- ESLint
- Prettier
- Vitest
- React Testing Library
- Playwright
- Fastify `inject()` para testes de backend
- MSW ou mocks equivalentes para Hermes API em testes de frontend

### 42.5 Packaging

Objetivo:

- um serviço local;
- frontend estático servido pelo backend Fastify;
- instalação via pacote/release;
- Docker opcional;
- unit systemd recomendada em Linux.

Não exigir dois servidores em produção.

---

## 43. Por que Fastify

Fastify é escolhido para o backend local porque oferece:

- baixo overhead;
- bom suporte TypeScript;
- validação baseada em schema;
- plugins;
- logging estruturado;
- streaming;
- lifecycle claro;
- boa adequação a um sidecar HTTP local.

O backend não será uma aplicação de negócio pesada; ele será principalmente:

- adapter;
- proxy/control plane;
- auth boundary;
- CLI bridge;
- static server.

Fastify encaixa bem nesse perfil.

---

## 44. Estrutura inicial do repositório

Estrutura proposta:

    hermes-webui/
      apps/
        web/
          src/
            app/
            routes/
            features/
              chat/
              sessions/
              settings/
              tools/
              system/
            components/
            lib/
            styles/

        server/
          src/
            app/
            routes/
            auth/
            hermes/
              api-client/
              capability/
              config/
              cli/
            actions/
            audit/
            storage/

      packages/
        shared/
          src/
            types/
            schemas/
            protocol/

        ui/
          src/

      docs/
      tests/
      PRD.md
      README.md
      package.json
      pnpm-workspace.yaml

A estrutura pode ser reduzida inicialmente, mas as fronteiras `web`, `server` e `shared` devem existir desde o começo.

---

## 45. Componentes do backend

### 45.1 Hermes API Client

Responsável por:

- health;
- capabilities;
- sessions;
- messages;
- runs;
- config;
- models;
- MCP;
- skills;
- cron;
- messaging;
- diagnostics;
- demais APIs oficiais disponíveis.

### 45.2 Capability layer

Normaliza diferenças entre versões do Hermes.

Exemplo de capabilities internas:

    sessions.list
    sessions.create
    sessions.fork
    runs.stream
    runs.stop
    runs.steer
    runs.approval
    gateway.restart
    config.schema
    mcp.manage
    skills.manage

### 45.3 Config adapter

Responsável por:

- ler config;
- obter defaults;
- obter schema;
- validar alteração;
- aplicar alteração;
- detectar restart required;
- raw YAML.

### 45.4 Environment adapter

Responsável por:

- secrets/env;
- existência de key;
- replace;
- remove;
- redaction.

### 45.5 CLI bridge

Responsável somente por operações Hermes permitidas e registradas.

### 45.6 Action registry

Mapeia ações da UI para API/config/CLI.

A UI nunca precisa saber se uma ação específica foi realizada por endpoint ou CLI.

---

## 46. Capability negotiation

Na inicialização, o backend deve descobrir o que a instalação atual suporta.

Fontes possíveis:

- Hermes version;
- capabilities endpoint;
- API status;
- config schema;
- probes leves de endpoints conhecidos.

### 46.1 Comportamento

A UI deve:

- esconder funcionalidade impossível;
- desabilitar funcionalidade conhecida mas indisponível;
- mostrar motivo;
- evitar quebrar a página inteira por um endpoint ausente.

### 46.2 Compatibilidade

A WebUI deve manter uma matriz:

    Hermes version range
       -> supported capabilities
       -> known quirks

Mas a detecção em runtime continua sendo preferida a hardcode puro.

---

## 47. API interna Hermes WebUI

O browser deve falar prioritariamente com o backend Hermes WebUI, não diretamente com Hermes.

Motivos:

- secrets;
- CORS;
- autenticação;
- CLI bridge;
- normalization;
- compatibility;
- audit;
- restart handling.

Exemplos de rotas internas:

    GET  /api/app/status
    GET  /api/hermes/capabilities

    GET  /api/sessions
    POST /api/sessions
    GET  /api/sessions/:id/messages

    POST /api/runs
    GET  /api/runs/:id
    POST /api/runs/:id/stop
    POST /api/runs/:id/steer
    GET  /api/runs/:id/events

    GET  /api/settings/schema
    GET  /api/settings/config
    PATCH /api/settings/config

    POST /api/actions/:id

A lista real deve seguir contratos observados no Hermes, não presumir endpoints inexistentes.

---

## 48. Event normalization

Eventos do Hermes devem ser convertidos para um protocolo interno estável.

Exemplo conceitual:

    Hermes-specific event
          |
          v
    normalize()
          |
          v
    WebUI event
      - message.delta
      - commentary.delta
      - tool.started
      - tool.output
      - tool.completed
      - approval.requested
      - run.completed
      - run.failed

Isso desacopla componentes React de mudanças pequenas no protocolo Hermes.

Raw event deve permanecer acessível para debug.

---

## 49. Autenticação

### 49.1 Padrão seguro

Default:

    bind = 127.0.0.1

Se usuário optar por bind em LAN/rede:

- autenticação obrigatória;
- sessão via cookie HttpOnly;
- SameSite apropriado;
- CSRF protection para mutations;
- rate limit em login;
- password hash moderno como Argon2id;
- secrets nunca em localStorage.

### 49.2 Tailscale / reverse proxy

Suporte futuro ou opcional para:

- trusted proxy;
- headers de identidade;
- auth delegada.

Nunca ativar trust de proxy implicitamente.

---

## 50. Segurança do CLI bridge

Requisitos obrigatórios:

1. sem `shell: true`;
2. command allowlist;
3. argv tipado;
4. working directory controlado;
5. ambiente sanitizado;
6. timeout;
7. output cap;
8. redaction;
9. audit;
10. confirmação para mutations;
11. sem sudo;
12. executar como o usuário do Hermes;
13. no-new-privileges quando aplicável;
14. bloquear path traversal em argumentos do tipo path.

### 50.1 Ações destrutivas

Devem exigir:

- confirmação explícita;
- mensagem descrevendo impacto;
- action id;
- audit entry.

---

## 51. Source of truth

### Hermes

Responsável por:

- sessions;
- messages;
- runs;
- config;
- environment;
- credentials;
- providers;
- models;
- MCP;
- skills;
- memory;
- cron;
- messaging;
- runtime.

### Hermes WebUI

Pode possuir:

- theme;
- sidebar width;
- pins;
- collapsed sections;
- draft local/server-side;
- recent searches;
- panel state;
- audit log da WebUI.

---

## 52. Deployment

### 52.1 Modelo principal

Um processo Node/Fastify serve:

- API Hermes WebUI;
- assets React buildados.

### 52.2 Linux

Instalação recomendada:

- usuário normal;
- systemd user unit ou system unit devidamente restrita;
- sem root;
- mesmo usuário do Hermes quando necessário.

### 52.3 Configuração inicial

Arquivo próprio pequeno, por exemplo:

    ~/.config/hermes-webui/config.yaml

Esse arquivo contém somente configuração da WebUI:

- listen address;
- port;
- auth;
- Hermes base URL/socket;
- paths permitidos para integração;
- log level.

Não duplicar config do Hermes.

### 52.4 Docker

Docker pode ser suportado, mas não deve ser a única forma de instalação.

Como o produto precisa acessar Hermes local, CLI e arquivos oficiais, instalação nativa deve ser first-class.

---

## 53. Descoberta do Hermes

No primeiro start, tentar descobrir:

- Hermes executable;
- Hermes API/gateway;
- config location;
- env location;
- install mode;
- service manager;
- version.

Se houver ambiguidade, mostrar setup simples.

A WebUI não deve modificar a instalação automaticamente sem confirmação.

---

## 54. Restart por modo de instalação

O restart deve ser abstraído.

Possíveis adapters:

- Hermes API;
- Hermes CLI;
- systemd user unit;
- systemd system unit quando permitido;
- processo gerenciado oficialmente pelo Hermes.

A escolha deve seguir a forma oficial detectada de execução.

Nunca matar processos por PID arbitrariamente como estratégia principal.

---

## 55. Mobile

Mobile é requisito de V1.

### 55.1 Sidebar

- drawer;
- gesto/ação clara de fechar;
- busca;
- sessions.

### 55.2 Composer

- respeitar safe areas;
- funcionar com teclado virtual;
- não saltar layout;
- action buttons compactos.

### 55.3 Tool calls

- resumo inline;
- detalhes em sheet/fullscreen.

### 55.4 Settings

- navigation stack;
- breadcrumbs compactos;
- save affordance claro;
- sem tabelas largas obrigatórias.

---

## 56. Acessibilidade

Objetivo mínimo: WCAG 2.2 AA nas superfícies principais.

Requisitos:

- navegação por teclado;
- focus states;
- labels;
- contraste;
- reduced motion;
- screen reader semantics;
- status de execução com live regions cuidadosas;
- não depender apenas de cor.

---

## 57. Tema

- dark;
- light;
- system.

Tema não deve interferir em screenshots/browser outputs.

---

## 58. Performance

Metas iniciais:

| Operação | Meta |
|---|---:|
| Shell da UI após cache em LAN/local | < 1 s percebido |
| Troca de chat já carregado | < 300 ms percebido |
| Evento recebido -> render | < 100 ms adicional |
| Sidebar com muitas sessões | fluida |
| Transcript grande | virtualizado quando necessário |
| Reconexão após restart | automática |

### 58.1 Estratégias

- pagination;
- cache TanStack Query;
- optimistic UI somente onde seguro;
- virtualização;
- batch de deltas;
- lazy loading de tool details;
- lazy loading de Settings pesados.

---

## 59. Observabilidade

Hermes WebUI deve gerar logs próprios separados dos logs do Hermes.

Campos:

- timestamp;
- level;
- request id;
- action id;
- Hermes operation;
- duration;
- result.

Nunca logar:

- API keys;
- tokens;
- passwords;
- conteúdo secreto do `.env`.

### 59.1 Audit log

Mutations administrativas devem ser auditáveis:

- timestamp;
- ação;
- origem;
- alvo;
- resultado.

Sem armazenar secret values.

---

## 60. Testing

### 60.1 Unit

- config mapping;
- capability normalization;
- action registry;
- CLI argv validation;
- redaction;
- event normalization.

### 60.2 Backend integration

Usar Fastify `inject()`.

Testar:

- auth;
- CSRF;
- actions;
- restart lifecycle;
- capability fallback;
- errors;
- streaming proxy.

### 60.3 Frontend

Vitest + Testing Library:

- chat;
- tool cards;
- Settings;
- search;
- connection states;
- approvals.

### 60.4 E2E

Playwright contra:

1. Hermes mock;
2. Hermes real em ambiente de teste.

Fluxos obrigatórios:

- criar chat;
- enviar mensagem;
- streaming;
- tool call;
- stop;
- reconnect;
- mudar config;
- restart;
- MCP;
- mobile.

---

## 61. Development mode

Dev environment deve permitir iniciar UI contra:

- mock Hermes;
- Hermes local real;
- fixtures de eventos.

Fixtures devem incluir:

- run simples;
- run longo;
- tools paralelas;
- approval;
- erro;
- reconnect;
- restart;
- config schema desconhecido.

---

# PARTE III — ESCOPO DE ENTREGA

## 62. MVP 0.1 — Daily Driver

Objetivo: já ser preferível ao dashboard atual para uso cotidiano.

### Chat

- chat-first;
- sidebar;
- sessões reais;
- create/open/rename/delete;
- streaming;
- Markdown;
- code blocks;
- tool cards;
- commentary;
- stop;
- reconnect;
- approvals se suportados.

### Settings

- search;
- schema loading;
- Agent;
- Models;
- Fallbacks;
- Auxiliary;
- Memory;
- Raw Config;
- Environment/keys.

### Admin

- MCP;
- Skills;
- Cron;
- Messaging;
- Gateway/System.

### System

- status;
- logs básicos;
- restart Hermes;
- restart-required banner;
- doctor básico.

### UX

- desktop;
- mobile;
- dark/light;
- collapsible sidebar;
- command palette básica.

---

## 63. Beta

Adicionar:

- steer;
- richer approvals;
- Plugins;
- LSP;
- Browser settings;
- Bundles;
- Profiles;
- Webhooks;
- Hooks;
- Backups;
- Update flow;
- Usage;
- advanced credentials;
- memory providers;
- full command palette;
- Hermes CLI runner;
- audit UI.

---

## 64. 1.0

Critério de 1.0:

> Administração normal do Hermes pode ser feita sem abrir terminal.

E:

> Funcionalidade administrativa nova ainda sem UI própria pode ser acessada pelo Hermes CLI runner seguro.

Também esperado:

- mobile sólido;
- compatibilidade documentada;
- upgrade path;
- recovery path;
- tests extensivos;
- docs de instalação;
- docs de segurança.

---

## 65. Critérios de aceitação

### 65.1 Chat

Dado um Hermes em execução:

- abrir WebUI cai em chat;
- enviar mensagem inicia run;
- texto chega em streaming;
- tool calls aparecem em UI nativa;
- stop funciona;
- reload durante run recupera estado;
- histórico continua sendo o do Hermes.

### 65.2 Config

Pesquisar:

    memory.nudge_interval

deve localizar o campo correspondente.

Alterar o valor deve modificar a configuração real do Hermes e ser confirmado por leitura posterior.

### 65.3 Auxiliary MCP

Pesquisar:

    auxiliary.mcp

deve levar ao editor correspondente.

Selecionar provider/model deve atualizar a config real.

### 65.4 MCP

Usuário consegue:

- listar;
- abrir;
- habilitar/desabilitar;
- testar;
- adicionar/remover quando suportado.

### 65.5 Restart

Ao clicar Restart Hermes:

1. WebUI permanece online;
2. Hermes para;
3. Hermes inicia;
4. WebUI detecta retorno;
5. sessão atual é restaurada;
6. sucesso ou erro real é exibido.

### 65.6 Raw config

Config inválida é recusada antes de aplicação.

Config válida mostra diff e pode ser aplicada.

### 65.7 Hermes CLI

Em Advanced > Hermes CLI:

    hermes lsp status

pode ser executado.

Tentativas de shell arbitrário são bloqueadas.

### 65.8 Mobile

Os fluxos críticos funcionam em viewport de telefone:

- chat;
- sidebar;
- tool details;
- Settings;
- restart.

---

## 66. Métricas de sucesso

O produto será considerado bem-sucedido quando:

- usuários conseguirem usar Hermes diariamente sem TUI para tarefas comuns;
- maioria das alterações normais de config puder ser feita pela WebUI;
- restart/update/doctor forem compreensíveis e confiáveis;
- novas versões do Hermes não quebrarem toda a interface por alterações menores;
- mobile for realmente utilizável;
- tool calls forem mais fáceis de acompanhar que no TUI/dashboard atual.

Métricas opcionais locais, sem telemetry obrigatória:

- percentual de ações via API vs CLI bridge;
- tempo de load;
- erros de reconnect;
- ações que exigiram fallback genérico;
- campos de config sem curated mapping.

Nenhuma telemetria externa deve ser enviada por padrão.

---

## 67. Privacidade

Hermes WebUI é local-first.

Por padrão:

- sem analytics externo;
- sem telemetry externa;
- sem crash upload externo;
- sem conteúdo de conversa saindo do host por causa da WebUI.

Qualquer integração externa futura deve ser explícita e opt-in.

---

## 68. Riscos

### 68.1 Hermes muda rapidamente

**Risco:** APIs/config mudarem.

**Mitigação:**

- capability negotiation;
- normalized adapter;
- schema-driven fallback;
- version matrix;
- testes contra múltiplas versões.

### 68.2 CLI bridge virar shell remoto

**Risco:** grande superfície de segurança.

**Mitigação:**

- command registry;
- argv validation;
- sem shell;
- no sudo;
- audit;
- confirmations.

### 68.3 Duplicação de estado

**Risco:** Hermes e WebUI divergirem.

**Mitigação:**

- Hermes source of truth;
- refetch após mutation;
- WebUI persistence limitada à apresentação.

### 68.4 Restart derrubar UI

**Risco:** acoplamento de processo.

**Mitigação:**

- sidecar independente;
- static/UI servida pelo Fastify;
- restart adapter separado.

### 68.5 UI virar painel gigante

**Risco:** repetir o problema original.

**Mitigação:**

- chat-first;
- Settings separado;
- progressive disclosure;
- contextual panels;
- revisão constante de densidade visual.

---

## 69. Questões abertas

Estas decisões podem ser fechadas durante o primeiro spike:

1. Qual endpoint/protocolo Hermes é o melhor source para runs em todas as versões alvo?
2. Quais operações exigem restart e como o Hermes sinaliza isso hoje?
3. Como detectar de forma confiável o modo de instalação do gateway?
4. Quais comandos Hermes realmente exigem PTY?
5. Quais campos de config merecem curated UI no MVP?
6. Qual renderer Markdown oferece melhor streaming/performance?
7. SQLite entra no primeiro commit ou após a UI básica?
8. Qual mecanismo de autenticação deve ser default em bind não-loopback?
9. Qual faixa mínima de versões Hermes será suportada no primeiro release?

---

## 70. Spikes técnicos recomendados

Antes de construir a UI completa, executar quatro spikes curtos.

### Spike A — Sessions + Runs

Validar:

- list;
- history;
- send;
- stream;
- stop;
- reconnect;
- tool events;
- approvals.

### Spike B — Config

Validar:

- config;
- defaults;
- schema;
- mutation;
- raw YAML;
- env;
- restart-required.

### Spike C — Lifecycle

Validar:

- health;
- gateway status;
- restart;
- reconnect;
- service detection.

### Spike D — CLI parity

Inventariar comandos:

- API available?
- config available?
- bridge required?
- interactive?
- destructive?
- restart required?

O resultado deve gerar uma capability/parity matrix versionada no repositório.

---

## 71. Matriz de implementação por funcionalidade

Cada feature deve ser documentada assim:

| Feature | UX | Hermes API | Config | CLI Bridge | MVP |
|---|---|---|---|---|---|
| Sessions | Native chat | Prefer | - | No | Yes |
| Runs | Native chat | Prefer | - | No | Yes |
| Models | Curated Settings | Prefer | Yes | Fallback | Yes |
| MCP | Curated Settings | Prefer | Yes | Fallback | Yes |
| Skills | Curated Settings | Prefer | Maybe | Fallback | Yes |
| Cron | Curated Settings | Prefer | Maybe | Fallback | Yes |
| Gateway restart | System | Prefer | - | Fallback | Yes |
| Doctor | System | Prefer | - | Fallback | Yes |
| Update | System | Prefer | - | Fallback | Beta |
| Raw Config | Advanced | Prefer | Yes | No | Yes |
| Hermes CLI | Advanced | - | - | Yes | Beta |

Essa matriz deve ser refinada após os spikes.

---

## 72. Definição de pronto para uma feature

Uma feature não está pronta apenas porque funciona visualmente.

Precisa ter:

- loading;
- empty;
- error;
- offline;
- permission denied;
- unsupported capability;
- mobile;
- keyboard;
- tests;
- logs;
- redaction;
- confirmation quando mutating;
- recovery quando aplicável.

---

## 73. Direção de design

### 73.1 Evitar

- dashboard cards em excesso;
- gradientes decorativos;
- bordas em tudo;
- status ocupando espaço central;
- JSON cru;
- terminal como componente principal;
- tabelas para tudo;
- modais enormes;
- toast para informação crítica;
- menus com dezenas de itens no primeiro nível.

### 73.2 Preferir

- whitespace;
- tipografia;
- hierarquia;
- disclosure;
- side panels;
- compact status;
- contextual actions;
- search;
- keyboard navigation;
- direct manipulation.

---

## 74. Design tokens iniciais

Não fixar branding antes do primeiro protótipo, mas preparar tokens para:

- background;
- surface;
- elevated surface;
- text primary;
- text secondary;
- border subtle;
- accent;
- success;
- warning;
- danger;
- running.

A UI não deve depender de cores hardcoded por componente.

---

## 75. Rotas sugeridas

Rotas públicas após auth:

    /
    /chat/:sessionId

    /settings
    /settings/agent
    /settings/models
    /settings/providers
    /settings/memory
    /settings/mcp
    /settings/skills
    /settings/messaging
    /settings/cron
    /settings/system
    /settings/logs
    /settings/advanced/config
    /settings/advanced/environment
    /settings/advanced/cli

Rotas indisponíveis por capability podem retornar para Settings com explicação.

---

## 76. Estratégia de estado frontend

### Server state

TanStack Query:

- sessions;
- messages/history;
- status;
- capabilities;
- Settings data;
- MCP;
- Skills;
- Cron.

### Stream state

Store dedicado por run/session para:

- deltas;
- tool lifecycle;
- commentary;
- approval;
- connection state.

### UI state

Local:

- sidebar;
- panel;
- drafts;
- selection;
- theme.

Evitar colocar toda a aplicação em uma store global única.

---

## 77. Estratégia de mutations

Para configuração:

1. validar no client;
2. enviar mutation;
3. validar no backend;
4. aplicar via adapter;
5. reler do Hermes;
6. atualizar cache;
7. sinalizar restart se necessário.

Não assumir sucesso baseado apenas em HTTP 200 do adapter.

---

## 78. Recovery

A WebUI deve possuir caminhos claros para:

- Hermes offline;
- config inválida;
- restart falho;
- update falho;
- API incompatível;
- CLI command falho;
- schema ausente.

Em casos críticos, oferecer:

- raw error;
- logs;
- diagnostics;
- comando manual recomendado, quando necessário.

---

## 79. README futuro

O README deve explicar em poucos segundos:

> Hermes WebUI is a modern, chat-first interface for Hermes Agent. It runs alongside your existing Hermes installation and gives you native chat, session management, structured tool activity, and full configuration/control from the browser.

Instalação e screenshots vêm depois do primeiro protótipo funcional.

---

## 80. Referências

Referências de produto e pesquisa usadas como direção:

- OpenClaw Web UI / Control UI documentation: https://docs.openclaw.ai/
- OpenClaw repository: https://github.com/openclaw/openclaw
- Claude Help Center: https://support.claude.com/
- Anthropic — Claude / Projects / Artifacts: https://www.anthropic.com/
- Hermes Agent repository: https://github.com/NousResearch/hermes-agent
- Hermes Agent documentation: https://github.com/NousResearch/hermes-agent/tree/main/website/docs

Essas referências servem como inspiração e fonte de comportamento. Hermes WebUI deve possuir identidade própria.

---

## 81. Decisão final de arquitetura

A primeira versão será:

> **React + TypeScript + Vite + Tailwind + shadcn-style UI no frontend; Node.js + TypeScript + Fastify no backend; pnpm workspace; execução como sidecar local no mesmo host do Hermes; Hermes como única fonte de verdade; API first, config second, CLI bridge segura como fallback.**

A WebUI será um processo independente do Hermes para permitir:

- restart do Hermes sem derrubar a interface;
- health/reconnect;
- CLI bridge;
- autenticação;
- compatibilidade;
- evolução independente.

---

## 82. North Star

O teste definitivo do produto é simples:

> Um usuário do Hermes deve poder abrir o navegador, conversar normalmente e administrar sua instalação inteira sem sentir que está usando um dashboard de infraestrutura — e sem perder nenhum dos controles avançados que teria pela CLI.

Se a UI ficar bonita mas esconder o Hermes, falhou.

Se expuser tudo mas parecer um painel técnico caótico, falhou.

O produto certo é o ponto entre os dois.
