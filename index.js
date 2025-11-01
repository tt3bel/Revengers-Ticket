// تحميل متغيرات البيئة من ملف .env
require('dotenv').config();

const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ChannelType, PermissionsBitField, AttachmentBuilder } = require('discord.js');
const fs = require('fs');

// إنشاء عميل Discord
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

// --- متغيرات من ملف .env ---
const {
    DISCORD_TOKEN,
    TICKET_PANEL_IMAGE_URL,
    ADMIN_ROLE_ID,
    TICKET_CATEGORY_ID,
    CLOSED_TICKET_CATEGORY_ID,
    TRANSCRIPT_CHANNEL_ID,
    LOG_CHANNEL_ID,
    TICKET_BUTTON_EMOJI_ID
} = process.env;

// --- بيانات البوت ---
const PREFIX = '-';
const EMBED_COLOR = '#bc1215';
let ticketCounter = 1;
const ticketData = new Map(); // لتخزين بيانات التذاكر المفتوحة

// --- أحداث البوت ---

// عندما يصبح البوت جاهزاً
client.once('clientReady', async () => {
    console.log(`تم تسجيل الدخول بنجاح! | ${client.user.tag}`);
    
    // --- تعيين حالة البوت ---
    client.user.setStatus('dnd');
    client.user.setActivity({ name: 'revengers', type: ActivityType.Watching });
    
    await setupTicketPanel();
    loadTicketCounter();
});

// عند إنشاء تفاعل (مثل الضغط على زر)
client.on('interactionCreate', async (interaction) => {
    try {
        if (!interaction.isButton()) return;

        if (interaction.customId === 'create_ticket') {
            await createTicket(interaction);
        }
    } catch (error) {
        console.error('حدث خطأ في معالجة التفاعل:', error); // سيظهر الخطأ الحقيقي هنا في الطرفية
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'حدث خطأ غير متوقع.', flags: [64] }).catch(() => {});
        }
    }
});

// عند إرسال رسالة
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.content.startsWith(PREFIX)) return;

    const ticketInfo = ticketData.get(message.channel.id);
    if (!ticketInfo) return; // التأكد من أن الأمر يُستخدم في روم تذكرة

    const isAdmin = message.member.roles.cache.has(ADMIN_ROLE_ID) || message.member.permissions.has(PermissionsBitField.Flags.Administrator);
    if (!isAdmin) {
        return message.reply({ content: 'لا تملك الصلاحية لاستخدام هذا الأمر.', flags: [64] });
    }

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === 'name') {
        const newName = args.join(' ');
        if (!newName) return message.reply('الرجاء كتابة الاسم الجديد. مثال: `-name test`');
        
        const finalName = `${newName}-${ticketInfo.ticketNumber}`;
        await message.channel.setName(finalName);
        ticketInfo.originalName = finalName;
        ticketData.set(message.channel.id, ticketInfo);

        await message.reply({ embeds: [new EmbedBuilder().setColor(EMBED_COLOR).setDescription(`✅ تم تغيير اسم التذكرة إلى: \`${finalName}\``)] });
        logAction('Rename Ticket', message.author, `New Name: ${finalName}`, message.channel);

    } else if (command === 'cr') {
        await closeTicket(message.channel, message.author);
    }
});

// --- وظائف رئيسية ---

// إعداد لوحة التذاكر
async function setupTicketPanel() {
    const guild = client.guilds.cache.first();
    if (!guild) return console.log('لم يتم العثور على السيرفر.');

    let ticketChannel = guild.channels.cache.find(c => c.name === '🎫-انشاء-تذكرة' && c.type === ChannelType.GuildText);
    if (!ticketChannel) {
        ticketChannel = await guild.channels.create({
            name: '🎫-انشاء-تذكرة',
            type: ChannelType.GuildText,
            permissionOverwrites: [{ id: guild.id, deny: [PermissionsBitField.Flags.SendMessages] }]
        });
    }

    await ticketChannel.bulkDelete(100, true).catch(() => {});

    const panelEmbed = new EmbedBuilder()
        .setTitle('Revengers Ticket System ')
        .setDescription('Revengers Gang Apply Ticket - تكت التقديم على عصابه ريفنجرز\n\n- يرجى عدم منشن المسؤولين لتجنب الازعاج')
        .setColor(EMBED_COLOR)
        .setImage(TICKET_PANEL_IMAGE_URL)
        .setFooter({ text: `Ticket System ${new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}` });

    const ticketEmoji = client.emojis.cache.get(TICKET_BUTTON_EMOJI_ID);

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('create_ticket')
                .setLabel('إنشاء تذكرة')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji(ticketEmoji ? ticketEmoji.id : '🎫')
        );

    await ticketChannel.send({ embeds: [panelEmbed], components: [row] });
}

