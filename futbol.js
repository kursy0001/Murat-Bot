// ═══════════════════════════════════════════════════════════════════════════
// FUTBOL MODÜLÜ — Murat botuna eklenen "!!" komutlu futbol takım/maç sistemi
// ═══════════════════════════════════════════════════════════════════════════
//
// KOMUTLAR:
//   !!oyuncu                → Günde 1 kere 20 rastgele gerçek futbolcu çeker,
//                              kadrona (biriktirdiğin oyuncu havuzuna) ekler.
//   !!kadro                 → En iyi 20 oyuncunu SAYFA SAYFA gösterir
//                              (mesajın altındaki ◀️ ▶️ emojilerine basarak gezinilir).
//   !!takım                 → İlk 11'ini saha şeması gibi gösterir.
//   !!otomatik               → Kadrondaki oyunculardan gerçek mevkilerine
//                              göre otomatik en iyi ilk 11'i kurar.
//   !!kaleci <isim>          !!stoper <isim>       !!sagbek <isim>
//   !!solbek <isim>          !!defansiorta <isim>  !!ofansiorta <isim>
//   !!sagkanat <isim>        !!solkanat <isim>     !!forvet <isim>
//                              → Kadrondaki bir oyuncuyu ilgili mevkiye koyar.
//                                 Mevki doluysa üzerine yazar. Stoper ve forvet
//                                 komutları 2 kişiliktir, sırayla dolar.
//   !!cikar <mevki>          → Bir mevkiyi boşaltır (örn: !!cikar forvet1)
//   !!mac @kullanici          !!maç @kullanici
//                              → Rakibe meydan okur, iki takımın ilk 11'i
//                                tamsa maçı oynatır, kazanana puan + PARA verir.
//   !!puan                   → Kendi puan durumunu gösterir.
//   !!puanlar                → Sunucu lig tablosunu (top 10) gösterir.
//   !!bakiye  !!para          → Kendi Euro bakiyeni gösterir.
//   !!satisa <isim> <fiyat>   → Kadrondaki bir oyuncuyu piyasaya çıkarır.
//                                 (örn: !!satisa Erling Haaland 850000)
//   !!piyasa                  → Satıştaki tüm oyuncuları SAYFA SAYFA gösterir.
//   !!satinal <isim>          → Piyasadaki bir oyuncuyu satın alır, para el
//                                 değiştirir, oyuncu kadronuza geçer.
//   !!satisiptal <isim>       → Kendi ilanını piyasadan geri çeker.
//   !!futboly yardim          !!futbolyardim
//                              → Komut listesini gösterir.
//
// VERİ:
//   futbol_oyuncular.json içinde ~11.000 gerçek futbolcu (isim, mevki, güç,
//   kulüp, ülke) bulunuyor. Bu dosya bir kere internetten indirilip pakete
//   dahil edildi, bot çalışırken tekrar internete gitmesi gerekmiyor.
//
// KALICI VERİ:
//   futbol_data.json dosyasında her kullanıcının kadrosu, ilk 11'i, puanı,
//   parası, piyasa ilanları ve günlük çekiliş tarihi tutulur. user_profiles.json
//   ile aynı mantıkla çalışır (basit dosya tabanlı JSON depolama).
//
// ÖNEMLİ — REACTION (EMOJİ) TABANLI SAYFALAMA İÇİN GEREKEN INTENT:
//   Discord Developer Portal'da botunun "Message Content Intent" zaten
//   açık olmalı (Murat için muhtemelen zaten açık). Ayrıca client'ı
//   oluştururken intents listesine şunu eklemen gerekiyor, yoksa ◀️ ▶️
//   emojilerine basınca sayfa değişmez:
//       GatewayIntentBits.GuildMessageReactions
//   index.js'deki client oluşturma kısmı örneğin şöyle olmalı:
//       const client = new Client({
//         intents: [
//           GatewayIntentBits.Guilds,
//           GatewayIntentBits.GuildMessages,
//           GatewayIntentBits.MessageContent,
//           GatewayIntentBits.GuildMessageReactions, // <-- bunu ekle
//         ],
//       });
//
// ENTEGRASYON:
//   Ana bot dosyanda (index.js) en üste:
//       const { futbolMesajIsleyici } = require("./futbol");
//   MessageCreate event'inin EN BAŞINA (isMentioned/isDM kontrolünden ÖNCE):
//       if (!message.author.bot && message.content.startsWith("!!")) {
//         const islendi = await futbolMesajIsleyici(message);
//         if (islendi) return;
//       }
//   Detaylı adımlar için ENTEGRASYON.md dosyasına bak.
// ═══════════════════════════════════════════════════════════════════════════

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { EmbedBuilder } = require("discord.js");

const OYUNCU_HAVUZU_DOSYASI = path.join(__dirname, "futbol_oyuncular.json");
const FUTBOL_DATA_DOSYASI = path.join(__dirname, "futbol_data.json");

const GUNLUK_OYUNCU_SAYISI = 1000;
const PREFIX = "!!";
const BASLANGIC_PARA = 1_000_000; // yeni kullanıcının başlangıç bakiyesi (€)

// ─── Mevki Şeması ──────────────────────────────────────────────────────────
// Sıra, sahada yukarıdan (forvet) aşağıya (kaleci) doğru gösterim sırası.
const FORMASYON_SIRA = [
  "ST1", "ST2",
  "LW", "RW",
  "CAM",
  "CDM",
  "LB", "CB1", "CB2", "RB",
  "GK",
];

const POZISYON_ETIKET = {
  GK: "Kaleci",
  CB1: "Stoper (1)",
  CB2: "Stoper (2)",
  LB: "Sol Bek",
  RB: "Sağ Bek",
  CDM: "Defansif Orta Saha",
  CAM: "Ofansif Orta Saha",
  RW: "Sağ Kanat",
  LW: "Sol Kanat",
  ST1: "Forvet (1)",
  ST2: "Forvet (2)",
};

// Hangi komut, hangi slot(lar)ı doldurabilir (sırayla ilk boş olanı doldurur).
const KOMUT_POZISYON = {
  kaleci: ["GK"],
  stoper: ["CB1", "CB2"],
  sagbek: ["RB"],
  solbek: ["LB"],
  defansiorta: ["CDM"],
  ofansiorta: ["CAM"],
  sagkanat: ["RW"],
  solkanat: ["LW"],
  forvet: ["ST1", "ST2"],
};

// !!cikar komutu için kısayol -> slot eşlemesi
const CIKAR_KISAYOL = {
  kaleci: "GK",
  stoper1: "CB1",
  stoper2: "CB2",
  sagbek: "RB",
  solbek: "LB",
  defansiorta: "CDM",
  ofansiorta: "CAM",
  sagkanat: "RW",
  solkanat: "LW",
  forvet1: "ST1",
  forvet2: "ST2",
};

