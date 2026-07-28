// ─────────────────────────────────────────────────────────────────────────
// !!build <şampiyon> [pozisyon] komutu
//
// Nasıl çalışır:
//   1) OP.GG'nin RESMİ MCP (Model Context Protocol) servisine bağlanılır:
//      https://mcp-api.op.gg/mcp  →  "lol_get_champion_analysis" aracı.
//      Bu araç güncel patch'e göre winrate/pickrate, önerilen rün sayfaları,
//      önerilen item build'leri ve counter (weakCounters) verisini döndürür.
//   2) Bu ham veri, kendi cevabını uyduran bir LLM olarak DEĞİL, sadece
//      gelen veriyi Türkçeye çevirip düzenleyen bir "sunum katmanı" olarak
//      Groq'a (Murat'ın beynine) veriliyor; Murat bu veriyi akıcı ve düzgün
//      yazılmış Türkçe bir Discord mesajına dönüştürüyor.
//   3) Sonuç, şampiyonun splash görseliyle birlikte bir embed olarak
//      gönderiliyor.
//
// ÖNEMLİ NOT (lütfen oku):
//   OP.GG MCP servisi herkese açık ve resmi bir servis, fakat üçüncü taraf
//   bir servis olduğu için şeması (parametre isimleri/değerleri, dönen JSON
//   yapısı) zamanla değişebilir. Kodu elimden geldiğince sağlam ve hataya
//   dayanıklı yazdım (yanlış giden bir şey olursa Murat kullanıcıya net bir
//   Türkçe hata mesajı verir, sunucu çökmez), ama canlıda ilk denemede
//   küçük bir ayar (örn. "position" değerinin beklediği tam değer) gerekirse
//   şaşırma — konsol loglarını (console.error ile basılan hata) bana
//   gönderirsen anında düzeltebilirim.
// ─────────────────────────────────────────────────────────────────────────

const { EmbedBuilder } = require("discord.js");

const OPGG_MCP_ENDPOINT = "https://mcp-api.op.gg/mcp";
const MCP_PROTOCOL_VERSION = "2025-03-26";

let mcpSessionId = null;
let mcpInitPromise = null;

// ─── Düşük seviyeli MCP (JSON-RPC üzerinden) istemcisi ─────────────────────

function mcpHeaders() {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (mcpSessionId) headers["Mcp-Session-Id"] = mcpSessionId;
  return headers;
}

async function parseMcpHttpResponse(res) {
  const sid = res.headers.get("mcp-session-id");
  if (sid) mcpSessionId = sid;

  const contentType = res.headers.get("content-type") || "";

  if (contentType.includes("text/event-stream")) {
    // Streamable HTTP taşımasında sunucu SSE formatında da cevap verebilir.
    const raw = await res.text();
    const dataLines = raw
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter(Boolean);

    for (const line of dataLines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed && (parsed.result !== undefined || parsed.error !== undefined)) {
          return parsed;
        }
      } catch (_) {
        // Bu satır JSON değilse yoksay, sıradaki satıra bak.
      }
    }
    throw new Error("OP.GG MCP servisinden gelen akış (SSE) çözümlenemedi.");
  }

  return res.json();
}

async function mcpRequest(method, params, { isNotification = false } = {}) {
  const body = isNotification
    ? { jsonrpc: "2.0", method, params }
    : {
        jsonrpc: "2.0",
        id: `${Date.now()}-${Math.floor(Math.random() * 100000)}`,
        method,
        params,
      };

  const res = await fetch(OPGG_MCP_ENDPOINT, {
    method: "POST",
    headers: mcpHeaders(),
    body: JSON.stringify(body),
  });

  if (isNotification) return null;

  if (!res.ok) {
    throw new Error(`OP.GG MCP servisi HTTP ${res.status} döndürdü.`);
  }

  const parsed = await parseMcpHttpResponse(res);

  if (parsed.error) {
    throw new Error(
      `OP.GG MCP hata döndürdü: ${parsed.error.message || JSON.stringify(parsed.error)}`
    );
  }

  return parsed.result;
}

