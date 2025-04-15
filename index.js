const { Telegraf, Markup } = require('telegraf');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const fetch = require('node-fetch');
const crypto = require('crypto');

dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMINS = process.env.ADMINS?.split(',').map(Number) || [];
const SUPERADMINS = process.env.SUPERADMINS?.split(',').map(Number) || [];
const ALL_ADMINS = [...new Set([...ADMINS, ...SUPERADMINS])];

// Telefon raqamni olish tugmasi
const phoneRequestButton = Markup.keyboard([
    Markup.button.contactRequest('📱 Telefon raqamni yuborish')
]).oneTime().resize();

// Ro'yxatga olingan foydalanuvchilar
const registeredUsers = new Set();

// /start komandasi
bot.start(async (ctx) => {
    const chatId = ctx.from.id;

    try {
        const response = await fetch(`http://localhost:3000/users?chat_id=${chatId}`);
        const data = await response.json();

        if (data.length > 0) {
            registeredUsers.add(chatId);
            return ctx.reply("Admin fayl yuklashini kuting. Sizga ma'lumotlaringiz yuboriladi.");
        }

        return ctx.reply("Botdan foydalanish uchun telefon raqamingizni yuboring:", phoneRequestButton);

    } catch (err) {
        console.error("\u274c /start tekshirishda xatolik:", err.message);
        ctx.reply("Xatolik yuz berdi.");
    }
});

// Kontaktni qabul qilish va saqlash
bot.on('contact', async (ctx) => {
    const contact = ctx.message.contact;
    const chatId = ctx.from.id;

    if (!contact || !contact.phone_number) {
        return ctx.reply("Telefon raqamni yuborishda xatolik yuz berdi. Iltimos, qaytadan urinib ko'ring.");
    }

    const firstName = contact.first_name || ctx.from.first_name || "Noma'lum";
    const phone = contact.phone_number;
    let role = 'user';

    if (SUPERADMINS.includes(chatId)) {
        role = 'superadmin';
    } else if (ADMINS.includes(chatId)) {
        role = 'admin';
    }

    try {
        const exists = await fetch(`http://localhost:3000/users?chat_id=${chatId}`);
        const userData = await exists.json();

        if (userData.length === 0) {
            await fetch('http://localhost:3000/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    first_name: firstName,
                    phone_number: phone,
                    role: role
                })
            });

            registeredUsers.add(chatId);
            ctx.reply("Ro'yxatdan muvaffaqiyatli o'tdingiz! Admin fayl yuklaganda sizga ma'lumot yuboriladi.");
        } else {
            ctx.reply("Siz allaqachon ro'yxatdan o'tgansiz.");
        }
    } catch (err) {
        console.error("\u274c Kontakt saqlashda xatolik:", err.message);
        ctx.reply("Xatolik yuz berdi. Iltimos, keyinroq urinib ko'ring.");
    }
});

// Yuklangan fayllarni kuzatish
const processedFileIds = new Set();

bot.on('document', async (ctx) => {
    const { document } = ctx.message;
    const senderId = ctx.from.id;

    if (!ALL_ADMINS.includes(senderId)) {
        return ctx.reply("\u26d4\ufe0f Sizga fayl yuklashga ruxsat yo'q.");
    }

    if (!document.file_name.endsWith('.xlsx')) {
        return ctx.reply("Iltimos, faqat .xlsx formatdagi fayl yuboring.");
    }

    if (processedFileIds.has(document.file_id)) {
        return ctx.reply("\u26a0\ufe0f Bu fayl allaqachon qabul qilingan.");
    }

    processedFileIds.add(document.file_id);

    const fileName = `${Date.now()}_${document.file_name}`;
    const filePath = path.join(__dirname, fileName);

    try {
        const link = await ctx.telegram.getFileLink(document.file_id);
        const response = await fetch(link.href);
        const buffer = await response.arrayBuffer();
        fs.writeFileSync(filePath, Buffer.from(buffer));

        const workbook = XLSX.readFile(filePath);
        const data = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

        for (const row of data) {
            const name = row.user_full_name?.trim();
            const month = row["month "]?.trim();
            const org = row.organization_name?.trim();
            if (!name || !month || !org) continue;

            const checkRes = await fetch(`http://localhost:3000/data?user_full_name=${encodeURIComponent(name)}&month=${encodeURIComponent(month)}&organization_name=${encodeURIComponent(org)}`);
            const isExist = await checkRes.json();

            if (isExist.length === 0) {
                const uuid = crypto.randomUUID();
                row.id = uuid;

                await fetch('http://localhost:3000/data', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(row)
                });

                console.log(`✅ Yangi satr qo‘shildi: ${name} (${month})`);
            } else {
                console.log(`ℹ️ Mavjud: ${name} (${month})`);
            }
        }

        const allUsersResp = await fetch('http://localhost:3000/users');
        const allUsers = await allUsersResp.json();

        for (const user of allUsers) {
            const { chat_id, phone_number } = user;
            const userRows = data.filter(row =>
                String(row.phone_number).includes(phone_number)
            );

            if (userRows.length > 0) {
                const jsonText = JSON.stringify(userRows, null, 2);

                if (jsonText.length > 4000) {
                    const tempPath = `user_${chat_id}.json`;
                    fs.writeFileSync(tempPath, jsonText);
                    await ctx.telegram.sendDocument(chat_id, { source: tempPath });
                    fs.unlinkSync(tempPath);
                } else {
                    await ctx.telegram.sendMessage(chat_id, `<pre>${jsonText}</pre>`, { parse_mode: 'HTML' });
                }
            }
        }

        const fullJson = JSON.stringify(data, null, 2);
        if (fullJson.length > 4000) {
            const tempAdminPath = `admin_${senderId}_full.json`;
            fs.writeFileSync(tempAdminPath, fullJson);
            await ctx.telegram.sendDocument(senderId, { source: tempAdminPath });
            fs.unlinkSync(tempAdminPath);
        } else {
            await ctx.telegram.sendMessage(senderId, `<pre>${fullJson}</pre>`, { parse_mode: 'HTML' });
        }

        await ctx.reply("✅ Barcha foydalanuvchilarga ma'lumot yuborildi va fayl saqlandi.");

    } catch (err) {
        console.error("❌ Faylni qayta ishlashda xatolik:", err.message);
        ctx.reply(`Xatolik: ${err.message}`);
    } finally {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
});

// /users komandasi
bot.command('users', async (ctx) => {
    if (!ALL_ADMINS.includes(ctx.from.id)) return;

    const res = await fetch('http://localhost:3000/users');
    const users = await res.json();
    const list = users.map(u => `\ud83d\udcf1 ${u.first_name} - ${u.phone_number} (${u.role})`).join('\n');
    ctx.reply(`Botdan foydalanuvchilar ro'yxati:\n\n${list}`);
});

// Botni ishga tushirish
bot.launch();
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
