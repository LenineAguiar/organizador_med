# Meu Organizador Médico

Aplicação responsiva em React e Node.js para organizar consultas, observações e documentos. A mesma interface funciona no navegador de computador e pode ser instalada como aplicativo web (PWA) em celulares Android usando um navegador compatível.

## Executar localmente

1. Instale o Node.js 20 ou superior.
2. Na pasta do projeto, execute `npm install`.
3. Execute `npm run dev`.
4. Acesse `http://localhost:5173`.

No modo de desenvolvimento, a API escuta em `0.0.0.0:3000` para aceitar conexões pela rede Wi-Fi privada. Para produção, execute `npm run build` e depois `npm start`; por segurança, o Node.js escuta somente em `127.0.0.1:3000` por padrão.

## Aplicativo Android (APK)

O projeto Android foi criado com Capacitor. Com JDK 21, Android SDK e Node.js 20 instalados, execute `npm run android:apk`. O APK de testes é gerado em `android/app/build/outputs/apk/debug/app-debug.apk`.

O app Android abre diretamente, sem tela de login, servidor ou conexão de rede. Consultas e anexos ficam no armazenamento local persistente do aplicativo (IndexedDB). Para cada anexo, use **Baixar** para escolher onde salvar no aparelho ou **Compartilhar** para abrir o menu de compartilhamento do Android. Reinstalar ou limpar os dados do app pode apagar esse histórico; faça cópias dos documentos importantes. O APK debug pode ser instalado no Android permitindo a instalação de aplicativos dessa origem.

## Persistência e anexos

No navegador desktop, o Node.js mantém os dados em `server/data/records.json` e organiza os arquivos em `server/data/files/<id-da-consulta>/<categoria>/`. No app Android, os registros e anexos são armazenados separadamente no próprio aparelho e funcionam sem internet. Os dados móveis não são sincronizados automaticamente com o servidor ou com o navegador desktop. São aceitos PDF, JPEG, PNG, WEBP e GIF, com limite de 10 MB por arquivo e até 20 arquivos por consulta.

## Contas e acesso

Na primeira abertura, crie a conta administradora no próprio computador que executa o servidor. O administrador pode criar e excluir usuários de teste; todos os usuários acessam o mesmo histórico. Use nomes de usuário de 3 a 32 caracteres e senhas de 8 a 128 caracteres. As senhas são armazenadas como hashes scrypt com salt aleatório, e o acesso usa cookie de sessão `HttpOnly` e `SameSite=Strict`. Após cinco tentativas de login inválidas, novas tentativas ficam bloqueadas por 15 minutos. As sessões expiram após sete dias ou quando o servidor reinicia.

As contas são guardadas em `server/data/users.json`; esse arquivo contém hashes, nunca senhas em texto puro. Proteja a pasta `server/data`, pois os registros e anexos médicos ficam em arquivos locais sem criptografia em repouso. As contas de teste não têm permissões isoladas: qualquer usuário autenticado pode ver e editar o histórico compartilhado.

Para usar a versão web como PWA, disponibilize-a por HTTPS e use a opção de instalação/adicionar à tela inicial do navegador. O acesso por `localhost` é adequado apenas para desenvolvimento local. Em implantação desktop, configure `NODE_ENV=production` para ativar o atributo `Secure` do cookie; crie a conta administradora localmente antes de habilitar o proxy para outros dispositivos.

## Observação de implantação

Os registros de saúde são dados sensíveis. O Android não exige credenciais e mantém os registros apenas no armazenamento local do app; proteja o aparelho e mantenha cópias de segurança dos documentos importantes. O acesso desktop continua usando autenticação e armazenamento no servidor.