// إنشاء تذكرة جديدة (الدالة التي كانت مفقودة)
async function createTicket(interaction) {
    const guild = interaction.guild;
    const member = interaction.member;

    // --- التحقق الجديد: البحث في ذاكرة البوت عن تذكرة مفتوحة للمستخدم ---
    let existingTicketChannel = null;
    for (const [channelId, ticketDataEntry] of ticketData.entries()) {
        if (ticketDataEntry.userId === member.id) {
            existingTicketChannel = client.channels.cache.get(channelId);
            break; // تم العثور على تذكرة مفتوحة، توقف عن البحث
        }
    }

    if (existingTicketChannel) {
        return interaction.reply({ content: `لديك بالفعل تذكرة مفتوحة: ${existingTicketChannel}`, flags: [64] });
    }

    const ticketNumber = String(ticketCounter).padStart(4, '0');
    const category = guild.channels.cache.get(TICKET_CATEGORY_ID);
    if (!category) {
        return interaction.reply({ content: 'لم يتم العثور على قسم التذاكر، يرجى التواصل مع الإدارة.', flags: [64] });
    }

    await interaction.deferReply({ flags: [64] });

    try {
        const ticketChannel = await guild.channels.create({
            name: ticketNumber,
            type: ChannelType.GuildText,
            parent: category,
            topic: `ticket-${member.id}`,
            permissionOverwrites: [
                { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: member.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.AttachFiles, PermissionsBitField.Flags.EmbedLinks, PermissionsBitField.Flags.ReadMessageHistory] },
                { id: ADMIN_ROLE_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.AttachFiles, PermissionsBitField.Flags.EmbedLinks, PermissionsBitField.Flags.ReadMessageHistory] }
            ]
        });

        ticketData.set(ticketChannel.id, { userId: member.id, ticketNumber, originalName: ticketNumber, createdAt: new Date() });
        ticketCounter++;
        saveTicketCounter();

        const formEmbed = new EmbedBuilder()
            .setTitle('Revengers Apply Form - نموذج تقديم ريفنجرز')
            .setColor(EMBED_COLOR)
            .setDescription(`
**Character Name ( اسم الشخصيه ) :**
**Character ID ( ايدي الشخصيه ) :**
**Character Hours ( ساعات شخصيتك ) :**
**Character Level ( لفل شخصيتك ) :**
**Daily Voice Hours ( ساعات تفاعلك داخل فويس العصابه ) :**
**Daily MTA Hours ( ساعات تفاعلك داخل اللعبه ) :**
ـــــــ
**RolePlay Rules - قواعد الرول بلاي**
**MG :**
**DM :**
**GR :**
**MD :**
**PG :**
**PD :**
**SK :**
**DOS :**
**KOS :**
**RK :**
            `)
            .setFooter({ text: `Opened at: ${new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}` });

        await ticketChannel.send({ content: `${member.user} ${guild.roles.cache.get(ADMIN_ROLE_ID)}`, embeds: [formEmbed] });
        
        logAction('Create Ticket', member.user, `Ticket Number: ${ticketNumber}`, ticketChannel);
        
        await interaction.editReply({ content: `تم إنشاء تذكرتك بنجاح: ${ticketChannel}` });

    } catch (error) {
        console.error("حدث خطأ أثناء إنشاء التذكرة:", error);
        if (!interaction.replied) {
            await interaction.editReply({ content: 'حدث خطأ ما أثناء محاولة إنشاء تذكرتك. يرجى التواصل مع الإدارة.' });
        }
    }
}

