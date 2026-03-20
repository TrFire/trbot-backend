// 1. Instalar as dependências necessárias no seu computador/servidor:
// npm install express cors @whiskeysockets/baileys pino

const express = require('express');
const cors = require('cors');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(cors({ origin: '*' }));

let sock = null;

// Rota de saúde para o Render e UptimeRobot
app.get('/', (req, res) => {
    res.send('🤖 Servidor TRBot IA está Online!');
});

app.post('/api/pair-code', async (req, res) => {
    const phoneNumber = req.body.phone;

    if (!phoneNumber) return res.status(400).json({ error: 'Número obrigatório.' });

    try {
        const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');

        if (sock) {
            try { sock.ev.removeAllListeners(); sock.ws.close(); } catch (e) {}
            sock = null;
        }

        if (fs.existsSync('auth_info_baileys')) {
            fs.rmSync('auth_info_baileys', { recursive: true, force: true });
        }

        const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
        
        // CORREÇÃO: Forçar a procura da versão mais recente do WhatsApp Web
        const { version, isLatest } = await fetchLatestBaileysVersion();
        console.log(`A utilizar WhatsApp Web versão v${version.join('.')}, isLatest: ${isLatest}`);

        sock = makeWASocket({
            version, // Usa a versão mais recente
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: "silent" }),
            // CORREÇÃO: Usa a assinatura padrão da biblioteca para evitar bloqueios
            browser: Browsers.ubuntu('Chrome'), 
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 0,
            keepAliveIntervalMs: 10000,
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', (update) => {
            if (update.connection === 'open') {
                console.log('✅ WhatsApp conectado com sucesso!');
            }
        });

        setTimeout(async () => {
            try {
                if (sock.authState.creds.registered) {
                    return res.status(400).json({ error: 'Já associado.' });
                }
                
                console.log(`A pedir código para o número: ${cleanNumber}`);
                const code = await sock.requestPairingCode(cleanNumber);
                const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
                
                console.log(`Código gerado: ${formattedCode}`);
                if (!res.headersSent) res.json({ code: formattedCode });
            } catch (err) {
                console.error('Erro na Meta:', err);
                if (!res.headersSent) res.status(500).json({ error: 'O WhatsApp rejeitou. Tente retirar ou colocar o 9º dígito.' });
            }
        }, 3000); 

    } catch (error) {
        if (!res.headersSent) res.status(500).json({ error: 'Falha interna.' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor a rodar na porta ${PORT}`));
