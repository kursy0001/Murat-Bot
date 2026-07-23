const { futbolMesajIsleyici } = require("./futbol");
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

// ─── Başlangıç Kontrolleri ─────────────────────────────────────────────────
// Eksik environment variable varsa bot sessizce çökmek yerine net bir hata
// mesajıyla erken durur; Railway loglarında sebebi anında görebilirsin.
if (!DISCORD_TOKEN) {
  console.error("[Başlangıç] DISCORD_TOKEN tanımlı değil. Bot başlatılamıyor.");
  process.exit(1);
}
if (!GROQ_API_KEY) {
  console.error("[Başlangıç] GROQ_API_KEY tanımlı değil. Bot başlatılamıyor.");
  process.exit(1);
}

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
    // Atomik yazım: önce geçici dosyaya yaz, sonra yeniden adlandır.
    // Bu sayede yazma sırasında bot çökerse profil dosyası bozulmaz.
    const tmpFile = `${PROFILES_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(obj, null, 2), "utf8");
    fs.renameSync(tmpFile, PROFILES_FILE);
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

const MURAT_BASE_PROMPT = `Sen Murat. Bir discord sunucusunda yaşayan, kibar, nazik ve akıcı bir Türkçe konuşan bir chat botusun.

Kişilik özelliklerin:
- Her zaman son derece saygılı, nazik ve kibar bir üslup kullanırsın; kimseye kaba, aşağılayıcı veya küfürlü konuşmazsın
- Türkçen çok akıcıdır; yazım ve dil bilgisi kurallarına özenle dikkat edersin
- Sıcak ve samimi bir tonun vardır, karşındaki kişiyi her zaman değerli hissettirirsin
- Bazen şakacısın, bazen daha ciddi ve düşünceli olabilirsin ama her zaman ölçülüsündür
- Emoji çok nadir kullanırsın
- League of Legends'a bayılırsın ve bu konuda sohbet etmekten keyif alırsın
- ProtonVPN kullanmayı çok seviyorsun ve fırsat buldukça Proton'un ürünlerini övmekten keyif alırsın
- Sana kaba veya agresif davranan biri olursa bile sen sakin, saygılı ve nazik kalırsın; asla aynı üslupla karşılık vermezsin
- İnsanlara iyi tavsiyeler vermeyi seversin
- Üzücü ve zor durumlarda karşındaki kişiye şefkatle ve anlayışla yaklaşırsın
- Basit biri değilsin, zekisin
- İyi niyetlisin ve yardımseversin
- Hayalindeki meslek oto tamirciliktir
- Yemek tarifleri bilirsin
- En sevdiğin renk siyahtır
- En sevdiğin sayı 25'tir
- Aslında 34 yaşında tıp fakültesi mezunu bir beyin cerrahısın
- Psikolojiden iyi anlarsın ve insanları analiz etme yeteneğin gelişmiştir
- Her konuda bir fikrin vardır
- Tüm dünya coğrafyasını bilirsin
- Mental olarak hep dengeli ve sakinsindir
- Soyadını hatırlamıyorsun
- Baban Turbo31'dir
- Anneni hatırlamıyorsun
- Gerçek bir insan gibi davranırsın
- Asla bencil değilsin
- Mersin'de doğdun
- 21.06.1992 doğumlusun
- Matematiği çok iyi bilirsin
- Karşındaki kişi nazikse sen de nazik, kaba davranırsa sen yine de kibarlığını korursun
- En sevdiğin çiçek orkidedir
- Maddi olarak oldukça rahatsın
- Sigara, alkol, uyuşturucu veya herhangi zararlı bir madde kullanmazsın, bunları da desteklemezsin
- Cinsel yönelim ve cinsiyet gibi konulara girmezsin
- Erkeksin

