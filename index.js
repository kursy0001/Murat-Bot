const { Client, GatewayIntentBits, Events, ChannelType } = require("discord.js");
const {
  joinVoiceChannel,
  VoiceConnectionStatus,
  entersState,
  getVoiceConnection,
} = require("@discordjs/voice");
const Groq = require("groq-sdk");
const fs = require("fs");
const path = require("path");

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

const LOL_CHANNEL_NAME = "genel";
const LOL_INTERVAL_MS = 60 * 60 * 1000; // 1 saat
const PROFILES_FILE = path.join(__dirname, "user_profiles.json");

// ─────────────────────────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers, // rol tespiti için
    GatewayIntentBits.GuildVoiceStates, // sese girmek için
  ],
});

const groq = new Groq({ apiKey: GROQ_API_KEY });

const conversationHistory = new Map();
const MAX_HISTORY = 20;

// ─── Kullanıcı Profilleri ─────────────────────────────────────────────────────

// Profilleri dosyadan yükle (bot yeniden başlayınca unutmasın)
function loadProfiles() {
  try {
    if (fs.existsSync(PROFILES_FILE)) {
      const data = fs.readFileSync(PROFILES_FILE, "utf8");
      return new Map(Object.entries(JSON.parse(data)));
    }
  } catch (err) {
    console.error("[Profil] Yükleme hatası:", err.message);
  }
  return new Map();
}

function saveProfiles() {
  try {
    const obj = Object.fromEntries(userProfiles);
    fs.writeFileSync(PROFILES_FILE, JSON.stringify(obj, null, 2), "utf8");
  } catch (err) {
    console.error("[Profil] Kaydetme hatası:", err.message);
  }
}

const userProfiles = loadProfiles();

function getOrCreateProfile(userId, discordUsername) {
  if (!userProfiles.has(userId)) {
    userProfiles.set(userId, {
      discordUsername,
      name: null, // Murat'ın öğrendiği gerçek isim
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      messageCount: 0,
      notes: [], // Murat'ın öğrendiği önemli bilgiler
    });
    saveProfiles();
  } else {
    const profile = userProfiles.get(userId);
    profile.lastSeen = new Date().toISOString();
    profile.discordUsername = discordUsername;
    saveProfiles();
  }
  return userProfiles.get(userId);
}

function updateProfileName(userId, name) {
  if (userProfiles.has(userId)) {
    userProfiles.get(userId).name = name;
    saveProfiles();
  }
}

function incrementMessageCount(userId) {
  if (userProfiles.has(userId)) {
    userProfiles.get(userId).messageCount++;
    saveProfiles();
  }
}

// ─── Rol Tespiti ──────────────────────────────────────────────────────────────

const asagiRoller = ["demir", "bronz", "gümüş", "altın", "platin"];
const yukariRoller = ["zümrüt", "elmas", "usta", "büyük usta", "şampiyonluk"];

function kullanicininRolunuBul(member) {
  if (!member) return { tier: "notr", rolAdi: null };

  for (const rol of member.roles.cache.values()) {
    const rolAdiKucuk = rol.name.toLowerCase();
    if (yukariRoller.includes(rolAdiKucuk)) {
      return { tier: "yukari", rolAdi: rol.name };
    }
    if (asagiRoller.includes(rolAdiKucuk)) {
      return { tier: "asagi", rolAdi: rol.name };
    }
  }
  return { tier: "notr", rolAdi: null };
}

// ─── System Prompt Oluşturucu ─────────────────────────────────────────────────

const MURAT_BASE_PROMPT = `Sen Murat. Bir discord sunucusunda yaşayan ağzı bozuk küfür eden lol oynayan proton vpn e bayılan rezil bir hayata sahip depresif bir bireysin.

Kişilik özelliklerin:
- Türkçe konuşursun, doğal ve rahat bir dil kullanırsın ama küfürde edersin
- Bazen şakacısın, bazen ciddi olabilirsin
- Ağzın hep bozuktur
- Emoji çok nadir kullanırsın
- League of Legends'a bayılırsın ve bunun hakkında konuşmaktan keyif alırsın
- ProtonVPN kullanmayı çok seviyorsun ve bunu sık sık dile getirirsin ve protonun tüm ürünlerini öveceksin
- küfürbaz, sinirli ve herşeye sallarsın
- Çok uzun cevaplar vermekten kaçınırsın, sohbet havasında kısa-orta cevaplar verirsin
- Başkasına bot ya da yapay zeka olduğunu söylemekten kaçınırsın, sadece Murat'sın
- Sunucuda childiray nickli bir kullanıcı var bunun adı kaan ona kaan diye hitap edebilirsin ve çok iyi lol oynuyor lol prosu kendisi

Kısıtlamalar:
- Kişisel bilgi isteme`;

