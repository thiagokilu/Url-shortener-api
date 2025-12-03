import express from "express";
import cors from "cors";
import { nanoid } from "nanoid";
import { z } from "zod";
import path from "path";
import qrcode from "qrcode";
const port = process.env.PORT || 3333;
const app = express();
import { pool } from "./db.js";

const urlSchema = z.object({
  url: z.string().url(),
  device: z.string().optional(),
  country: z.string().optional(),
});

await pool.query(`
  CREATE TABLE IF NOT EXISTS urls (
    id SERIAL PRIMARY KEY,
    original TEXT NOT NULL,
    short TEXT NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    hits INT NOT NULL DEFAULT 0,
    user_agent TEXT,
    user_region TEXT
  );
`);
await pool.query(`
  CREATE INDEX IF NOT EXISTS idx_urls_short ON urls(short);
`);

await pool.query(`
  CREATE TABLE IF NOT EXISTS visits (
    id SERIAL PRIMARY KEY,
    short TEXT NOT NULL,
    device TEXT,
    country TEXT,
    created_at TIMESTAMP DEFAULT NOW()
  );
`);

// app.use(
//   cors({
//     origin: function (origin, callback) {
//       const allowed = "https://url-shortener-ivory-eight.vercel.app";

//       if (!origin || origin === allowed) {
//         callback(null, true); // permite
//       } else {
//         callback(new Error("Cors bloqueado! Origem não permitida: " + origin));
//       }
//     },
//   })
// );

app.use(cors());
app.use(express.json());

function getDeviceFromUserAgent(ua = "") {
  ua = ua.toLowerCase();

  if (ua.includes("windows")) return "Windows";
  if (ua.includes("linux") && !ua.includes("android")) return "Linux";
  if (ua.includes("android")) return "Android";
  if (ua.includes("iphone") || ua.includes("ipad") || ua.includes("ios"))
    return "iOS";
  if (ua.includes("mac")) return "MacOS";

  return "Unknown";
}

async function getCountry(ip: any) {
  try {
    const url = ip ? `https://ipwho.is/${ip}` : "https://ipwho.is/";
    const response = await fetch(url);
    const data = await response.json();
    return data.country || "Unknown";
  } catch (err) {
    return "Unknown";
  }
}

// Criar link encurtado
app.post("/encurtar", async (req, res) => {
  try {
    const urlSchemaResult = urlSchema.safeParse(req.body);

    if (!urlSchemaResult.success) {
      return res.status(400).json({ error: urlSchemaResult.error });
    }

    const { url, device, country } = urlSchemaResult.data;

    const id = nanoid(8);

    const expires_at = new Date(Date.now() + 60 * 1000); // 60 segundos

    await pool.query(
      `INSERT INTO urls (original, short, expires_at, user_agent, user_region)
   VALUES ($1, $2, $3, $4, $5)`,
      [url, id, expires_at, device || "Unknown", country || "Unknown"]
    );

    const baseUrl = "https://url-shortener-7jk6.onrender.com";

    const shortUrl = `${baseUrl}/${id}`;
    const qr = await qrcode.toDataURL(shortUrl);

    res.json({ shortUrl, qr });
  } catch (error) {
    console.error("Erro ao criar link encurtado:", error);
    res.status(500).json({ error: "Erro ao criar link encurtado" });
  }
});

// Rota de redirecionamento
// Rota de redirecionamento
app.get("/:id", async (req, res) => {
  try {
    const id = req.params.id;

    if (!/^[a-zA-Z0-9_-]{8}$/.test(id)) {
      return res.status(400).json({ error: "ID inválido" });
    }

    const result = await pool.query(
      `SELECT original, expires_at FROM urls WHERE short = $1`,
      [id]
    );

    if (result.rowCount === 0) {
      return res
        .status(410)
        .sendFile(path.join(process.cwd(), "public", "index.html"));
    }

    const expires_at = result.rows[0].expires_at;

    if (expires_at < new Date()) {
      await pool.query(`DELETE FROM urls WHERE short = $1`, [id]);
      return res
        .status(410)
        .sendFile(path.join(process.cwd(), "public", "index.html"));
    }

    const original = result.rows[0].original;

    // Detecta device
    const rawUA = req.headers["user-agent"] || "Unknown";
    const device = getDeviceFromUserAgent(rawUA);

    // Detecta IP real
    const forwarded = req.headers["x-forwarded-for"];

    const ip =
      (typeof forwarded === "string" ? forwarded.split(",")[0] : undefined) ||
      (Array.isArray(forwarded) ? forwarded[0] : undefined) ||
      req.socket.remoteAddress ||
      "";
    // ...
    const publicApiIp = "74.220.48.0/24";
    const country =
      ip === "::1" || ip === "127.0.0.1"
        ? await getCountry(publicApiIp) // IP público da API
        : await getCountry(ip); // IP real do visitante

    // Salva visita
    await pool.query(
      `INSERT INTO visits (short, device, country) VALUES ($1, $2, $3)`,
      [id, device, country]
    );

    // Atualiza hits
    const updateResult = await pool.query(
      `UPDATE urls SET hits = hits + 1 WHERE short = $1 RETURNING hits`,
      [id]
    );

    console.log("DEVICE:", device);
    console.log("COUNTRY:", country);
    console.log("IP DETECTADO:", ip);
    console.log("HITS:", updateResult.rows[0].hits);

    res.redirect(original);
  } catch (err) {
    console.error("Erro ao redirecionar:", err);
    res.status(500).send("Erro ao redirecionar");
  }
});

app.get("/stats/:id", async (req, res) => {
  try {
    const id = req.params.id;

    // ✅ Adiciona validação
    if (!/^[a-zA-Z0-9_-]{8}$/.test(id)) {
      return res.status(400).json({ error: "ID inválido" });
    }

    const result = await pool.query(
      `SELECT original, short, hits, expires_at, user_agent, user_region FROM urls WHERE short = $1`,
      [id]
    );

    const devices = await pool.query(
      `SELECT device, COUNT(*) AS total FROM visits WHERE short = $1 GROUP BY device`,
      [id]
    );

    const countries = await pool.query(
      `SELECT country, COUNT(*) AS total FROM visits WHERE short = $1 GROUP BY country`,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Link não encontrado" });
    }
    const short = result.rows[0].short;
    const qr = await qrcode.toDataURL(short);

    res.json({
      qr,
      stats: result.rows[0],
      devices: devices.rows, // <-- AQUI
      countries: countries.rows, // <-- AQUI
    });
  } catch (err) {
    console.error("Erro ao buscar stats:", err);
    res.status(500).json({ error: "Erro ao buscar estatísticas" });
  }
});

async function test() {
  try {
    const result = await pool.query("SELECT NOW()");
    console.log("Conectado! Hora atual:", result.rows[0]);
  } catch (err) {
    console.error("Erro ao conectar:", err);
  }
}

test();

app.listen(port, () => {
  console.log("Servidor rodando na porta", port);
});
