const express = require('express');
const cors = require('cors');
const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const pino = require('pino');

const app = express();
app.use(express.json());

// Permitir que o PWA (no GitHub Pages) comunique com este servidor
app.use(cors({ origin: '*' }));

let sock;

// ROTA PARA GERAR O CÓDIGO DE APARELHO (Pairing Code)
app.post('/api/pair-code', async (req, res) => {
    const phoneNumber = req.body.phone;

    if (!phoneNumber) {
        return res.status(400).json({ error: 'Número de telemóvel é obrigatório.' });
    }

    try {
        const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

        sock = makeWASocket({
            auth: state,
            printQRInTerminal: false, 
            logger: pino({ level: "silent" }),
            browser: ["TRBot IA", "Chrome", "1.0.0"], 
        });

        sock.ev.on('creds.update', saveCreds);

        setTimeout(async () => {
            try {
                const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
                const code = await sock.requestPairingCode(cleanNumber);
                const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
                
                console.log(`Código gerado para ${cleanNumber}: ${formattedCode}`);
                res.json({ code: formattedCode });
            } catch (err) {
                console.error("Erro ao pedir código:", err);
                res.status(500).json({ error: 'Erro ao gerar código na Meta. O número está correto?' });
            }
        }, 3000); 

    } catch (error) {
        console.error("Erro geral:", error);
        res.status(500).json({ error: 'Falha interna no servidor.' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor TRBot IA a correr na porta ${PORT}`);
});