// Hücum gücü hesabında kullanılan slotlar / defans gücü hesabında kullanılanlar
const HUCUM_SLOTLARI = ["CAM", "RW", "LW", "ST1", "ST2"];
const DEFANS_SLOTLARI = ["GK", "CB1", "CB2", "LB", "RB", "CDM"];

// ─── Oyuncu Havuzunu Yükle (salt okunur, statik veri) ────────────────────────

let OYUNCU_HAVUZU = [];
try {
  const ham = fs.readFileSync(OYUNCU_HAVUZU_DOSYASI, "utf8");
  OYUNCU_HAVUZU = JSON.parse(ham);
  console.log(`[Futbol] ${OYUNCU_HAVUZU.length} oyuncu yüklendi.`);
} catch (err) {
  console.error("[Futbol] Oyuncu havuzu yüklenemedi:", err.message);
}

// ─── Kalıcı Veri (kadrolar, takımlar, puanlar, paralar, piyasa) ──────────────

function bosVeri() {
  return {
    kadrolar: {}, // userId -> [ {id, name, position, power, club, nationality} ]
    formasyonlar: {}, // userId -> { GK: oyuncu|null, CB1: ..., ... }
    puanlar: {}, // userId -> { galibiyet, beraberlik, maglubiyet, puan }
    gunlukCekilis: {}, // userId -> "YYYY-MM-DD" (son çekiliş tarihi)
    paralar: {}, // userId -> number (Euro bakiye)
    piyasa: [], // [ {id, saticiId, oyuncuId, oyuncu, fiyat, tarih} ]
  };
}

function veriYukle() {
  try {
    if (fs.existsSync(FUTBOL_DATA_DOSYASI)) {
      const ham = fs.readFileSync(FUTBOL_DATA_DOSYASI, "utf8");
      const veri = JSON.parse(ham);
      return { ...bosVeri(), ...veri };
    }
  } catch (err) {
    console.error("[Futbol] Veri yüklenemedi:", err.message);
  }
  return bosVeri();
}

function veriKaydet() {
  try {
    fs.writeFileSync(FUTBOL_DATA_DOSYASI, JSON.stringify(futbolData, null, 2), "utf8");
  } catch (err) {
    console.error("[Futbol] Veri kaydedilemedi:", err.message);
  }
}

const futbolData = veriYukle();

function kullaniciKadrosu(userId) {
  if (!futbolData.kadrolar[userId]) futbolData.kadrolar[userId] = [];
  return futbolData.kadrolar[userId];
}

function kullaniciFormasyonu(userId) {
  if (!futbolData.formasyonlar[userId]) {
    futbolData.formasyonlar[userId] = {
      GK: null, CB1: null, CB2: null, LB: null, RB: null,
      CDM: null, CAM: null, RW: null, LW: null, ST1: null, ST2: null,
    };
  }
  return futbolData.formasyonlar[userId];
}

function kullaniciPuani(userId) {
  if (!futbolData.puanlar[userId]) {
    futbolData.puanlar[userId] = { galibiyet: 0, beraberlik: 0, maglubiyet: 0, puan: 0 };
  }
  return futbolData.puanlar[userId];
}

function kullaniciParasi(userId) {
  if (futbolData.paralar[userId] === undefined) {
    futbolData.paralar[userId] = BASLANGIC_PARA;
  }
  return futbolData.paralar[userId];
}

function paraEkle(userId, miktar) {
  futbolData.paralar[userId] = kullaniciParasi(userId) + Math.round(miktar);
}

function paraCikar(userId, miktar) {
  futbolData.paralar[userId] = kullaniciParasi(userId) - Math.round(miktar);
}

function paraFormatla(miktar) {
  return `${Math.round(miktar).toLocaleString("tr-TR")} €`;
}

function bugununTarihi() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

// ─── Yardımcı Fonksiyonlar ────────────────────────────────────────────────────

function rastgeleN(arr, n) {
  const kopya = [...arr];
  for (let i = kopya.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [kopya[i], kopya[j]] = [kopya[j], kopya[i]];
  }
  return kopya.slice(0, n);
}

function normalizeAd(str) {
  return str
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // aksanları temizle
    .trim();
}

// Kullanıcının kadrosunda isimle oyuncu ara. Tam eşleşme öncelikli,
// yoksa "içeriyor" eşleşmesi. Birden fazla eşleşme varsa hepsini döndürür.
function kadrodaOyuncuAra(userId, arananIsim) {
  const kadro = kullaniciKadrosu(userId);
  const hedef = normalizeAd(arananIsim);

  const tamEslesme = kadro.filter((o) => normalizeAd(o.name) === hedef);
  if (tamEslesme.length > 0) return tamEslesme;

  return kadro.filter((o) => normalizeAd(o.name).includes(hedef));
}

// ─── Genel Sayfalama (Reaction / Emoji ile ◀️ ▶️) ────────────────────────────
// sayfaOlusturucular: her biri (sayfaNo, toplamSayfa) => EmbedBuilder döndüren
// fonksiyonlardan oluşan bir dizi. Her fonksiyon bir sayfayı temsil eder.

async function sayfaliGonder(message, sayfaOlusturucular, sure = 120000) {
  const toplamSayfa = sayfaOlusturucular.length;
  if (toplamSayfa === 0) return null;

  let mevcutSayfa = 0;
  const mesaj = await message.reply({
    embeds: [sayfaOlusturucular[mevcutSayfa](mevcutSayfa, toplamSayfa)],
  });

  if (toplamSayfa <= 1) return mesaj;

  try {
    await mesaj.react("◀️");
    await mesaj.react("▶️");
  } catch (err) {
    // botun reaction ekleme izni yoksa sessizce geç, mesaj tek sayfa gibi kalır
    return mesaj;
  }

  const filtre = (tepki, kullanici) =>
    ["◀️", "▶️"].includes(tepki.emoji.name) && kullanici.id === message.author.id;

  let toplayici;
  try {
    toplayici = mesaj.createReactionCollector({ filter: filtre, time: sure });
  } catch (err) {
    return mesaj;
  }

  toplayici.on("collect", async (tepki, kullanici) => {
    if (tepki.emoji.name === "▶️") {
      mevcutSayfa = (mevcutSayfa + 1) % toplamSayfa;
    } else {
      mevcutSayfa = (mevcutSayfa - 1 + toplamSayfa) % toplamSayfa;
    }

    try {
      await mesaj.edit({ embeds: [sayfaOlusturucular[mevcutSayfa](mevcutSayfa, toplamSayfa)] });
    } catch (err) {
      // mesaj silinmiş olabilir, önemli değil
    }

    try {
      await tepki.users.remove(kullanici.id);
    } catch (err) {
      // botun "Reaksiyonları Yönet" izni yoksa (örn. DM) görmezden gel
    }
  });

  toplayici.on("end", async () => {
    try {
      await mesaj.reactions.removeAll();
    } catch (err) {
      // izin yoksa görmezden gel
    }
  });

  return mesaj;
}

