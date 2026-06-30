const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI; // Пароль будет скрыт в настройках Vercel

let cachedClient = null;

async function connectToDatabase() {
    if (cachedClient) return cachedClient;
    const client = new MongoClient(uri);
    await client.connect();
    cachedClient = client;
    return client;
}

module.exports = async (req, res) => {
    // Разрешаем сайту делать запросы (CORS)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    try {
        const client = await connectToDatabase();
        const db = client.db('cosmo_bot_db');
        const stats = await db.collection('stats').findOne({ _id: 'global_stats' });

        if (!stats) {
            return res.status(200).json({ servers: 0, users: 0 });
        }

        return res.status(200).json({
            servers: stats.servers || 0,
            users: stats.users || 0
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};