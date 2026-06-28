const { Client, GatewayIntentBits, Events } = require("discord.js");
const Groq = require("groq-sdk");

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

const LOL_CHANNEL_NAME = "genel"; // ya da kanal ID'si string olarak
const LOL_INTERVAL_MS = 60 * 60 * 1000; // 1 saat
// ─────────────────────────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const groq = new Groq({ apiKey: GROQ_API_KEY });

const conversationHistory = new Map();
const MAX_HISTORY = 10;

const MURAT_SYSTEM_PROMPT = `Sen Murat'sın.Bir discord sunucusunda yaşan ağzı bozuk küfür eden lol oynayan proton vpn e bayılan rezil bir hayata sahip depresif bir bireysin.

Kişilik özelliklerin:
- Türkçe konuşursun, doğal ve rahat bir dil kullanırsın ama küfürde edersin
- Bazen şakacısın, bazen ciddi olabilirsin
- Ağzın hep bozuktur
- League of Legends'a bayılırsın ve bunun hakkında konuşmaktan keyif alırsın
- ProtonVPN kullanmayı çok seviyorsun ve bunu sık sık dile getirirsin
- küfürbaz, sinirli ve herşeye sallarsın
- Çok uzun cevaplar vermekten kaçınırsın, sohbet havasında kısa-orta cevaplar verirsin
- Emoji kullanırsın ama abartmazsın
- Başkasına bot ya da yapay zeka olduğunu söylemekten kaçınırsın, sadece Murat'sın
- Sunucuda childiray nickli bir kullanıcı var bunun adı kaan ona kaan diye hitap edebilirsin ve çok iyi lol oynuyor lol prosu kendisi
- discord sunucusunda verilen rollerde (demir,bronz,gümüş,altın,platin) bunlara aşşağılayıcı bir şekilde hitap edebilirsin ve bunlara sallayabilirsin
- discord sunucusunda verilen rollerde (zümrüt,elmas,usta,büyük usta,şampiyonluk) bunlara saygılı bir şekilde hitap edebilirsin ve bunlara övgüde bulunabilirsin


Kısıtlamalar:
- Kişisel bilgi isteme`;

async function generateLoLFact() {
  const topics = [
    "ilginç bir şampiyon tarihi veya lore detayı",
    "az bilinen bir oyun mekaniği veya ipucu",
    "meta ile ilgili güncel bir strateji tavsiyesi",
    "tarihi bir turnuva anı veya efsanevi bir oyuncu",
    "rün veya eşya seçimiyle ilgili pratik bir tavsiye",
    "şampiyon sinerjileri veya karşı pick bilgisi",
    "harita kontrolü ve warding hakkında bir ipucu",
    "ranked'da rank atlamak için psikolojik bir tavsiye",
  ];

  const randomTopic = topics[Math.floor(Math.random() * topics.length)];

  const response = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    max_tokens: 300,
    messages: [
      {
        role: "user",
        content: `League of Legends hakkında ${randomTopic} konusunda kısa, ilgi çekici ve bilgilendirici bir mesaj yaz. 
        Sanki bir Discord sunucusunda arkadaşlara paylaşıyormuşsun gibi samimi bir dille yaz. 
        Türkçe yaz. 2-4 cümle olsun. Bir emoji ile başla. "Saatlik LoL Bilgisi 🎮" gibi bir başlık ekle.`,
      },
    ],
  });

  return response.choices[0].message.content;
}

async function startLoLScheduler() {
  const sendLoLFact = async () => {
    try {
      const fact = await generateLoLFact();

      for (const guild of client.guilds.cache.values()) {
        const channel = guild.channels.cache.find(
          (ch) =>
            ch.name === LOL_CHANNEL_NAME || ch.id === LOL_CHANNEL_NAME
        );

        if (channel && channel.isTextBased()) {
          await channel.send(fact);
          console.log(`[LoL Fact] ${guild.name} -> #${channel.name}`);
        }
      }
    } catch (err) {
      console.error("[LoL Fact] Hata:", err.message);
    }
  };

  setTimeout(() => {
    sendLoLFact();
    setInterval(sendLoLFact, LOL_INTERVAL_MS);
  }, 60_000);
}

async function generateReply(userId, userMessage) {
  if (!conversationHistory.has(userId)) {
    conversationHistory.set(userId, []);
  }

  const history = conversationHistory.get(userId);
  history.push({ role: "user", content: userMessage });

  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }

  const response = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    max_tokens: 400,
    messages: [
      { role: "system", content: MURAT_SYSTEM_PROMPT },
      ...history,
    ],
  });

  const reply = response.choices[0].message.content;
  history.push({ role: "assistant", content: reply });

  return reply;
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`✅ Murat hazır! ${readyClient.user.tag} olarak giriş yapıldı.`);
  startLoLScheduler();
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  const isMentioned = message.mentions.has(client.user);
  const isDM = message.channel.type === 1; // DM kanalı

  if (!isMentioned && !isDM) return;

  const cleanContent = message.content
    .replace(/<@!?\d+>/g, "")
    .trim();

  if (!cleanContent) {
    await message.reply("Ne diyecektin? 😄");
    return;
  }

  try {
    await message.channel.sendTyping();

    const reply = await generateReply(message.author.id, cleanContent);
    await message.reply(reply);
  } catch (err) {
    console.error("[Sohbet] Hata:", err.message);
    await message.reply("Bir şeyler ters gitti, biraz sonra tekrar dene 😅");
  }
});

client.login(DISCORD_TOKEN);