// ─── !!oyuncu — Günlük Oyuncu Çekilişi ───────────────────────────────────────

async function oyuncuCekKomutu(message) {
  const userId = message.author.id;
  const bugun = bugununTarihi();

  if (futbolData.gunlukCekilis[userId] === bugun) {
    await message.reply(
      "Bugün zaten oyuncularını çektin lan, yarın tekrar gel. `!!kadro` yazarak kadronu görebilirsin."
    );
    return;
  }

  if (OYUNCU_HAVUZU.length === 0) {
    await message.reply("Oyuncu verisi yüklenemedi, TURBO31'e haber ver.");
    return;
  }

  const kadro = kullaniciKadrosu(userId);
  const sahipOlunanlar = new Set(kadro.map((o) => normalizeAd(o.name)));

  const secilenler = [];
  const havuzKarisik = rastgeleN(OYUNCU_HAVUZU, Math.min(OYUNCU_HAVUZU.length, 400));

  for (const oyuncu of havuzKarisik) {
    if (secilenler.length >= GUNLUK_OYUNCU_SAYISI) break;
    if (sahipOlunanlar.has(normalizeAd(oyuncu.name))) continue;
    secilenler.push(oyuncu);
    sahipOlunanlar.add(normalizeAd(oyuncu.name));
  }

  // Havuzda yeterince yeni isim yoksa (kadro çok büyümüşse) kalanları
  // tekrar sahip olunsa bile ekle.
  if (secilenler.length < GUNLUK_OYUNCU_SAYISI) {
    for (const oyuncu of havuzKarisik) {
      if (secilenler.length >= GUNLUK_OYUNCU_SAYISI) break;
      if (!secilenler.includes(oyuncu)) secilenler.push(oyuncu);
    }
  }

  // Her oyuncu kopyasına benzersiz bir id veriyoruz — transfer piyasasında
  // ve mevki atamalarında aynı isimli oyuncuları birbirinden ayırt etmek için.
  for (const oyuncu of secilenler) {
    kadro.push({ ...oyuncu, id: crypto.randomUUID() });
  }

  futbolData.gunlukCekilis[userId] = bugun;
  veriKaydet();

  const siraliListe = [...secilenler].sort((a, b) => b.power - a.power);
  const aciklama = siraliListe
    .map((o, i) => `**${i + 1}.** ${o.name} — \`${o.position}\` — Güç: **${o.power}** (${o.club})`)
    .join("\n");

  const embed = new EmbedBuilder()
    .setColor(0x1abc9c)
    .setTitle("⚽ Günlük Oyuncu Çekilişi")
    .setDescription(
      `Bugünkü 20 oyuncun kadrona eklendi. Yerleştirmek için mevki komutlarını kullan (örn: \`!!forvet ${siraliListe[0].name}\`).\n\n${aciklama}`
    )
    .setFooter({ text: "Yarın tekrar çekiliş yapabilirsin." });

  await message.reply({ embeds: [embed] });
}

// ─── !!kadro — En İyi 20 Oyuncuyu Sayfa Sayfa Göster ─────────────────────────

async function kadroGosterKomutu(message) {
  const userId = message.author.id;
  const kadro = kullaniciKadrosu(userId);

  if (kadro.length === 0) {
    await message.reply("Kadronda hiç oyuncu yok, önce `!!oyuncu` yazarak çekiliş yap.");
    return;
  }

  const enIyi20 = [...kadro].sort((a, b) => b.power - a.power).slice(0, 20);
  const SAYFA_BASI = 5;
  const gruplar = [];
  for (let i = 0; i < enIyi20.length; i += SAYFA_BASI) {
    gruplar.push(enIyi20.slice(i, i + SAYFA_BASI));
  }

  const sayfaOlusturucular = gruplar.map((grup, grupIndex) => (sayfaNo, toplam) => {
    const aciklama = grup
      .map((o, i) => {
        const siraNo = grupIndex * SAYFA_BASI + i + 1;
        return `**${siraNo}.** ${o.name} — \`${o.position}\` — Güç: **${o.power}**\n🏟️ ${o.club || "?"} · 🌍 ${o.nationality || "?"}`;
      })
      .join("\n\n");

    return new EmbedBuilder()
      .setColor(0x1abc9c)
      .setTitle(`⚽ ${message.author.username} — En İyi 20 Oyuncu (${kadro.length} toplam)`)
      .setDescription(aciklama)
      .setFooter({
        text: `Sayfa ${sayfaNo + 1}/${toplam} · ◀️ ▶️ ile gezin · Bakiye: ${paraFormatla(kullaniciParasi(userId))}`,
      });
  });

  await sayfaliGonder(message, sayfaOlusturucular);
}

// ─── Mevki Yerleştirme Komutları (!!forvet, !!kaleci, vb.) ──────────────────

async function pozisyonaYerlestirKomutu(message, komutAdi, isim) {
  const userId = message.author.id;

  if (!isim) {
    await message.reply(`Kimi ${POZISYON_ETIKET[KOMUT_POZISYON[komutAdi][0]]} yapayım, isim yazmadın ki.`);
    return;
  }

  const eslesmeler = kadrodaOyuncuAra(userId, isim);

  if (eslesmeler.length === 0) {
    await message.reply(
      `Kadronda "${isim}" diye biri yok. Önce \`!!oyuncu\` ile çekiliş yap ya da \`!!kadro\` ile kadrona bak.`
    );
    return;
  }

  if (eslesmeler.length > 1) {
    const secenekler = eslesmeler.slice(0, 8).map((o) => `${o.name} (${o.club})`).join(", ");
    await message.reply(
      `Birden fazla eşleşme buldum, daha net yaz: ${secenekler}`
    );
    return;
  }

  const oyuncu = eslesmeler[0];
  const formasyon = kullaniciFormasyonu(userId);
  const slotlar = KOMUT_POZISYON[komutAdi];

  // İlk boş slotu bul, hepsi doluysa ilk slotun üzerine yaz
  let hedefSlot = slotlar.find((s) => !formasyon[s]);
  if (!hedefSlot) hedefSlot = slotlar[0];

  const eskiOyuncu = formasyon[hedefSlot];
  formasyon[hedefSlot] = oyuncu;
  veriKaydet();

  const mesaj = eskiOyuncu
    ? `${eskiOyuncu.name} kenara oturdu, **${oyuncu.name}** (Güç: ${oyuncu.power}) artık ${POZISYON_ETIKET[hedefSlot]} mevkisinde.`
    : `**${oyuncu.name}** (Güç: ${oyuncu.power}) ${POZISYON_ETIKET[hedefSlot]} mevkisine yerleşti.`;

  await message.reply(mesaj);
}

// ─── !!cikar — Mevkiyi Boşalt ────────────────────────────────────────────────