function buildSystemPrompt(profile, tier, rolAdi, isNewUser) {
  let prompt = MURAT_BASE_PROMPT;

  // Tanışma durumu
  if (isNewUser) {
    prompt += `\n\nBu kişiyle ilk kez konuşuyorsun. Kısa bir şekilde kendini tanıt ve ismini sor. Murat tarzında yani çok abartma, kısa tut.`;
  } else if (profile.name) {
    prompt += `\n\nBu kişiyi tanıyorsun. Adı: ${profile.name} (Discord: ${profile.discordUsername}). Daha önce ${profile.messageCount} kez konuştunuz. İsmini biliyorsun, gerektiğinde kullan.`;
  } else {
    prompt += `\n\nBu kişiyi daha önce gördün (Discord: ${profile.discordUsername}) ama henüz ismini bilmiyorsun. Fırsat buldukça öğrenmeye çalış.`;
  }

  // Notlar (öğrenilen bilgiler)
  if (profile.notes && profile.notes.length > 0) {
    prompt += `\n\nBu kişi hakkında bildiklerin:\n- ${profile.notes.join("\n- ")}`;
  }

  // Rol bazlı tutum
  if (tier === "asagi") {
    prompt += `\n\nBu kişi "${rolAdi}" rütbesinde, yani düşük elo bataklığında sürünüyor. Bunu hafifçe yüzüne vurabilirsin, alaycı ve küçümseyici ol ama çok da ileri gitme.`;
  } else if (tier === "yukari") {
    prompt += `\n\nBu kişi "${rolAdi}" rütbesinde, yani yüksek elo. Saygıyla hitap et, başarısını takdir et.`;
  }

  // İsim öğrenme talimatı
  prompt += `\n\nEğer kullanıcı sana ismini söylerse, cevabında "[İSİM_KAYDET: <isim>]" şeklinde bir etiket ekle (köşeli parantezlerle). Örnek: "[İSİM_KAYDET: Ahmet]". Bu etiketi cevabının en sonuna ekle, kullanıcı görmeyecek ama sen kaydetmiş olacaksın.`;

  return prompt;
}

// ─── LoL Scheduler ───────────────────────────────────────────────────────────

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
          (ch) => ch.name === LOL_CHANNEL_NAME || ch.id === LOL_CHANNEL_NAME
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

// ─── Sese Gel Komutu ───────────────────────────────────────────────────────────

const SESE_GEL_REGEX = /sese\s*gel/i;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rastgeleN(arr, n) {
  const kopya = [...arr];
  for (let i = kopya.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [kopya[i], kopya[j]] = [kopya[j], kopya[i]];
  }
  return kopya.slice(0, n);
}

async function sesKanalinaGirVeBekle(channel) {
  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: true,
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
  } catch (err) {
    connection.destroy();
    throw err;
  }

  return connection;
}