async function ensureMcpSession() {
  if (mcpSessionId) return;

  if (!mcpInitPromise) {
    mcpInitPromise = (async () => {
      await mcpRequest("initialize", {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "murat-botu", version: "1.0.0" },
      });
      await mcpRequest("notifications/initialized", {}, { isNotification: true });
    })().finally(() => {
      mcpInitPromise = null;
    });
  }

  await mcpInitPromise;
}

async function callOpggTool(name, args) {
  await ensureMcpSession();
  return mcpRequest("tools/call", { name, arguments: args });
}

// ─── Şampiyon / pozisyon adı normalizasyonu ────────────────────────────────

const CHAMPION_ALIASES = {
  mf: "Miss Fortune",
  tf: "Twisted Fate",
  asol: "Aurelion Sol",
  j4: "Jarvan IV",
  yi: "Master Yi",
  vlad: "Vladimir",
  ww: "Warwick",
  cho: "Cho'Gath",
  chogath: "Cho'Gath",
  khazix: "Kha'Zix",
  kaisa: "Kai'Sa",
  "kai sa": "Kai'Sa",
  velkoz: "Vel'Koz",
  reksai: "Rek'Sai",
  belveth: "Bel'Veth",
  nunu: "Nunu & Willump",
  drmundo: "Dr. Mundo",
  twitch: "Twitch",
  ksante: "K'Sante",
  "k sante": "K'Sante",
};

function normalizeChampionName(input) {
  const key = input.trim().toLowerCase();
  if (CHAMPION_ALIASES[key]) return CHAMPION_ALIASES[key];

  return input
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toLocaleUpperCase("tr-TR") + w.slice(1))
    .join(" ");
}

const POSITION_ALIASES = {
  üst: "TOP",
  ust: "TOP",
  top: "TOP",
  orman: "JUNGLE",
  jungle: "JUNGLE",
  jg: "JUNGLE",
  orta: "MID",
  mid: "MID",
  alt: "ADC",
  adc: "ADC",
  bot: "ADC",
  botlane: "ADC",
  destek: "SUPPORT",
  support: "SUPPORT",
  sup: "SUPPORT",
};

function normalizePosition(input) {
  if (!input) return null;
  const key = input.trim().toLowerCase();
  return POSITION_ALIASES[key] || null;
}

function championSplashSlug(name) {
  // "Kai'Sa" -> "Kaisa", "Dr. Mundo" -> "DrMundo", "Nunu & Willump" -> "Nunu"
  return name.split(/[&(]/)[0].replace(/[^a-zA-Z]/g, "");
}

// ─── MCP aracının sonucundan ham veriyi çıkarma ────────────────────────────

function extractToolPayload(result) {
  if (!result) return null;

  if (Array.isArray(result.content)) {
    const textPart = result.content.find((c) => c.type === "text");
    if (textPart && textPart.text) {
      try {
        return JSON.parse(textPart.text);
      } catch (_) {
        return textPart.text; // JSON değilse düz metin olarak dön
      }
    }
  }

  return result;
}

async function fetchChampionAnalysis(championName, position) {
  const args = {
    champion: championName,
    position: position || "MID",
    game_mode: "RANKED",
    lang: "en_US",
  };

  const result = await callOpggTool("lol_get_champion_analysis", args);
  return extractToolPayload(result);
}

// ─── Ham veriyi Murat'ın (Groq) diliyle akıcı Türkçeye çevirme ────────────

const SUMMARY_SYSTEM_PROMPT = `Sen Murat'sın; Discord'da yaşayan, çok akıcı ve yazım kurallarına son derece dikkat eden, League of Legends konusunda uzman bir Türk chat botusun.

Sana OP.GG'den az önce çekilmiş, bir şampiyona ait HAM JSON veri verilecek. Görevin bu veriyi SADECE Türkçeye çevirip düzenli, akıcı ve görsel olarak okunaklı bir Discord mesajına dönüştürmek. Veride yer almayan hiçbir sayıyı, rünü, itemi veya rakibi UYDURMA.

Cevabını mutlaka şu başlıklarla, bu sırayla ver (Discord markdown kullan: **kalın başlık**, madde işaretleri "•", uygun emoji):

**🔮 Rün Önerileri** — veride varsa en fazla 3 alternatif rün dizilimini, her biri için (varsa) kazanma oranıyla birlikte listele.
**⚔️ Item Build Önerileri** — veride varsa en fazla 3 alternatif item build'ini, sırasıyla (başlangıç/çekirdek/son) listele.
**🛡️ Bu Şampiyonu Zorlayan Counter'lar** — veride "weakCounters" veya benzeri bir alan varsa, bu şampiyonu zorlayan rakipleri ve onlara karşı olan kazanma oranını listele.
**📊 Genel İstatistikler** — şampiyonun genel kazanma oranı (winrate), seçilme oranı (pickrate) ve varsa yasaklanma oranı (banrate).
**💡 Nasıl Oynanmalı** — veride oynanış/beceri sırası ile ilgili bilgi varsa kısa ve pratik tavsiyeler ver; yoksa bu başlığı kısa tut ve genel geçer, veriye dayanmayan uydurma detay verme.

Bir başlığa ait veri JSON içinde hiç yoksa, o başlığın altına "Bu veri için güncel kayıt bulunamadı." yaz, uydurma bilgi ekleme. Cevabın 1600 kelimeyi geçmesin, gereksiz tekrar yapma, sohbet havasında ama düzenli bir üslup kullan.`;

async function summarizeAnalysisInTurkish(groq, championName, position, rawData) {
  const jsonText = JSON.stringify(rawData).slice(0, 14000);

  const response = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    temperature: 0.35,
    max_tokens: 1500,
    messages: [
      { role: "system", content: SUMMARY_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Şampiyon: ${championName}${position ? ` — Pozisyon: ${position}` : ""}\n\nOP.GG'den gelen ham veri (JSON):\n${jsonText}`,
      },
    ],
  });

  return response.choices[0].message.content.trim();
}