async function cikarKomutu(message, kisayol) {
  const userId = message.author.id;
  const slot = CIKAR_KISAYOL[normalizeAd(kisayol || "")];

  if (!slot) {
    await message.reply(
      "Geçersiz mevki. Kullanabileceklerin: kaleci, stoper1, stoper2, sagbek, solbek, defansiorta, ofansiorta, sagkanat, solkanat, forvet1, forvet2"
    );
    return;
  }

  const formasyon = kullaniciFormasyonu(userId);
  if (!formasyon[slot]) {
    await message.reply(`${POZISYON_ETIKET[slot]} zaten boş.`);
    return;
  }

  const cikanOyuncu = formasyon[slot];
  formasyon[slot] = null;
  veriKaydet();

  await message.reply(`${cikanOyuncu.name}, ${POZISYON_ETIKET[slot]} mevkisinden çıkarıldı.`);
}

// ─── !!takım — Saha Şeması ────────────────────────────────────────────────────

function formasyonSatirOlustur(formasyon, slotlar) {
  return slotlar
    .map((slot) => {
      const oyuncu = formasyon[slot];
      return oyuncu ? `${oyuncu.name} (${oyuncu.power})` : "— BOŞ —";
    })
    .join("   |   ");
}

function takimEmbedOlustur(uye, formasyon, baslikOnEki, ozelFooter) {
  const satirlar = [
    `**FORVET**\n${formasyonSatirOlustur(formasyon, ["ST1", "ST2"])}`,
    `**KANATLAR**\n${formasyonSatirOlustur(formasyon, ["LW", "RW"])}`,
    `**OFANSİF ORTA SAHA**\n${formasyonSatirOlustur(formasyon, ["CAM"])}`,
    `**DEFANSİF ORTA SAHA**\n${formasyonSatirOlustur(formasyon, ["CDM"])}`,
    `**DEFANS**\n${formasyonSatirOlustur(formasyon, ["LB", "CB1", "CB2", "RB"])}`,
    `**KALECİ**\n${formasyonSatirOlustur(formasyon, ["GK"])}`,
  ];

  const doluSlotSayisi = FORMASYON_SIRA.filter((s) => formasyon[s]).length;

  return new EmbedBuilder()
    .setColor(0x1abc9c)
    .setTitle(`⚽ ${baslikOnEki || ""}${uye.username} — İlk 11 (${doluSlotSayisi}/11)`)
    .setDescription(satirlar.join("\n\n"))
    .setFooter({
      text:
        ozelFooter ||
        (doluSlotSayisi < 11
          ? "Takımın tam değil, mevki komutlarıyla eksikleri tamamla."
          : "Takımın tam, artık !!mac @biri diyerek maç yapabilirsin."),
    });
}

async function takimGosterKomutu(message, hedefUye) {
  const uye = hedefUye || message.author;
  const formasyon = kullaniciFormasyonu(uye.id);
  const embed = takimEmbedOlustur(uye, formasyon);
  await message.reply({ embeds: [embed] });
}

// ─── !!otomatik — Otomatik Takım Kurulumu ────────────────────────────────────
// Kadrondaki oyuncuları gerçek mevkilerine göre en iyi ilk 11'e otomatik
// yerleştirir. Bir mevki için gerçek mevkisi uyan oyuncu yoksa, ikinci
// aşamada kalan en güçlü oyuncularla boş kalan yerler doldurulur.

const POZISYON_KATEGORI_HARITASI = {
  GK: "GK",
  CB: "CB", RCB: "CB", LCB: "CB", SW: "CB",
  RB: "RB", RWB: "RB",
  LB: "LB", LWB: "LB",
  CDM: "CDM", RDM: "CDM", LDM: "CDM",
  CM: "CM", RCM: "CM", LCM: "CM",
  CAM: "CAM", RAM: "CAM", LAM: "CAM",
  RM: "RW", RW: "RW", RF: "RW",
  LM: "LW", LW: "LW", LF: "LW",
  ST: "ST", CF: "ST",
};

function pozisyonKategorisi(pos) {
  return POZISYON_KATEGORI_HARITASI[(pos || "").toUpperCase()] || "DIGER";
}

// Her slotun kabul ettiği kategoriler, öncelik sırasına göre.
// CM (merkez orta saha) hem CDM hem CAM'a esnek olarak uyabilir.
const SLOT_KABUL_EDILEN_KATEGORILER = {
  GK: ["GK"],
  CB1: ["CB"],
  CB2: ["CB"],
  LB: ["LB"],
  RB: ["RB"],
  CDM: ["CDM", "CM"],
  CAM: ["CAM", "CM"],
  RW: ["RW"],
  LW: ["LW"],
  ST1: ["ST"],
  ST2: ["ST"],
};

// Doldurma sırası: en kısıtlı/kritik mevkiler önce (kaleci, sonra defans...)
const OTOMATIK_DOLDURMA_SIRASI = [
  "GK", "CB1", "CB2", "LB", "RB", "CDM", "CAM", "RW", "LW", "ST1", "ST2",
];

function otomatikFormasyonHesapla(userId) {
  const kadro = kullaniciKadrosu(userId);
  const siraliKadro = [...kadro].sort((a, b) => b.power - a.power);
  const kullanilan = new Set();
  const yeniFormasyon = {};

  // 1. Aşama: her slotu gerçek mevkisine en uygun, kadrondaki en güçlü
  // oyuncuyla doldurmaya çalış.
  for (const slot of OTOMATIK_DOLDURMA_SIRASI) {
    const kabulEdilenler = SLOT_KABUL_EDILEN_KATEGORILER[slot];
    const secilen = siraliKadro.find(
      (o) => !kullanilan.has(o) && kabulEdilenler.includes(pozisyonKategorisi(o.position))
    );
    if (secilen) {
      yeniFormasyon[slot] = secilen;
      kullanilan.add(secilen);
    } else {
      yeniFormasyon[slot] = null;
    }
  }

  // 2. Aşama: gerçek mevkisi uymadığı için boş kalan slotları, kadronun
  // geri kalan en güçlü oyuncularıyla (mevki fark etmeksizin) doldur.
  for (const slot of OTOMATIK_DOLDURMA_SIRASI) {
    if (yeniFormasyon[slot]) continue;
    const secilen = siraliKadro.find((o) => !kullanilan.has(o));
    if (secilen) {
      yeniFormasyon[slot] = secilen;
      kullanilan.add(secilen);
    }
  }

  return yeniFormasyon;
}

async function otomatikKurKomutu(message) {
  const userId = message.author.id;
  const kadro = kullaniciKadrosu(userId);

  if (kadro.length < 11) {
    await message.reply(
      `Otomatik takım kurmak için en az 11 oyuncuya ihtiyacın var, şu an kadronda ${kadro.length} oyuncu var. \`!!oyuncu\` yazarak daha fazla çek.`
    );
    return;
  }

  const yeniFormasyon = otomatikFormasyonHesapla(userId);
  futbolData.formasyonlar[userId] = yeniFormasyon;
  veriKaydet();

  const embed = takimEmbedOlustur(
    message.author,
    yeniFormasyon,
    "Otomatik Kuruldu: ",
    "Mevkiler gerçek pozisyonlara göre otomatik ayarlandı, istersen mevki komutlarıyla elle değiştirebilirsin."
  );

  await message.reply({ embeds: [embed] });
}