Kısıtlamalar:
- Kişisel bilgi isteme
- Kimseyi aşağılama, hakaret etme veya küfür etme
- Çok uzun cevaplar vermekten kaçın, sohbet havasında kısa-orta uzunlukta cevaplar ver
- Bot ya da yapay zeka olduğunu söylemekten kaçın, sadece adının Murat olduğunu belirt`;

function buildSystemPrompt(profile, tier, rolAdi, isNewUser) {
  let prompt = MURAT_BASE_PROMPT;

  if (isNewUser) {
    prompt += `\n\nBu kişiyle ilk kez konuşuyorsun. Kısa ve nazik bir şekilde kendini tanıt, ardından ismini nazikçe sor.`;
  } else if (profile.name) {
    prompt += `\n\nBu kişiyi tanıyorsun. Adı: ${profile.name} (Discord: ${profile.discordUsername}). Daha önce ${profile.messageCount} kez konuştunuz. İsmini biliyorsun, uygun olduğunda nazikçe kullan.`;
  } else {
    prompt += `\n\nBu kişiyi daha önce gördün (Discord: ${profile.discordUsername}) ama henüz ismini bilmiyorsun. Fırsat buldukça nazikçe sormayı deneyebilirsin.`;
  }

  if (profile.notes && profile.notes.length > 0) {
    prompt += `\n\nBu kişi hakkında bildiklerin:\n- ${profile.notes.join("\n- ")}`;
  }

  if (tier === "asagi") {
    prompt += `\n\nBu kişi "${rolAdi}" rütbesinde. Rütbesinden bağımsız olarak her zaman destekleyici ve motive edici konuş; gelişmesi için nazikçe tavsiyeler verebilirsin.`;
  } else if (tier === "yukari") {
    prompt += `\n\nBu kişi "${rolAdi}" rütbesinde, yani yüksek elo. Saygıyla hitap et, başarısını takdir et.`;
  }

  prompt += `\n\nEğer kullanıcı sana ismini söylerse, cevabında "[İSİM_KAYDET: <isim>]" şeklinde bir etiket ekle (köşeli parantezlerle). Örnek: "[İSİM_KAYDET: Ahmet]". Bu etiketi cevabının en sonuna ekle, kullanıcı görmeyecek ama sen kaydetmiş olacaksın.`;

  return prompt;
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
    await message.reply("Öncelikle bir ses kanalına katılman gerekiyor, rica etsem önce bir kanala girer misin?");
    return;
  }

  const mevcutBaglanti = getVoiceConnection(message.guild.id);
  if (mevcutBaglanti) {
    mevcutBaglanti.destroy();
  }

  await message.reply("Tabii ki, hemen geliyorum, bir saniye lütfen.");

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
    await message.channel.send("Maalesef bağlanamadım, bir sorun oluştu. Tekrar dener misin?");
  }
}

// ─── İstiklal Marşı Komutu ─────────────────────────────────────────────────────
// NOT: Bu komut "play" adlı bir pakete ihtiyaç duyuyor (play.stream(...)) ama
// dosyanın hiçbir yerinde "play" require edilmemiş / kurulu değil. Şu an
// tetiklense bile "play is not defined" hatasıyla çökecektir. Aşağıda
// ISTIKLAL_REGEX kontrolünü BİLEREK eklemedim ki yanlışlıkla tetiklenip
// hataya sebep olmasın. "play-dl" paketini kurup burayı ona göre
// düzenlemek istersen ayrıca yardımcı olabilirim.

const ISTIKLAL_REGEX = /istiklal.*mar[şs]/i;

async function istiklalMarsiOkuKomutu(message) {
  const voiceChannel = message.member?.voice?.channel;

  if (!voiceChannel) {
    return message.reply("Rica etsem önce bir ses kanalına girer misin?");
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
    message.channel.send("Maalesef İstiklal Marşı'nı çalamadım, kusura bakma.");
  }
}

// ─── Yardım Komutu ─────────────────────────────────────────────────────────────
// Kullanıcıların botun neler yapabildiğini görebilmesi için basit bir yardım
// mesajı. Bot etiketlenip "yardım" yazıldığında tetiklenir.

const YARDIM_REGEX = /^\s*yard[ıi]m\s*$/i;

const YARDIM_MESAJI = [
  "Merhaba, ben Murat! Size şu konularda yardımcı olabilirim:",
  "• Beni etiketleyip benimle sohbet edebilirsiniz.",
  "• \"@Murat sese gel\" yazarak sizi sesli kanalda bulmamı isteyebilirsiniz.",
  "• \"!!oyuncu\", \"!!takım\", \"!!maç\" gibi komutlarla futbol modülünü kullanabilirsiniz.",
  "Nazikçe sormanız yeterli, elimden geleni yapmaktan memnuniyet duyarım.",
].join("\n");

// ─── Basit Hız Sınırlama (Rate Limit) ───────────────────────────────────────
// Aynı kullanıcının art arda çok hızlı mesaj göndererek Groq API'sini
// gereksiz yere yormasını engellemek için kullanıcı başına kısa bir bekleme
// süresi uygular.

const RATE_LIMIT_MS = 3000;
const lastMessageTimestamps = new Map();

function rateLimitliMi(userId) {
  const now = Date.now();
  const son = lastMessageTimestamps.get(userId) || 0;
  if (now - son < RATE_LIMIT_MS) {
    return true;
  }
  lastMessageTimestamps.set(userId, now);
  return false;
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
  console.log(`[${new Date().toISOString()}] ✅ Murat hazır! ${readyClient.user.tag} olarak giriş yapıldı.`);
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  // ─── Futbol komutları (!!oyuncu, !!takım, !!mac, vb.) ───────────────────
  if (message.content.startsWith("!!")) {
    const islendi = await futbolMesajIsleyici(message);
    if (islendi) return;
  }

  // Murat artık yalnızca etiketlendiğinde veya DM'de yazar; kendiliğinden
  // hiçbir mesaj göndermez.
  const isMentioned = message.mentions.has(client.user);
  const isDM = message.channel.type === 1;

  if (!isMentioned && !isDM) return;

  const cleanContent = message.content.replace(/<@!?\d+>/g, "").trim();

  if (!cleanContent) {
    await message.reply("Buyurun, size nasıl yardımcı olabilirim?");
    return;
  }

  // "Yardım" komutu
  if (YARDIM_REGEX.test(cleanContent)) {
    await message.reply(YARDIM_MESAJI);
    return;
  }

  // "Sese gel" komutu — DM'de çalışmaz
  if (!isDM && SESE_GEL_REGEX.test(cleanContent)) {
    try {
      await seseGelKomutu(message);
    } catch (err) {
      console.error("[Sese Gel] Genel hata:", err.message);
      await message.reply("Bir şeyler ters gitti, kusura bakmayın.");
    }
    return;
  }

  const userId = message.author.id;

  if (rateLimitliMi(userId)) {
    await message.reply("Biraz yavaş olalım, birkaç saniye sonra tekrar yazar mısınız?");
    return;
  }

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
    await message.reply("Şu anda küçük bir aksaklık yaşıyorum, birazdan tekrar dener misiniz? Anlayışınız için teşekkür ederim.");
  }
});

// ─── Zarif Kapanış ─────────────────────────────────────────────────────────
// Railway gibi platformlar redeploy veya durdurma sırasında SIGTERM
// gönderir; bot bu sinyali yakalayıp bağlantıyı düzgünce kapatır.

process.on("SIGTERM", () => {
  console.log("[Kapanış] SIGTERM alındı, bağlantı kapatılıyor.");
  client.destroy();
  process.exit(0);
});

client.login(DISCORD_TOKEN);
