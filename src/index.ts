import express from "express";
import cors from "cors";
import { nanoid } from "nanoid";
import { z } from "zod";
import path from "path";
const port = process.env.PORT || 3333;
const app = express();
import { pool } from "./db.js";

const urlSchema = z.object({
  url: z.string().url(),
});

await pool.query(`
  CREATE TABLE IF NOT EXISTS urls (
    id SERIAL PRIMARY KEY,
    original TEXT NOT NULL,
    short TEXT NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    hits INT NOT NULL DEFAULT 0
  );
`);
await pool.query(`
  CREATE INDEX IF NOT EXISTS idx_urls_short ON urls(short);
`);
app.use(
  cors({
    origin: function (origin, callback) {
      const allowed = "https://url-shortener-ivory-eight.vercel.app/";

      if (!origin || origin === allowed) {
        callback(null, true); // permite
      } else {
        callback(new Error("Cors bloqueado! Origem não permitida: " + origin));
      }
    },
  })
);
app.use(express.json());

// Criar link encurtado
app.post("/encurtar", async (req, res) => {
  try {
    const urlSchemaResult = urlSchema.safeParse(req.body);

    if (!urlSchemaResult.success) {
      return res.status(400).json({ error: urlSchemaResult.error });
    }

    const { url } = urlSchemaResult.data;

    const id = nanoid(8);

    const expires_at = new Date(Date.now() + 60 * 1000); // 60 segundos

    await pool.query(
      `INSERT INTO urls (original, short, expires_at) VALUES ($1, $2, $3)`,
      [url, id, expires_at]
    );

    const shortUrl = `https://url-shortener-7jk6.onrender.com/${id}`;

    res.json({ shortUrl });
  } catch (error) {
    console.error("Erro ao criar link encurtado:", error);
    res.status(500).json({ error: "Erro ao criar link encurtado" });
  }
});

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

    // Incrementa hits e retorna valor atualizado em uma query
    const updateResult = await pool.query(
      `UPDATE urls SET hits = hits + 1 WHERE short = $1 RETURNING hits`,
      [id]
    );

    console.log("hits atualizados:", updateResult.rows[0].hits);
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
      `SELECT original, hits, expires_at FROM urls WHERE short = $1`,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Link não encontrado" });
    }

    res.json(result.rows[0]);
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