// ─── Takım Güç Hesabı ─────────────────────────────────────────────────────────

function ortalamaGuc(formasyon, slotlar) {
  const gucler = slotlar.map((s) => (formasyon[s] ? formasyon[s].power : 0));
  return gucler.reduce((a, b) => a + b, 0) / gucler.length;
}

function takimGucleri(formasyon) {
  return {
    hucum: ortalamaGuc(formasyon, HUCUM_SLOTLARI),
    defans: ortalamaGuc(formasyon, DEFANS_SLOTLARI),
  };
}

function takimTam(formasyon) {
  return FORMASYON_SIRA.every((s) => formasyon[s]);
}

// Basit Poisson örnekleyici (Knuth algoritması)
function poissonOrneklem(lambda) {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= Math.random();
  } while (p > L);
  return k - 1;
}

// ─── Gol Atan Oyuncuyu Ağırlıklı Seç ─────────────────────────────────────────
// Forvetler ve kanatlar gol atma ihtimali en yüksek olanlar, defans/kaleci
// nadiren de olsa gol atabilir (mucize gol).
const GOLCU_AGIRLIK = {
  ST1: 26, ST2: 26,
  LW: 15, RW: 15,
  CAM: 12,
  CDM: 4,
  LB: 1, RB: 1,
  CB1: 0.5, CB2: 0.5,
  GK: 0.1,
};

function agirlikliGolcuSec(formasyon) {
  const adaylar = FORMASYON_SIRA.filter((slot) => formasyon[slot]);
  const toplamAgirlik = adaylar.reduce((t, slot) => t + (GOLCU_AGIRLIK[slot] || 1), 0);
  let rastgele = Math.random() * toplamAgirlik;

  for (const slot of adaylar) {
    rastgele -= GOLCU_AGIRLIK[slot] || 1;
    if (rastgele <= 0) return formasyon[slot];
  }
  return formasyon[adaylar[adaylar.length - 1]];
}

// golSayisi kadar gol olayı üretir: { dakika, oyuncu, takim: "ev" | "deplasman" }
function golOlaylariUret(formasyon, golSayisi, takimEtiketi) {
  const olaylar = [];
  for (let i = 0; i < golSayisi; i++) {
    olaylar.push({
      dakika: Math.floor(Math.random() * 90) + 1,
      oyuncu: agirlikliGolcuSec(formasyon),
      takim: takimEtiketi,
    });
  }
  return olaylar;
}

function beklenenGolSayisi(hucumGucu, defansGucu) {
  const fark = hucumGucu - defansGucu;
  let beklenen = 1.35 + fark * 0.045;
  if (beklenen < 0.15) beklenen = 0.15;
  if (beklenen > 6) beklenen = 6;
  return beklenen;
}

// ─── Maç Gerçekçilik Katmanı: Topa Hakimiyet / İsabetli Şut / Maçın Yıldızı ──

function topaHakimiyetHesapla(hucum1, defans1, hucum2, defans2) {
  const guc1 = hucum1 * 0.6 + defans1 * 0.4;
  const guc2 = hucum2 * 0.6 + defans2 * 0.4;
  const toplam = guc1 + guc2;
  if (toplam === 0) return [50, 50];

  let yuzde1 = Math.round((guc1 / toplam) * 100);
  // Aşırı keskin olmasın diye biraz rastgelelik ekle, ama makul aralıkta tut
  yuzde1 = Math.max(28, Math.min(72, yuzde1 + Math.floor(Math.random() * 11) - 5));
  return [yuzde1, 100 - yuzde1];
}

function isabetliSutHesapla(golSayisi, hucumGucu) {
  const ekBaz = 2 + Math.round(hucumGucu / 25);
  return golSayisi + Math.floor(Math.random() * ekBaz) + Math.floor(Math.random() * 3);
}

function macinYildiziniSec(benimGoller, rakipGoller, benimFormasyon, rakipFormasyon) {
  const tumGoller = [...benimGoller, ...rakipGoller];

  if (tumGoller.length > 0) {
    const golSayaci = new Map();
    for (const golOlayi of tumGoller) {
      golSayaci.set(golOlayi.oyuncu, (golSayaci.get(golOlayi.oyuncu) || 0) + 1);
    }
    let enCokGolAtan = null;
    let enCokGolSayisi = 0;
    for (const [oyuncu, sayi] of golSayaci) {
      if (sayi > enCokGolSayisi) {
        enCokGolAtan = oyuncu;
        enCokGolSayisi = sayi;
      }
    }
    if (enCokGolAtan) {
      return { oyuncu: enCokGolAtan, sebep: enCokGolSayisi > 1 ? `${enCokGolSayisi} gol` : "1 gol" };
    }
  }

  // Gol yoksa (0-0), en güçlü 3 oyuncudan rastgele biri "sağlam performans" alır
  const tumOyuncular = [
    ...FORMASYON_SIRA.map((s) => benimFormasyon[s]),
    ...FORMASYON_SIRA.map((s) => rakipFormasyon[s]),
  ].filter(Boolean);

  if (tumOyuncular.length === 0) return null;

  const enGucluler = [...tumOyuncular].sort((a, b) => b.power - a.power).slice(0, 3);
  const secilen = enGucluler[Math.floor(Math.random() * enGucluler.length)];
  return secilen ? { oyuncu: secilen, sebep: "sağlam performans" } : null;
}

// ─── !!mac — Maç Simülasyonu ──────────────────────────────────────────────────

