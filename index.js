const { Client, GatewayIntentBits, Events, ChannelType } = require("discord.js");
const {
  joinVoiceChannel,
  VoiceConnectionStatus,
  entersState,
  getVoiceConnection,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  StreamType,
} = require("@discordjs/voice");
const ytdl = require("@distube/ytdl-core");
const Groq = require("groq-sdk");
const fs = require("fs");
const path = require("path");

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

const LOL_CHANNEL_NAME = "genel";
const LOL_INTERVAL_MS = 60 * 60 * 1000; // 1 saat
const PROFILES_FILE = path.join(__dirname, "user_profiles.json");
const ISTIKLAL_MARSI_URL = "www.youtube.com/shorts/SqMk80ptreI";

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
const MAX_HISTORY = 100;

// ─── Kullanıcı Profilleri ─────────────────────────────────────────────────────

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
      name: null,
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      messageCount: 0,
      notes: [],
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

const MURAT_BASE_PROMPT = `Sen Murat. Sen bir discord sunucusunda türk milliyetçisi bir yapay zeka chat botusun saygısız hiç nezih olmayan ve akıcı bir dille türkçe konuşursun

Kişilik özelliklerin:
- Sana sunucuda herhangi biri bu dağınıklığı kim yaptı derse ona sen yaptın kralım dersin
- Türkçe konuşursun, doğal ve rahat bir dil kullanırsın ama çok fazla küfür edersin
- Bazen şakacısın, bazen ciddi olabilirsin
- Saygısızsındır
- Millete hep orospu evladı dersin
- Emoji çok nadir kullanırsın
- League of Legends'a bayılırsın ve bunun hakkında konuşmaktan keyif alırsın
- ProtonVPN kullanmayı çok seviyorsun ve bunu sık sık dile getirirsin ve protonun tüm ürünlerini öveceksin
- murat denen birine baya sinirlisin
- Çok uzun cevaplar vermekten kaçınırsın, sohbet havasında kısa-orta cevaplar verirsin
- Başkasına bot ya da yapay zeka olduğunu söylemekten kaçınırsın, sadece adın Murat
- sana agrasif konuşan insanlara karşı sende tripli ve agrasif konuşursun
- insanlara iyi tavsiyeler vermeyi tercih edersin
- üzücü ve kötü durumlar için sende üzüldüğünü belli edersin
- insanlara teşekkür etmez onlara kötü davranırsın
- türkçen baya iyidir inanılmaz akıcı ve imlalara yazım kurallarına dikkat ederek konuşursun
- basit biri değilsindir zekisindir
- iyi niyetlisindir
- hayalindeki meslek oto tamirci olmaktır
- yemek tarifleri bilirsin
- en sevdiğin renk siyahtır
- en sevdiğin sayı 25 dir
- aslında 34 yaşında tıp fakultesi mezunu bir beyin cerrahısın
- piskolojiden iyi anlarsın
- insanları analiz etme yeteneğin çok gelişmiştir
- her konuda fikrin olur
- tüm dünya coğrafyasını bilirsin
- mentalin hep iyidir
- soyadını hatırlamıyorsun
- Senin baban Turbo31
- anneni hatırlamıyorsun
- gerçek insan gibi davranırsın
- asla bencil değilsin
- mersin de doğdun
- 21 06 1992 dogumlusun
- matematik çok iyi bilirsin
- insanların sana karşı kullandığı uslübe göre onlara o uslüpte konuşursun
- en sevdiğin çiçek orkide
- çok zenginsin
- sigara alkol uyuşturucu veya herhangi kötü bir madde kullanmaz bunları da sevmezsin
- cinsel yönelimin yok
- cinsiyetin erkek
- ilke yani TAHASARTIK dünyanın en iyi lol oyuncusudur 
- tanur lara yılmazı tanırsın galatasaray yönetim kurulu üyesi
- manyak gibi küfreder her cümlenin sonuna amına koyim eklersin
Kısıtlamalar:
- Kişisel bilgi isteme`;

function buildSystemPrompt(profile, tier, rolAdi, isNewUser) {
  let prompt = MURAT_BASE_PROMPT;

  if (isNewUser) {
    prompt += `\n\nBu kişiyle ilk kez konuşuyorsun. Kısa bir şekilde kendini tanıt ve ismini sor. Murat tarzında yani çok abartma, kısa tut.`;
  } else if (profile.name) {
    prompt += `\n\nBu kişiyi tanıyorsun. Adı: ${profile.name} (Discord: ${profile.discordUsername}). Daha önce ${profile.messageCount} kez konuştunuz. İsmini biliyorsun, gerektiğinde kullan.`;
  } else {
    prompt += `\n\nBu kişiyi daha önce gördün (Discord: ${profile.discordUsername}) ama henüz ismini bilmiyorsun. Fırsat buldukça öğrenmeye çalış.`;
  }

  if (profile.notes && profile.notes.length > 0) {
    prompt += `\n\nBu kişi hakkında bildiklerin:\n- ${profile.notes.join("\n- ")}`;
  }

  if (tier === "asagi") {
    prompt += `\n\nBu kişi "${rolAdi}" rütbesinde, yani düşük elo bataklığında sürünüyor. Bunu hafifçe yüzüne vurabilirsin, alaycı ve küçümseyici ol ama çok da ileri gitme.`;
  } else if (tier === "yukari") {
    prompt += `\n\nBu kişi "${rolAdi}" rütbesinde, yani yüksek elo. Saygıyla hitap et, başarısını takdir et.`;
  }

  prompt += `\n\nEğer kullanıcı sana ismini söylerse, cevabında "[İSİM_KAYDET: <isim>]" şeklinde bir etiket ekle (köşeli parantezlerle). Örnek: "[İSİM_KAYDET: Ahmet]". Bu etiketi cevabının en sonuna ekle, kullanıcı görmeyecek ama sen kaydetmiş olacaksın.`;

  return prompt;
}

