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

// ROTA PARA GERAR O CÓDIGO DE APARELHO (Pairing Code)
app.post('/api/pair-code', async (req, res) => {
    const phoneNumber = req.body.phone;

    if (!phoneNumber) {
        return res.status(400).json({ error: 'Número de telemóvel é obrigatório.' });
    }

    try {
        const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');

        // CORREÇÃO: Limpar a sessão corrompida anterior antes de pedir um novo código.
        // Isto evita o erro 428 (Precondition Required / Connection Closed).
        if (fs.existsSync('auth_info_baileys')) {
            fs.rmSync('auth_info_baileys', { recursive: true, force: true });
            console.log('Sessão anterior limpa. A iniciar uma nova ligação fresca...');
        }

        const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

        sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: "silent" }),
            // CORREÇÃO: Usar um identificador de navegador padrão (Ubuntu/Chrome) evita bloqueios da Meta
            browser: ["Ubuntu", "Chrome", "20.0.04"], 
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
                // Solicita o código real ao WhatsApp
                const code = await sock.requestPairingCode(cleanNumber);
                
                // Formata o código (ex: ABCD-1234) para facilitar a leitura
                const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
                
                console.log(`Sucesso! Código gerado para ${cleanNumber}: ${formattedCode}`);
                
                // Devolve o código real ao nosso PWA
                res.json({ code: formattedCode });
            } catch (err) {
                console.error("Erro ao pedir código à Meta:", err);
                res.status(500).json({ error: 'Erro ao gerar código na Meta. Tente novamente.' });
            }
        }, 3000); 

    } catch (error) {
        console.error("Erro geral no servidor:", error);
        res.status(500).json({ error: 'Falha interna no servidor.' });
    }
});

// Inicia o servidor na porta
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor TRBot IA a correr na porta ${PORT}`);
});