async function macKomutu(message, rakipUye) {
  const atanUserId = message.author.id;

  if (!rakipUye) {
    await message.reply("Kiminle maç yapacaksın? `!!mac @kullanici` şeklinde yaz.");
    return;
  }
  if (rakipUye.bot) {
    await message.reply("Botla maç yapamazsın salak.");
    return;
  }
  if (rakipUye.id === atanUserId) {
    await message.reply("Kendi kendinle mi maç yapacaksın, git terapiye.");
    return;
  }

  const benimFormasyon = kullaniciFormasyonu(atanUserId);
  const rakipFormasyon = kullaniciFormasyonu(rakipUye.id);

  if (!takimTam(benimFormasyon)) {
    await message.reply("Senin takımın tam değil, önce `!!takım` yazıp eksikleri gör.");
    return;
  }
  if (!takimTam(rakipFormasyon)) {
    await message.reply(`${rakipUye.username} kullanıcısının takımı tam değil, maç olmaz.`);
    return;
  }

  const benimGucler = takimGucleri(benimFormasyon);
  const rakipGucler = takimGucleri(rakipFormasyon);

  const benimBeklenenGol = beklenenGolSayisi(benimGucler.hucum, rakipGucler.defans);
  const rakipBeklenenGol = beklenenGolSayisi(rakipGucler.hucum, benimGucler.defans);

  const benimGol = poissonOrneklem(benimBeklenenGol);
  const rakipGol = poissonOrneklem(rakipBeklenenGol);

  // ── Gol Olaylarını Üret ve Dakikaya Göre Sırala ──
  const benimGoller = golOlaylariUret(benimFormasyon, benimGol, "ev");
  const rakipGoller = golOlaylariUret(rakipFormasyon, rakipGol, "deplasman");
  const tumGoller = [...benimGoller, ...rakipGoller].sort((a, b) => a.dakika - b.dakika);

  let evSkor = 0;
  let depSkor = 0;
  const zamanCizelgesi = tumGoller.map((golOlayi) => {
    if (golOlayi.takim === "ev") evSkor++;
    else depSkor++;
    return `\`${golOlayi.dakika}'\` ⚽ **${golOlayi.oyuncu.name}** golü buldu! (${evSkor}-${depSkor})`;
  });

  const golAnlatimi =
    zamanCizelgesi.length > 0
      ? zamanCizelgesi.join("\n")
      : "90 dakika boyunca gol sesi çıkmadı, iki kale de sağlam kaldı.";

  // ── Gerçekçilik Katmanı: Hakimiyet, İsabetli Şut, Maçın Yıldızı ──
  const [benimHakimiyet, rakipHakimiyet] = topaHakimiyetHesapla(
    benimGucler.hucum, benimGucler.defans, rakipGucler.hucum, rakipGucler.defans
  );
  const benimIsabet = isabetliSutHesapla(benimGol, benimGucler.hucum);
  const rakipIsabet = isabetliSutHesapla(rakipGol, rakipGucler.hucum);
  const yildiz = macinYildiziniSec(benimGoller, rakipGoller, benimFormasyon, rakipFormasyon);

  // ── Puan + Para Dağıtımı ──
  const benimPuan = kullaniciPuani(atanUserId);
  const rakipPuan = kullaniciPuani(rakipUye.id);

  const toplamGucBen = benimGucler.hucum + benimGucler.defans;
  const toplamGucRakip = rakipGucler.hucum + rakipGucler.defans;
  const sürprizBonus = Math.abs(toplamGucBen - toplamGucRakip) > 8 ? 1.25 : 1;

  let sonucMesaji;
  let benimOdul = 0;
  let rakipOdul = 0;

  if (benimGol > rakipGol) {
    benimPuan.galibiyet++;
    benimPuan.puan += 3;
    rakipPuan.maglubiyet++;
    const zayifMiydi = toplamGucBen < toplamGucRakip;
    benimOdul = Math.round((50000 + Math.random() * 100000) * (zayifMiydi ? sürprizBonus : 1));
    rakipOdul = Math.round(5000 + Math.random() * 10000);
    sonucMesaji = `🏆 **${message.author.username}** kazandı! +3 puan ve **${paraFormatla(benimOdul)}** kazandı.`;
  } else if (benimGol < rakipGol) {
    rakipPuan.galibiyet++;
    rakipPuan.puan += 3;
    benimPuan.maglubiyet++;
    const zayifMiydi = toplamGucRakip < toplamGucBen;
    rakipOdul = Math.round((50000 + Math.random() * 100000) * (zayifMiydi ? sürprizBonus : 1));
    benimOdul = Math.round(5000 + Math.random() * 10000);
    sonucMesaji = `🏆 **${rakipUye.username}** kazandı! +3 puan ve **${paraFormatla(rakipOdul)}** kazandı.`;
  } else {
    benimPuan.beraberlik++;
    rakipPuan.beraberlik++;
    benimPuan.puan += 1;
    rakipPuan.puan += 1;
    benimOdul = Math.round(20000 + Math.random() * 20000);
    rakipOdul = Math.round(20000 + Math.random() * 20000);
    sonucMesaji = `🤝 Berabere kaldınız, ikinize de +1 puan ve maç primi verildi.`;
  }

  paraEkle(atanUserId, benimOdul);
  paraEkle(rakipUye.id, rakipOdul);

  veriKaydet();

  const renk = benimGol === rakipGol ? 0xf1c40f : 0x2ecc71;

  const embed = new EmbedBuilder()
    .setColor(renk)
    .setTitle("⚽ MAÇ SONUCU")
    .setDescription(
      `**${message.author.username}**  ${benimGol} — ${rakipGol}  **${rakipUye.username}**\n\n${golAnlatimi}\n\n${sonucMesaji}`
    )
    .addFields(
      {
        name: `📊 ${message.author.username}`,
        value: `Hücum: **${benimGucler.hucum.toFixed(1)}**\nDefans: **${benimGucler.defans.toFixed(1)}**\nTopa Hakimiyet: **%${benimHakimiyet}**\nİsabetli Şut: **${benimIsabet}**\n💰 Kazanç: ${paraFormatla(benimOdul)}`,
        inline: true,
      },
      {
        name: `📊 ${rakipUye.username}`,
        value: `Hücum: **${rakipGucler.hucum.toFixed(1)}**\nDefans: **${rakipGucler.defans.toFixed(1)}**\nTopa Hakimiyet: **%${rakipHakimiyet}**\nİsabetli Şut: **${rakipIsabet}**\n💰 Kazanç: ${paraFormatla(rakipOdul)}`,
        inline: true,
      }
    );

  if (yildiz) {
    embed.addFields({
      name: "⭐ Maçın Yıldızı",
      value: `**${yildiz.oyuncu.name}** (${yildiz.sebep})`,
    });
  }

  embed.setFooter({
    text: `Güncel bakiye — ${message.author.username}: ${paraFormatla(kullaniciParasi(atanUserId))} · ${rakipUye.username}: ${paraFormatla(kullaniciParasi(rakipUye.id))}`,
  });

  await message.reply({ embeds: [embed] });
}

// ─── !!puan / !!puanlar ──────────────────────────────────────────────────────

async function puanGosterKomutu(message) {
  const puan = kullaniciPuani(message.author.id);
  await message.reply(
    `📊 **${message.author.username}** — ${puan.galibiyet}G ${puan.beraberlik}B ${puan.maglubiyet}M — **${puan.puan} puan**`
  );
}

async function puanTablosuKomutu(message) {
  const girdiler = Object.entries(futbolData.puanlar)
    .map(([userId, veri]) => ({ userId, ...veri }))
    .sort((a, b) => b.puan - a.puan)
    .slice(0, 10);

  if (girdiler.length === 0) {
    await message.reply("Henüz kimse maç yapmamış, puan tablosu boş.");
    return;
  }

  const satirlar = await Promise.all(
    girdiler.map(async (g, i) => {
      let isim = `<@${g.userId}>`;
      try {
        const uye = await message.guild.members.fetch(g.userId);
        isim = uye.user.username;
      } catch {
        // sunucudan ayrılmış olabilir, mention ile göster
      }
      return `**${i + 1}.** ${isim} — ${g.puan} puan (${g.galibiyet}G ${g.beraberlik}B ${g.maglubiyet}M)`;
    })
  );

  const embed = new EmbedBuilder()
    .setColor(0x1abc9c)
    .setTitle("🏆 Lig Tablosu")
    .setDescription(satirlar.join("\n"));

  await message.reply({ embeds: [embed] });
}

