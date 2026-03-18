// 1. Instalar as dependências necessárias no seu computador/servidor:
// npm install express cors @whiskeysockets/baileys pino

const express = require('express');
const cors = require('cors');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs'); // Necessário para apagar sessões antigas

const app = express();
app.use(express.json());

// Permitir que o PWA (no GitHub Pages) comunique com este servidor
app.use(cors({ origin: '*' }));

let sock = null;

// ROTA DE SAÚDE (Para o Render e UptimeRobot saberem que está online)
// Isto resolve os avisos do Render e mantém o servidor acordado
app.get('/', (req, res) => {
    res.send('🤖 Servidor TRBot IA está Online e a funcionar de forma saudável!');
});

// ROTA PARA GERAR O CÓDIGO DE APARELHO (Pairing Code)
app.post('/api/pair-code', async (req, res) => {
    const phoneNumber = req.body.phone;

    if (!phoneNumber) {
        return res.status(400).json({ error: 'Número de telemóvel é obrigatório.' });
    }

    try {
        const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');

        // CORREÇÃO 1: Encerrar completamente qualquer ligação fantasma anterior.
        // Se houver múltiplas ligações ativas, a Meta rejeita o código no telemóvel.
        if (sock) {
            console.log('A encerrar a ligação fantasma anterior...');
            try {
                sock.ev.removeAllListeners();
                sock.ws.close();
            } catch (e) {
                console.log('Erro ao fechar o socket anterior (ignorado).');
            }
            sock = null;
        }

        // CORREÇÃO 2: Limpar a sessão corrompida anterior antes de pedir um novo código.
        if (fs.existsSync('auth_info_baileys')) {
            fs.rmSync('auth_info_baileys', { recursive: true, force: true });
            console.log('Sessão anterior apagada do disco. A iniciar uma ligação fresca...');
        }

        const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

        sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: "silent" }),
            // CORREÇÃO 3: Usar uma assinatura de browser mais padronizada (Mac OS)
            browser: ["Mac OS", "Chrome", "109.0.5414.120"], 
            // Aumentar os limites de tempo ajuda a evitar que o Render perca a ligação
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 10000,
        });

        sock.ev.on('creds.update', saveCreds);

        // Monitorizar o estado da ligação
        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect } = update;
            if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                console.log('Ligação fechada. Motivo:', lastDisconnect?.error?.output?.statusCode);
            } else if (connection === 'open') {
                console.log('✅ WhatsApp conectado com sucesso!');
            }
        });

        // Aguarda 3 segundos para o WebSocket estabilizar antes de pedir o código
        setTimeout(async () => {
            try {
                // Prevenção extra: Não pedir código se a sessão já estiver válida
                if (sock.authState.creds.registered) {
                    return res.status(400).json({ error: 'O dispositivo já está associado.' });
                }

                console.log(`A solicitar código de emparelhamento para o número: ${cleanNumber}`);
                
                // Solicita o código real ao WhatsApp
                const code = await sock.requestPairingCode(cleanNumber);
                
                // Formata o código (ex: ABCD-1234) para facilitar a leitura
                const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
                
                console.log(`Sucesso! Código gerado para ${cleanNumber}: ${formattedCode}`);
                
                // Devolve o código real ao nosso PWA apenas se a resposta ainda não tiver sido enviada
                if (!res.headersSent) {
                    res.json({ code: formattedCode });
                }
            } catch (err) {
                console.error("Erro ao pedir código à Meta:", err);
                if (!res.headersSent) {
                    res.status(500).json({ error: 'A Meta rejeitou o pedido. Verifique o número e tente novamente.' });
                }
            }
        }, 3000); 

    } catch (error) {
        console.error("Erro geral no servidor:", error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Falha interna no servidor.' });
        }
    }
});

// Inicia o servidor na porta
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor TRBot IA a correr na porta ${PORT}`);
});