// إغلاق التذكرة (تم حذف النسخة المكررة)
async function closeTicket(channel, closedBy) {
    const ticketInfo = ticketData.get(channel.id);
    if (!ticketInfo) return;

    const messages = await channel.messages.fetch({ limit: 100 });
    const transcriptContent = messages.map(m => `[${new Date(m.createdTimestamp).toLocaleString('en-US')}] ${m.author.tag}: ${m.content}`).join('\n');
    const transcriptAttachment = new AttachmentBuilder(Buffer.from(transcriptContent, 'utf-8'), { name: `transcript-${ticketInfo.ticketNumber}.txt` });

    const transcriptEmbed = new EmbedBuilder()
        .setTitle('Ticket - Transcript')
        .setColor(EMBED_COLOR)
        .addFields(
            { name: 'Server', value: channel.guild.name, inline: true },
            { name: 'Channel', value: channel.name, inline: true },
            { name: 'Messages', value: `${messages.size}`, inline: true },
            { name: 'Ticket Owner', value: `<@${ticketInfo.userId}>`, inline: true },
            { name: 'Ticket', value: `#${ticketInfo.ticketNumber}`, inline: true },
            { name: 'Panel', value: 'Revengers Ticket', inline: true },
            { name: 'Transcript Users', value: `<@${ticketInfo.userId}>\n<@&${ADMIN_ROLE_ID}>`, inline: true }
        )
        .setFooter({ text: `Closed by: ${closedBy.tag}` })
        .setTimestamp();

    const transcriptChannel = channel.guild.channels.cache.get(TRANSCRIPT_CHANNEL_ID);
    if (transcriptChannel) {
        await transcriptChannel.send({ embeds: [transcriptEmbed], files: [transcriptAttachment] });
    }

    logAction('Close Ticket', closedBy, `Ticket Number: ${ticketInfo.ticketNumber}`, channel);

    const closedCategory = channel.guild.channels.cache.get(CLOSED_TICKET_CATEGORY_ID);
    if (closedCategory) {
        await channel.setParent(closedCategory);
        await channel.lockPermissions();
        await channel.setName(`${ticketInfo.originalName}`);
    }

    const closingTime = new Date().toLocaleString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });

    const inChannelEmbed = new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle('Ticket Closed')
        .setDescription(`Ticket Closed by <@${closedBy.id}>`)
        .setFooter({ text: `${closingTime}` });

    await channel.send({ embeds: [inChannelEmbed] });

    try {
        const ticketOwner = await client.users.fetch(ticketInfo.userId);
        const dmEmbed = new EmbedBuilder()
            .setColor(EMBED_COLOR)
            .setTitle('Your Ticket Closed')
            .setDescription(`Your ticket (#${ticketInfo.ticketNumber}) has been closed.`)
            .addFields(
                { name: 'Closed by', value: `<@${closedBy.id}>`, inline: true },
                { name: 'Time', value: closingTime, inline: true }
            )
            .setTimestamp();
        await ticketOwner.send({ embeds: [dmEmbed] });
    } catch (error) {
        console.log(`لم أتمكن من إرسال رسالة خاصة لصاحب التذكرة (ID: ${ticketInfo.userId})، قد يكون الخاص مغلقاً.`);
    }

    ticketData.delete(channel.id);
}

// --- وظائف مساعدة ---

// تسجيل الأحداث في روم اللوج
function logAction(action, user, details, channel) {
    const logChannel = client.channels.cache.get(LOG_CHANNEL_ID);
    if (!logChannel) return;

    const logEmbed = new EmbedBuilder()
        .setTitle(`System Logs - ${action}`)
        .setColor(EMBED_COLOR)
        .addFields(
            { name: 'مسؤول', value: `<@${user.id}>`, inline: true },
            { name: 'التفاصيل', value: details, inline: true },
            { name: 'القناة', value: `${channel}`, inline: true }
        )
        .setTimestamp();

    logChannel.send({ embeds: [logEmbed] });
}

// حفظ عداد التذاكر
function saveTicketCounter() {
    fs.writeFileSync('./ticketCounter.json', JSON.stringify({ counter: ticketCounter }));
}

// تحميل عداد التذاكر
function loadTicketCounter() {
    try {
        const data = fs.readFileSync('./ticketCounter.json', 'utf8');
        ticketCounter = JSON.parse(data).counter || 1;
    } catch (err) {
        console.log('لم يتم العثور على ملف العداد، سيتم البدء من 1.');
        saveTicketCounter();
    }
}

// تسجيل الدخول للبوت
client.login(DISCORD_TOKEN);