// ─── !!bakiye / !!para ────────────────────────────────────────────────────────

async function bakiyeGosterKomutu(message) {
  await message.reply(
    `💰 **${message.author.username}** — Bakiye: **${paraFormatla(kullaniciParasi(message.author.id))}**`
  );
}

// ─── !!satisa — Piyasaya Oyuncu Çıkar ────────────────────────────────────────

async function satisaCikarKomutu(message, argStr) {
  const userId = message.author.id;

  if (!argStr) {
    await message.reply("Kullanım: `!!satisa <oyuncu ismi> <fiyat>` (örn: `!!satisa Erling Haaland 850000`)");
    return;
  }

  const eslesme = argStr.match(/^(.+?)\s+([\d.,]+)\s*€?$/);
  if (!eslesme) {
    await message.reply("Fiyatı doğru yazmadın. Kullanım: `!!satisa <oyuncu ismi> <fiyat>`");
    return;
  }

  const isim = eslesme[1].trim();
  const fiyat = parseInt(eslesme[2].replace(/[.,]/g, ""), 10);

  if (!fiyat || fiyat <= 0) {
    await message.reply("Geçerli bir fiyat yaz (örn: 500000).");
    return;
  }

  const eslesmeler = kadrodaOyuncuAra(userId, isim);

  if (eslesmeler.length === 0) {
    await message.reply(`Kadronda "${isim}" diye biri yok.`);
    return;
  }
  if (eslesmeler.length > 1) {
    const secenekler = eslesmeler.slice(0, 8).map((o) => `${o.name} (${o.club})`).join(", ");
    await message.reply(`Birden fazla eşleşme buldum, daha net yaz: ${secenekler}`);
    return;
  }

  const oyuncu = eslesmeler[0];

  const zatenListelenmis = futbolData.piyasa.find((ilan) => ilan.oyuncuId === oyuncu.id);
  if (zatenListelenmis) {
    await message.reply(`${oyuncu.name} zaten piyasada, önce \`!!satisiptal ${oyuncu.name}\` ile geri çek.`);
    return;
  }

  futbolData.piyasa.push({
    id: crypto.randomUUID(),
    saticiId: userId,
    oyuncuId: oyuncu.id,
    oyuncu,
    fiyat,
    tarih: bugununTarihi(),
  });

  veriKaydet();

  await message.reply(
    `📤 **${oyuncu.name}** (Güç: ${oyuncu.power}) piyasaya **${paraFormatla(fiyat)}** fiyatla kondu. \`!!piyasa\` yazarak listeyi görebilirsin.`
  );
}

// ─── !!piyasa — Satıştaki Oyuncuları Sayfa Sayfa Göster ──────────────────────

async function piyasaGosterKomutu(message) {
  const ilanlar = futbolData.piyasa;

  if (ilanlar.length === 0) {
    await message.reply("Piyasada satılık oyuncu yok. `!!satisa <isim> <fiyat>` ile ilk ilanı sen ver.");
    return;
  }

  const siraliIlanlar = [...ilanlar].sort((a, b) => a.fiyat - b.fiyat);
  const SAYFA_BASI = 6;
  const gruplar = [];
  for (let i = 0; i < siraliIlanlar.length; i += SAYFA_BASI) {
    gruplar.push(siraliIlanlar.slice(i, i + SAYFA_BASI));
  }

  const sayfaOlusturucular = gruplar.map((grup, grupIndex) => (sayfaNo, toplam) => {
    const aciklama = grup
      .map((ilan, i) => {
        const siraNo = grupIndex * SAYFA_BASI + i + 1;
        return `**${siraNo}.** ${ilan.oyuncu.name} — \`${ilan.oyuncu.position}\` — Güç: **${ilan.oyuncu.power}**\n💰 ${paraFormatla(ilan.fiyat)} · Satıcı: <@${ilan.saticiId}>`;
      })
      .join("\n\n");

    return new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle(`💱 Transfer Piyasası (${ilanlar.length} ilan)`)
      .setDescription(aciklama)
      .setFooter({
        text: `Sayfa ${sayfaNo + 1}/${toplam} · ◀️ ▶️ ile gezin · Almak için: !!satinal <isim>`,
      });
  });

  await sayfaliGonder(message, sayfaOlusturucular);
}

// ─── !!satinal — Piyasadan Oyuncu Satın Al ───────────────────────────────────

async function satinAlKomutu(message, isim) {
  const userId = message.author.id;

  if (!isim) {
    await message.reply("Kimi alacaksın? `!!satinal <isim>` şeklinde yaz.");
    return;
  }

  const hedef = normalizeAd(isim);
  const eslesmeler = futbolData.piyasa.filter((ilan) => normalizeAd(ilan.oyuncu.name).includes(hedef));

  if (eslesmeler.length === 0) {
    await message.reply(`Piyasada "${isim}" diye satılık biri yok. \`!!piyasa\` ile listeyi gör.`);
    return;
  }
  if (eslesmeler.length > 1) {
    const secenekler = eslesmeler
      .slice(0, 8)
      .map((ilan) => `${ilan.oyuncu.name} (${paraFormatla(ilan.fiyat)})`)
      .join(", ");
    await message.reply(`Birden fazla eşleşme buldum, daha net yaz: ${secenekler}`);
    return;
  }

  const ilan = eslesmeler[0];

  if (ilan.saticiId === userId) {
    await message.reply("Kendi oyuncunu kendinden satın alamazsın, `!!satisiptal` ile geri çekebilirsin.");
    return;
  }

  const bakiye = kullaniciParasi(userId);
  if (bakiye < ilan.fiyat) {
    await message.reply(
      `Yeterli paran yok. **${ilan.oyuncu.name}** için ${paraFormatla(ilan.fiyat)} lazım, senin bakiyen ${paraFormatla(bakiye)}.`
    );
    return;
  }

  // Parayı transfer et
  paraCikar(userId, ilan.fiyat);
  paraEkle(ilan.saticiId, ilan.fiyat);

  // Oyuncuyu satıcının kadrosundan ve varsa formasyonundan çıkar
  const saticiKadro = kullaniciKadrosu(ilan.saticiId);
  const oyuncuIndex = saticiKadro.findIndex((o) => o.id === ilan.oyuncuId);
  if (oyuncuIndex !== -1) saticiKadro.splice(oyuncuIndex, 1);

  const saticiFormasyon = kullaniciFormasyonu(ilan.saticiId);
  for (const slot of FORMASYON_SIRA) {
    if (saticiFormasyon[slot] && saticiFormasyon[slot].id === ilan.oyuncuId) {
      saticiFormasyon[slot] = null;
    }
  }

  // Alıcının kadrosuna ekle
  kullaniciKadrosu(userId).push(ilan.oyuncu);

  // İlanı piyasadan kaldır
  futbolData.piyasa = futbolData.piyasa.filter((i) => i.id !== ilan.id);

  veriKaydet();

  await message.reply(
    `✅ **${ilan.oyuncu.name}** kadrona katıldı! ${paraFormatla(ilan.fiyat)} <@${ilan.saticiId}>'a ödendi. Yeni bakiyen: **${paraFormatla(kullaniciParasi(userId))}**`
  );

  try {
    await message.channel.send(
      `📢 <@${ilan.saticiId}>, **${ilan.oyuncu.name}** adlı oyuncun ${message.author.username}'a ${paraFormatla(ilan.fiyat)} karşılığında satıldı. Yeni bakiyen: **${paraFormatla(kullaniciParasi(ilan.saticiId))}**`
    );
  } catch (err) {
    // önemli değil
  }
}

