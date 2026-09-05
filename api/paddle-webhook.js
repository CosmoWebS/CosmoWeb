// /api/paddle-webhook.js
//
// Принимает вебхуки от Paddle после успешной оплаты Cosmo Premium.
// Проверяет подпись запроса, достаёт discord_id из custom_data,
// и дёргает внутренний API бота, чтобы он сам начислил Premium и прислал DM.
//
// Переменные окружения (Vercel → Settings → Environment Variables):
//   PADDLE_WEBHOOK_SECRET  — Notification destination secret key (Paddle Dashboard → Developer Tools → Notifications)
//   BOT_API_URL            — например https://ваш-сервер-бота:8787/grant-premium
//   BOT_API_SECRET         — тот же секрет, что задан в PREMIUM_API_SECRET на стороне бота
//
// Требуется зависимость: npm install @paddle/paddle-node-sdk

import { Paddle, EventName } from "@paddle/paddle-node-sdk";

// Сопоставление Price ID (из Paddle Dashboard → Catalog → Products) с количеством дней Premium
const PRICE_TO_DAYS = {
    "pri_01m19a3jxscrcn28t7g6cz4817": 3,
    "pri_01m19a54evbpxpqnaep0jf0e5x": 7,
    "pri_01m19a7c2akfzej1a3phsejnba": 14,
};

// Нужен "сырой" (не распарсенный) body для проверки подписи Paddle
export const config = {
    api: {
        bodyParser: false,
    },
};

async function getRawBody(req) {
    const chunks = [];
    for await (const chunk of req) {
        chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
}

const paddle = new Paddle(process.env.PADDLE_API_KEY || "");

export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).send("Method Not Allowed");
    }

    let rawBody;
    try {
        rawBody = await getRawBody(req);
    } catch (err) {
        console.error("Не удалось прочитать тело запроса:", err);
        return res.status(400).send("Bad Request");
    }

    const signature = req.headers["paddle-signature"];
    const webhookSecret = process.env.PADDLE_WEBHOOK_SECRET;

    let event;
    try {
        event = await paddle.webhooks.unmarshal(rawBody, webhookSecret, signature);
    } catch (err) {
        console.error("Неверная подпись Paddle-вебхука:", err.message);
        return res.status(401).send("Invalid signature");
    }

    // Обрабатываем только успешно завершённые разовые платежи
    if (event.eventType === EventName.TransactionCompleted) {
        const tx = event.data;

        const discordId = tx.customData?.discord_id;
        const priceId = tx.items?.[0]?.price?.id;
        const days = PRICE_TO_DAYS[priceId];

        if (!discordId || !days) {
            console.warn("Платёж без discord_id или неизвестный priceId:", { discordId, priceId });
            return res.status(200).json({ received: true, skipped: true });
        }

        try {
            const botResponse = await fetch(process.env.BOT_API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${process.env.BOT_API_SECRET}`,
                },
                body: JSON.stringify({ discord_id: discordId, days }),
            });

            if (!botResponse.ok) {
                const errText = await botResponse.text();
                console.error("Бот отклонил запрос на начисление Premium:", botResponse.status, errText);
                // Всё равно отвечаем Paddle 200 — иначе он будет ретраить вебхук бесконечно.
                // Ошибку нужно смотреть в логах Vercel и логах бота.
            }
        } catch (err) {
            console.error("Не удалось достучаться до API бота:", err);
        }
    }

    return res.status(200).json({ received: true });
}
