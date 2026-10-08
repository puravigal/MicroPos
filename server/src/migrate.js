import "dotenv/config";
import fs from "node:fs/promises";
import pg from "pg";
const {Pool}=pg;
if(!process.env.DATABASE_URL){console.error("DATABASE_URL is required");process.exit(1)}
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==="true"?{rejectUnauthorized:false}:undefined});
try{const sql=await fs.readFile(new URL("../../database/schema.sql",import.meta.url),"utf8");await pool.query(sql);console.log("Puravigal POS database schema applied.")}finally{await pool.end();}
