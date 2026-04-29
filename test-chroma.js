require('dotenv').config();
const { ChromaClient } = require('chromadb');

async function test() {
    const chromaUrl = process.env.CHROMA_SERVER_URL || 'http://localhost:8000';
    const urlObj = new URL(chromaUrl);
    
    const client = new ChromaClient({
        host: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
        ssl: urlObj.protocol === 'https:',
        headers: process.env.CHROMA_SERVER_TOKEN ? {
            Authorization: `Bearer ${process.env.CHROMA_SERVER_TOKEN}`
        } : {}
    });
    try {
        const hb = await client.heartbeat();
        console.log("Heartbeat success:", hb);
    } catch(e) {
        console.error("Heartbeat error:", e.message);
    }
}
test();
