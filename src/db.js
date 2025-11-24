import pg from "pg";

const { Pool } = pg;

export const pool = new Pool({
  host: "localhost",
  port: 5433, // sua porta do Docker
  user: "usuario",
  password: "senha123",
  database: "meubanco",
});

pool.on("error", (err) => {
  console.error("Erro na conexão: ", err.message);
});

pool
  .connect()
  .then(() => {
    console.log("Conexão estabelecida com o PostgreSQL");
  })
  .catch((err) => {
    console.error("Erro na conexão: ", err.message);
  });
