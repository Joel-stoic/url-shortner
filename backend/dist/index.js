import 'dotenv/config';
import express from 'express';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { redisClient } from './config/redis.js';
const app = express();
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
app.use(express.json());
// L1 CACHE (in-memory)
const memoryCache = new Map();
const MAX_CACHE_SIZE = 10000;
function setMemoryCache(key, value) {
    if (memoryCache.size >= MAX_CACHE_SIZE) {
        const firstKey = memoryCache.keys().next().value;
        if (firstKey)
            memoryCache.delete(firstKey); // FIFO eviction
    }
    memoryCache.set(key, value);
}
// CREATE SHORT URL
app.post('/shorten', async (req, res) => {
    try {
        const { originalUrl } = req.body;
        if (!originalUrl || typeof originalUrl !== 'string') {
            return res.status(400).json({ message: 'originalUrl is required' });
        }
        const shortCode = Math.random().toString(36).substring(2, 8);
        await prisma.url.create({
            data: { originalUrl, shortCode }
        });
        return res.status(201).json({
            shortUrl: `http://localhost:3000/${shortCode}`
        });
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Server error' });
    }
});
// REDIRECT WITH MULTI-LEVEL CACHE
app.get('/:code', async (req, res) => {
    try {
        const code = req.params.code;
        const cacheKey = `url:${code}`;
        // 1. MEMORY CACHE
        const memoryHit = memoryCache.get(code);
        if (memoryHit) {
            console.log(`[L1 HIT] ${code}`);
            return res.redirect(memoryHit);
        }
        // 2. REDIS CACHE
        const redisHit = await redisClient.get(cacheKey);
        if (redisHit) {
            console.log(`[L2 HIT] ${code}`);
            setMemoryCache(code, redisHit);
            return res.redirect(redisHit);
        }
        // 3. DATABASE
        console.log(`[DB HIT] ${code}`);
        const url = await prisma.url.findUnique({
            where: { shortCode: code }
        });
        if (!url) {
            return res.status(404).json({ message: 'URL not found' });
        }
        setMemoryCache(code, url.originalUrl);
        await redisClient.set(cacheKey, url.originalUrl, { EX: 3600 });
        return res.redirect(url.originalUrl);
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Server error' });
    }
});
app.listen(3000, () => console.log('Server running on port 3000'));