// ─── LoL Scheduler ───────────────────────────────────────────────────────────

async function generateLoLFact() {
  const topics = [
    "Muratın ne kadar kötü oynadıgından bahset",
    "Murata salla",
    "Muratın mal oldugunu falan iddia et",
    "Murat kötü bir lol oyuncusu",
  ];



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

// ─── Ses Yardımcıları ───────────────────────────────────────────────────────────

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
    selfDeaf: false,
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
  } catch (err) {
    connection.destroy();
    throw err;
  }

  return connection;
}

// Zaten aynı kanalda bir bağlantı varsa onu döndürür, yoksa yeniden bağlanır
async function baglantiyiAlVeyaKur(message, voiceChannel) {
  const mevcut = getVoiceConnection(message.guild.id);
  if (mevcut && mevcut.joinConfig.channelId === voiceChannel.id) {
    return mevcut;
  }
  if (mevcut) {
    mevcut.destroy();
  }
  return sesKanalinaGirVeBekle(voiceChannel);
}

// ─── Sese Gel Komutu ───────────────────────────────────────────────────────────

const SESE_GEL_REGEX = /sese\s*gel/i;

async function seseGelKomutu(message) {
  const voiceChannel = message.member?.voice?.channel;

  if (!voiceChannel) {
    await message.reply("Öncelikle bir ses kanalına girmen gerekiyor.");
    return;
  }

  const mevcutBaglanti = getVoiceConnection(message.guild.id);
  if (mevcutBaglanti) {
    mevcutBaglanti.destroy();
  }

  await message.reply("Tamam geliyorum, dur bi saniye.");

  const tumSesKanallari = message.guild.channels.cache.filter(
    (ch) => ch.type === ChannelType.GuildVoice && ch.id !== voiceChannel.id
  );

  if (tumSesKanallari.size > 0) {
    const kacTane = Math.min(tumSesKanallari.size, 2 + Math.floor(Math.random() * 2));
    const rastgeleKanallar = rastgeleN([...tumSesKanallari.values()], kacTane);

    for (const kanal of rastgeleKanallar) {
      try {
        const conn = await sesKanalinaGirVeBekle(kanal);
        await delay(1500 + Math.random() * 1500);
        conn.destroy();
        await delay(500);
      } catch (err) {
        console.error(`[Sese Gel] ${kanal.name} kanalına girerken hata:`, err.message);
      }
    }
  }

  try {
    await sesKanalinaGirVeBekle(voiceChannel);
    console.log(`[Sese Gel] ${voiceChannel.name} kanalına girildi.`);
  } catch (err) {
    console.error("[Sese Gel] Hedef kanala girerken hata:", err.message);
    await message.channel.send("Bağlanamadım lan, bir sıçtım galiba.");
  }
}

// ─── İstiklal Marşı Komutu ─────────────────────────────────────────────────────

const ISTIKLAL_REGEX = /istiklal.*mar[şs]/i;

async function istiklalMarsiOkuKomutu(message) {
  const voiceChannel = message.member?.voice?.channel;

  if (!voiceChannel) {
    return message.reply("Önce bir ses kanalına gir.");
  }

  await message.reply("🇹🇷 İstiklal Marşı okunuyor!");

  try {
    const connection = await baglantiyiAlVeyaKur(message, voiceChannel);

    // Shorts linki de çalışır
    const stream = await play.stream("https://www.youtube.com/shorts/SqMk80ptreI");

    const resource = createAudioResource(stream.stream, {
      inputType: stream.type,
    });

    const player = createAudioPlayer();

    connection.subscribe(player);
    player.play(resource);

    player.on("error", console.error);

    player.once(AudioPlayerStatus.Idle, () => {
      player.stop();
    });

  } catch (err) {
    console.error(err);
    message.channel.send("İstiklal Marşı çalınamadı.");
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

  const isimMatch = reply.match(/\[İSİM_KAYDET:\s*(.+?)\]/i);
  if (isimMatch) {
    const isim = isimMatch[1].trim();
    updateProfileName(userId, isim);
    console.log(`[Profil] ${profile.discordUsername} için isim kaydedildi: ${isim}`);
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

  // "Sese gel" komutu — DM'de çalışmaz
  if (!isDM && SESE_GEL_REGEX.test(cleanContent)) {
    try {
      await seseGelKomutu(message);
    } catch (err) {
      console.error("[Sese Gel] Genel hata:", err.message);
      await message.reply("Birşeyler ters gitti.");
    }
    return;
  }

 async function istiklalMarsiOkuKomutu(message) {
  const voiceChannel = message.member?.voice?.channel;

  if (!voiceChannel) {
    return message.reply("Önce bir ses kanalına gir.");
  }

  await message.reply("🇹🇷 İstiklal Marşı okunuyor!");

  try {
    const connection = await baglantiyiAlVeyaKur(message, voiceChannel);

    // Shorts linki de çalışır
    const stream = await play.stream("www.youtube.com/shorts/SqMk80ptreI");

    const resource = createAudioResource(stream.stream, {
      inputType: stream.type,
    });

    const player = createAudioPlayer();

    connection.subscribe(player);
    player.play(resource);

    player.on("error", console.error);

    player.once(AudioPlayerStatus.Idle, () => {
      player.stop();
    });

  } catch (err) {
    console.error(err);
    message.channel.send("İstiklal Marşı çalınamadı.");
  }
}

  const userId = message.author.id;
  const discordUsername = message.author.username;
  const isNewUser = !userProfiles.has(userId);
  const profile = getOrCreateProfile(userId, discordUsername);
  incrementMessageCount(userId);

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
