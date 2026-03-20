const express = require('express');
const cors = require('cors');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(cors({ origin: '*' }));

let sock = null;

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

        sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: "silent" }),
            browser: ["Mac OS", "Chrome", "109.0.5414.120"], 
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', (update) => {
            if (update.connection === 'open') {
                console.log('✅ WhatsApp conectado com sucesso!');
            }
        });

        // Aguarda 3 segundos para o sistema respirar antes de pedir o código
        setTimeout(async () => {
            try {
                if (sock.authState.creds.registered) {
                    return res.status(400).json({ error: 'Já associado.' });
                }
                
                const code = await sock.requestPairingCode(cleanNumber);
                const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
                
                console.log(`Código gerado: ${formattedCode}`);
                
                if (!res.headersSent) res.json({ code: formattedCode });
            } catch (err) {
                if (!res.headersSent) res.status(500).json({ error: 'Erro ao gerar o código. Verifique o formato do número.' });
            }
        }, 3000); 

    } catch (error) {
        if (!res.headersSent) res.status(500).json({ error: 'Falha interna.' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor a rodar na porta ${PORT}`));