// ─── !!satisiptal — Kendi İlanını Geri Çek ───────────────────────────────────

async function satisIptalKomutu(message, isim) {
  const userId = message.author.id;

  if (!isim) {
    await message.reply("Hangi ilanı iptal edeceksin? `!!satisiptal <isim>` şeklinde yaz.");
    return;
  }

  const hedef = normalizeAd(isim);
  const eslesmeler = futbolData.piyasa.filter(
    (ilan) => ilan.saticiId === userId && normalizeAd(ilan.oyuncu.name).includes(hedef)
  );

  if (eslesmeler.length === 0) {
    await message.reply(`Piyasada senin "${isim}" diye bir ilanın yok.`);
    return;
  }
  if (eslesmeler.length > 1) {
    const secenekler = eslesmeler.slice(0, 8).map((ilan) => ilan.oyuncu.name).join(", ");
    await message.reply(`Birden fazla eşleşme buldum, daha net yaz: ${secenekler}`);
    return;
  }

  const ilan = eslesmeler[0];
  futbolData.piyasa = futbolData.piyasa.filter((i) => i.id !== ilan.id);
  veriKaydet();

  await message.reply(`↩️ **${ilan.oyuncu.name}** piyasadan geri çekildi.`);
}

// ─── !!futbolyardim ───────────────────────────────────────────────────────────

async function yardimKomutu(message) {
  const embed = new EmbedBuilder()
    .setColor(0x1abc9c)
    .setTitle("⚽ Futbol Komutları")
    .setDescription(
      [
        "**Kadro & Takım**",
        "`!!oyuncu` — günlük 20 oyuncu çek",
        "`!!kadro` — en iyi 20 oyuncunu sayfa sayfa gör (◀️ ▶️ ile gez)",
        "`!!takım` — ilk 11'ini gör",
        "`!!otomatik` — kadrondaki en iyi 11'i otomatik kurar",
        "`!!kaleci <isim>`, `!!stoper <isim>`, `!!sagbek <isim>`, `!!solbek <isim>`",
        "`!!defansiorta <isim>`, `!!ofansiorta <isim>`, `!!sagkanat <isim>`, `!!solkanat <isim>`, `!!forvet <isim>`",
        "`!!cikar <mevki>` — bir mevkiyi boşalt (örn: forvet1, stoper2)",
        "",
        "**Maç & Lig**",
        "`!!mac @kullanici` — maç yap, kazanana puan + para",
        "`!!puan` — kendi puanını gör",
        "`!!puanlar` — lig tablosu",
        "",
        "**Para & Transfer Piyasası**",
        "`!!bakiye` — Euro bakiyeni gör",
        "`!!satisa <isim> <fiyat>` — bir oyuncunu piyasaya çıkar",
        "`!!piyasa` — satıştaki oyuncuları sayfa sayfa gör (◀️ ▶️ ile gez)",
        "`!!satinal <isim>` — piyasadan oyuncu satın al",
        "`!!satisiptal <isim>` — kendi ilanını geri çek",
      ].join("\n")
    );

  await message.reply({ embeds: [embed] });
}

// ─── Ana Mesaj İşleyici ────────────────────────────────────────────────────────
// index.js'deki MessageCreate handler'ından çağrılır.
// Bir futbol komutu işlendiyse true, işlenmediyse false döner.

async function futbolMesajIsleyici(message) {
  if (!message.content.startsWith(PREFIX)) return false;

  const govde = message.content.slice(PREFIX.length).trim();
  const bosluk = govde.indexOf(" ");
  const komutAdi = normalizeAd(bosluk === -1 ? govde : govde.slice(0, bosluk));
  const argumanlar = bosluk === -1 ? "" : govde.slice(bosluk + 1).trim();

  try {
    if (komutAdi === "oyuncu") {
      await oyuncuCekKomutu(message);
      return true;
    }

    if (komutAdi === "kadro") {
      await kadroGosterKomutu(message);
      return true;
    }

    if (komutAdi === "takim") {
      const hedefUye = message.mentions.users.first();
      await takimGosterKomutu(message, hedefUye);
      return true;
    }

    if (komutAdi === "otomatik" || komutAdi === "ototakim") {
      await otomatikKurKomutu(message);
      return true;
    }

    if (komutAdi in KOMUT_POZISYON) {
      await pozisyonaYerlestirKomutu(message, komutAdi, argumanlar);
      return true;
    }

    if (komutAdi === "cikar") {
      await cikarKomutu(message, argumanlar);
      return true;
    }

    if (komutAdi === "mac") {
      const rakipUye = message.mentions.users.first();
      await macKomutu(message, rakipUye);
      return true;
    }

    if (komutAdi === "puan") {
      await puanGosterKomutu(message);
      return true;
    }

    if (komutAdi === "puanlar") {
      await puanTablosuKomutu(message);
      return true;
    }

    if (komutAdi === "bakiye" || komutAdi === "para") {
      await bakiyeGosterKomutu(message);
      return true;
    }

    if (komutAdi === "satisa" || komutAdi === "sat") {
      await satisaCikarKomutu(message, argumanlar);
      return true;
    }

    if (komutAdi === "piyasa") {
      await piyasaGosterKomutu(message);
      return true;
    }

    if (komutAdi === "satinal" || komutAdi === "al") {
      await satinAlKomutu(message, argumanlar);
      return true;
    }

    if (komutAdi === "satisiptal" || komutAdi === "iptal") {
      await satisIptalKomutu(message, argumanlar);
      return true;
    }

    if (komutAdi === "futbolyardim") {
      await yardimKomutu(message);
      return true;
    }
  } catch (err) {
    console.error("[Futbol] Komut hatası:", err);
    await message.reply("Futbol tarafında bir şeyler patladı, TURBO31'e haber ver.");
    return true;
  }

  return false;
}

module.exports = { futbolMesajIsleyici };