// ─── Discord embed oluşturma ───────────────────────────────────────────────

async function buildAnalysisEmbed(groq, championName, position, rawData) {
  const summary = await summarizeAnalysisInTurkish(groq, championName, position, rawData);
  const slug = championSplashSlug(championName);

  const embed = new EmbedBuilder()
    .setTitle(`${championName} — Build, Rün ve Counter Rehberi`)
    .setColor(0x0ac8b9)
    .setThumbnail(`https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${slug}_0.jpg`)
    .setFooter({ text: "Veriler OP.GG üzerinden anlık olarak çekilmiştir · Murat" });

  // Discord embed description sınırı 4096 karakter; güvenli tarafta kalalım.
  if (summary.length <= 4000) {
    embed.setDescription(summary);
  } else {
    embed.setDescription(summary.slice(0, 4000) + "\n\n*(Mesaj sığdırmak için kısaltıldı.)*");
  }

  return embed;
}

// ─── Dışa açılan komut işleyicisi ──────────────────────────────────────────

const BUILD_REGEX = /^!!build\s+(.+)$/i;

/**
 * @param {import('discord.js').Message} message
 * @param {import('groq-sdk').Groq} groq
 * @returns {Promise<boolean>} komut işlendiyse true
 */
async function buildKomutuIsleyici(message, groq) {
  const match = message.content.trim().match(BUILD_REGEX);
  if (!match) return false;

  const parts = match[1].trim().split(/\s+/);
  let position = null;
  let championWords = parts;

  const maybePosition = normalizePosition(parts[parts.length - 1]);
  if (maybePosition && parts.length > 1) {
    position = maybePosition;
    championWords = parts.slice(0, -1);
  }

  const championInput = championWords.join(" ");
  if (!championInput) {
    await message.reply(
      "Hangi şampiyonun build'ine bakmamı istersin? Örnek: `!!build Yasuo` ya da `!!build Lux destek`"
    );
    return true;
  }

  const championName = normalizeChampionName(championInput);
  const bekleMesaji = await message.reply(
    `${championName} için güncel build, rün ve counter verilerini topluyorum, bir saniye...`
  );

  try {
    const rawData = await fetchChampionAnalysis(championName, position);
    const embed = await buildAnalysisEmbed(groq, championName, position, rawData);
    await bekleMesaji.edit({ content: null, embeds: [embed] });
  } catch (err) {
    console.error("[!!build] Hata:", err);
    await bekleMesaji.edit(
      `Maalesef ${championName} için verileri şu anda çekemedim (${err.message}). Birazdan tekrar dener misin?`
    );
  }

  return true;
}

module.exports = { buildKomutuIsleyici };