// ═══════════════════════════════════════════════════════════════════════════
// FUTBOL MODÜLÜ — Murat botuna eklenen "!!" komutlu futbol takım/maç sistemi
// ═══════════════════════════════════════════════════════════════════════════
//
// KOMUTLAR:
//   !!oyuncu                → Günde 1 kere 20 rastgele gerçek futbolcu çeker,
//                              kadrona (biriktirdiğin oyuncu havuzuna) ekler.
//   !!kadro                 → Şu ana kadar topladığın oyuncuları listeler.
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
//                                tamsa maçı oynatır, kazanana puan yazar.
//   !!puan                   → Kendi puan durumunu gösterir.
//   !!puanlar                → Sunucu lig tablosunu (top 10) gösterir.
//   !!futboly yardim          !!futbolyardim
//                              → Komut listesini gösterir.
//
// VERİ:
//   futbol_oyuncular.json içinde ~11.000 gerçek futbolcu (isim, mevki, güç,
//   kulüp, ülke) bulunuyor. Bu dosya bir kere internetten indirilip pakete
//   dahil edildi, bot çalışırken tekrar internete gitmesi gerekmiyor.
//
// KALICI VERİ:
//   futbol_data.json dosyasında her kullanıcının kadrosu, ilk 11'i, puanı ve
//   günlük çekiliş tarihi tutulur. user_profiles.json ile aynı mantıkla
//   çalışır (basit dosya tabanlı JSON depolama).
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
const { EmbedBuilder } = require("discord.js");

const OYUNCU_HAVUZU_DOSYASI = path.join(__dirname, "futbol_oyuncular.json");
const FUTBOL_DATA_DOSYASI = path.join(__dirname, "futbol_data.json");

const GUNLUK_OYUNCU_SAYISI = 20;
const PREFIX = "!!";

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

// ─── Kalıcı Veri (kadrolar, takımlar, puanlar) ───────────────────────────────

function bosVeri() {
  return {
    kadrolar: {}, // userId -> [ {name, position, power, club, nationality} ]
    formasyonlar: {}, // userId -> { GK: oyuncu|null, CB1: ..., ... }
    puanlar: {}, // userId -> { galibiyet, beraberlik, maglubiyet, puan }
    gunlukCekilis: {}, // userId -> "YYYY-MM-DD" (son çekiliş tarihi)
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

  for (const oyuncu of secilenler) kadro.push(oyuncu);

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

// ─── !!kadro — Toplanan Oyuncuları Listele ───────────────────────────────────

async function kadroGosterKomutu(message) {
  const userId = message.author.id;
  const kadro = kullaniciKadrosu(userId);

  if (kadro.length === 0) {
    await message.reply("Kadronda hiç oyuncu yok, önce `!!oyuncu` yazarak çekiliş yap.");
    return;
  }

  const siraliListe = [...kadro].sort((a, b) => b.power - a.power);
  const gosterilecek = siraliListe.slice(0, 30);

  const aciklama = gosterilecek
    .map((o) => `${o.name} — \`${o.position}\` — Güç: **${o.power}**`)
    .join("\n");

  const embed = new EmbedBuilder()
    .setColor(0x1abc9c)
    .setTitle(`⚽ Kadron (${kadro.length} oyuncu)`)
    .setDescription(
      kadro.length > 30
        ? `${aciklama}\n\n...ve ${kadro.length - 30} oyuncu daha (en güçlü 30 tanesi gösteriliyor).`
        : aciklama
    );

  await message.reply({ embeds: [embed] });
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

function beklenenGolSayisi(hucumGucu, defansGucu) {
  const fark = hucumGucu - defansGucu;
  let beklenen = 1.35 + fark * 0.045;
  if (beklenen < 0.15) beklenen = 0.15;
  if (beklenen > 6) beklenen = 6;
  return beklenen;
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

  const benimPuan = kullaniciPuani(atanUserId);
  const rakipPuan = kullaniciPuani(rakipUye.id);

  let sonucMesaji;
  if (benimGol > rakipGol) {
    benimPuan.galibiyet++;
    benimPuan.puan += 3;
    rakipPuan.maglubiyet++;
    sonucMesaji = `🏆 **${message.author.username}** kazandı! +3 puan.`;
  } else if (benimGol < rakipGol) {
    rakipPuan.galibiyet++;
    rakipPuan.puan += 3;
    benimPuan.maglubiyet++;
    sonucMesaji = `🏆 **${rakipUye.username}** kazandı! +3 puan.`;
  } else {
    benimPuan.beraberlik++;
    rakipPuan.beraberlik++;
    benimPuan.puan += 1;
    rakipPuan.puan += 1;
    sonucMesaji = "🤝 Berabere kaldınız, ikinize de +1 puan.";
  }

  veriKaydet();

  const embed = new EmbedBuilder()
    .setColor(0x1abc9c)
    .setTitle("⚽ MAÇ SONUCU")
    .setDescription(
      `**${message.author.username}**  ${benimGol} — ${rakipGol}  **${rakipUye.username}**\n\n${sonucMesaji}`
    )
    .addFields(
      {
        name: message.author.username,
        value: `Hücum: ${benimGucler.hucum.toFixed(1)}\nDefans: ${benimGucler.defans.toFixed(1)}`,
        inline: true,
      },
      {
        name: rakipUye.username,
        value: `Hücum: ${rakipGucler.hucum.toFixed(1)}\nDefans: ${rakipGucler.defans.toFixed(1)}`,
        inline: true,
      }
    );

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

// ─── !!futbolyardim ───────────────────────────────────────────────────────────

async function yardimKomutu(message) {
  const embed = new EmbedBuilder()
    .setColor(0x1abc9c)
    .setTitle("⚽ Futbol Komutları")
    .setDescription(
      [
        "`!!oyuncu` — günlük 20 oyuncu çek",
        "`!!kadro` — topladığın oyuncuları gör",
        "`!!takım` — ilk 11'ini gör",
        "`!!otomatik` — kadrondaki en iyi 11'i otomatik kurar (gerçek mevkilere göre)",
        "`!!kaleci <isim>`, `!!stoper <isim>`, `!!sagbek <isim>`, `!!solbek <isim>`",
        "`!!defansiorta <isim>`, `!!ofansiorta <isim>`, `!!sagkanat <isim>`, `!!solkanat <isim>`, `!!forvet <isim>`",
        "`!!cikar <mevki>` — bir mevkiyi boşalt (örn: forvet1, stoper2)",
        "`!!mac @kullanici` — maç yap",
        "`!!puan` — kendi puanını gör",
        "`!!puanlar` — lig tablosu",
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