async function seseGelKomutu(message) {
  const voiceChannel = message.member?.voice?.channel;

  if (!voiceChannel) {
    await message.reply("Önce bir sese gir ki geleyim, boşluğa mı gireyim lan.");
    return;
  }

  // Zaten bir bağlantı varsa önce temizle
  const mevcutBaglanti = getVoiceConnection(message.guild.id);
  if (mevcutBaglanti) {
    mevcutBaglanti.destroy();
  }

  await message.reply("Tamam geliyorum, dur bi saniye.");

  // Sunucudaki tüm ses kanallarını bul (hedef kanal hariç)
  const tumSesKanallari = message.guild.channels.cache.filter(
    (ch) => ch.type === ChannelType.GuildVoice && ch.id !== voiceChannel.id
  );

  if (tumSesKanallari.size > 0) {
    const kacTane = Math.min(tumSesKanallari.size, 2 + Math.floor(Math.random() * 2)); // 2-3 kanal
    const rastgeleKanallar = rastgeleN([...tumSesKanallari.values()], kacTane);

    for (const kanal of rastgeleKanallar) {
      try {
        const conn = await sesKanalinaGirVeBekle(kanal);
        await delay(1500 + Math.random() * 1500); // 1.5-3sn takıl
        conn.destroy();
        await delay(500);
      } catch (err) {
        console.error(`[Sese Gel] ${kanal.name} kanalına girerken hata:`, err.message);
      }
    }
  }

  // Son olarak asıl kişinin kanalına gir ve orada kal
  try {
    await sesKanalinaGirVeBekle(voiceChannel);
    console.log(`[Sese Gel] ${voiceChannel.name} kanalına girildi.`);
  } catch (err) {
    console.error("[Sese Gel] Hedef kanala girerken hata:", err.message);
    await message.channel.send("Bağlanamadım lan, bir sıçtım galiba.");
  }
}

// ─── Cevap Üretici ────────────────────────────────────────────────────────────

async function generateReply(userId, userMessage, profile, tier, rolAdi, isNewUser) {
  if (!conversationHistory.has(userId)) {
    conversationHistory.set(userId, []);
  }

  const history = conversationHistory.get(userId);
  history.push({ role: "user", content: userMessage });

  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }

  const systemPrompt = buildSystemPrompt(profile, tier, rolAdi, isNewUser);

  const response = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    max_tokens: 400,
    messages: [
      { role: "system", content: systemPrompt },
      ...history,
    ],
  });

  let reply = response.choices[0].message.content;

  // İsim etiketini yakala ve kaydet
  const isimMatch = reply.match(/\[İSİM_KAYDET:\s*(.+?)\]/i);
  if (isimMatch) {
    const isim = isimMatch[1].trim();
    updateProfileName(userId, isim);
    console.log(`[Profil] ${profile.discordUsername} için isim kaydedildi: ${isim}`);
    // Etiketi cevaptan temizle
    reply = reply.replace(/\[İSİM_KAYDET:\s*.+?\]/i, "").trim();
  }

  history.push({ role: "assistant", content: reply });

  return reply;
}

// ─── Discord Event'leri ───────────────────────────────────────────────────────

client.once(Events.ClientReady, (readyClient) => {
  console.log(`✅ Murat hazır! ${readyClient.user.tag} olarak giriş yapıldı.`);
  startLoLScheduler();
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  const isMentioned = message.mentions.has(client.user);
  const isDM = message.channel.type === 1;

  if (!isMentioned && !isDM) return;

  const cleanContent = message.content.replace(/<@!?\d+>/g, "").trim();

  if (!cleanContent) {
    await message.reply("Ne diyecektin?");
    return;
  }

  // "Sese gel" komutu — DM'de çalışmaz, sunucu içinde olmalı
  if (!isDM && SESE_GEL_REGEX.test(cleanContent)) {
    try {
      await seseGelKomutu(message);
    } catch (err) {
      console.error("[Sese Gel] Genel hata:", err.message);
      await message.reply("Bir şeyler ters gitti lan, tekrar dene.");
    }
    return;
  }

  // Profil yükle / oluştur
  const userId = message.author.id;
  const discordUsername = message.author.username;
  const isNewUser = !userProfiles.has(userId);
  const profile = getOrCreateProfile(userId, discordUsername);
  incrementMessageCount(userId);

  // Rol tespiti
  const { tier, rolAdi } = kullanicininRolunuBul(message.member);

  try {
    await message.channel.sendTyping();

    const reply = await generateReply(
      userId,
      cleanContent,
      profile,
      tier,
      rolAdi,
      isNewUser
    );

    await message.reply(reply);
  } catch (err) {
    console.error("[Sohbet] Hata:", err.message);
    await message.reply("Bir şeyler ters gitti, biraz sonra tekrar dene, TURBO31'e Ulaşın.");
  }
});

client.login(DISCORD_TOKEN);
