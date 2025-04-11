const { Telegraf } = require('telegraf');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const fetch = require('node-fetch');

dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMINS = process.env.ADMINS?.split(',').map(Number) || [];
const SUPERADMINS = process.env.SUPERADMINS?.split(',').map(Number) || [];
const ALL_ADMINS = [...new Set([...ADMINS, ...SUPERADMINS])];
const registeredUsers = new Set();



// JSON-serverga POST qilish funksiyasi
const sendToJsonServer = async (data) => {
    try {
        for (const item of data) {
            const response = await fetch('http://localhost:3000/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: item.user_full_name,
                    organization: item.organization_name,
                    estimated_monthly_salary: item.estimated_monthly_salary,
                    withholding: item.withholding,
                    monthly_salary: item.monthly_salary,
                    description: item.description
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('Server javobi:', errorText);
            } else {
                console.log(`✅ Ma'lumot json-serverga yuborildi`);
            }
        }
    } catch (err) {
        console.error("❌ json-serverga yuborishda xatolik:", err.message);
    }
};




bot.start((ctx) => {
    registeredUsers.add(ctx.from.id);
    ctx.reply("Assalomu alaykum! Excel (.xlsx) fayl yuboring. Adminlar faylni ko'rib chiqadi.");
});

bot.on('document', async (ctx) => {
    const { document } = ctx.message;
    const userId = ctx.from.id;

    if (!document.file_name.endsWith('.xlsx')) {
        return ctx.reply("Iltimos, faqat .xlsx formatdagi fayl yuboring.");
    }

    const fileName = `${Date.now()}_${document.file_name}`;
    const filePath = path.join(__dirname, fileName);

    try {
        const link = await ctx.telegram.getFileLink(document.file_id);
        const response = await fetch(link.href);
        const buffer = await response.arrayBuffer();
        fs.writeFileSync(filePath, Buffer.from(buffer));

        const workbook = XLSX.readFile(filePath);
        const data = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
        const jsonData = JSON.stringify(data, null, 2);

        if (ALL_ADMINS.includes(userId)) {
            // Adminlar uchun JSON reply
            if (jsonData.length > 4000) {
                const tempJsonPath = 'data.json';
                fs.writeFileSync(tempJsonPath, jsonData);
                await ctx.replyWithDocument({ source: tempJsonPath });
                fs.unlinkSync(tempJsonPath);
            } else {
                await ctx.replyWithHTML(`<pre>${jsonData}</pre>`);
            }

            // 🔥 json-serverga yuborish
            await sendToJsonServer(data);

            // Userlarga xabar yuborish + JSON yuborish
            for (const user of registeredUsers) {
                if (user !== userId) {
                    try {
                        await ctx.telegram.sendMessage(user, "Admin tomonidan fayl yuklandi. Mana ma'lumotlar:");
                        const userJson = JSON.stringify(data, null, 2);
                        if (userJson.length > 4000) {
                            fs.writeFileSync('userData.json', userJson);
                            await ctx.telegram.sendDocument(user, { source: 'userData.json' });
                            fs.unlinkSync('userData.json');
                        } else {
                            await ctx.telegram.sendMessage(user, `<pre>${userJson}</pre>`, { parse_mode: 'HTML' });
                        }
                    } catch (_) { }
                }
            }

        } else {
            // Userga tasdiqlovchi xabar
            await ctx.reply("Faylingiz qabul qilindi. Adminlar tez orada siz bilan bog'lanadi.");

            for (const adminId of ALL_ADMINS) {
                await ctx.telegram.sendMessage(adminId, `User @${ctx.from.username || userId} fayl yubordi.`);
            }
        }

    } catch (err) {
        ctx.reply(`Xatolik: ${err.message}`);
    } finally {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    }
});

bot.command('users', (ctx) => {
    if (ALL_ADMINS.includes(ctx.from.id)) {
        const usersText = Array.from(registeredUsers).map(u => `ID: ${u}`).join('\n');
        ctx.reply(`Ro'yxatdagi foydalanuvchilar:\n${usersText}`);
    }
});

bot.command('send', (ctx) => {
    if (ALL_ADMINS.includes(ctx.from.id)) {
        const parts = ctx.message.text.split(' ');
        if (parts.length < 3) {
            return ctx.reply("/send <user_id> <xabar>");
        }
        const userId = Number(parts[1]);
        const text = parts.slice(2).join(' ');
        ctx.telegram.sendMessage(userId, text)
            .then(() => ctx.reply("Xabar yuborildi ✅"))
            .catch(err => ctx.reply(`Xatolik: ${err.message}`));
    }
});

bot.launch();
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
