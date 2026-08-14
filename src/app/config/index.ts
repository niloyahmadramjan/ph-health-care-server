import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(process.cwd(), ".env") });

export default {
  node_env: process.env.NODE_ENV,
  port: process.env.PORT,
  database_url: process.env.DATABASE_URL,
  bak_url: process.env.APP_URL,
  frontend_url: process.env.FRONTEND_URL,
  bcrypt_salt_rounds: process.env.BCRYPT_SALT_ROUNDS,
  jwt_access_secret: process.env.JWT_ACCESS_SECRET!,
  jwt_refresh_secret: process.env.JWT_REFRESH_SECRET!,
  jwt_access_expires_in: process.env.JWT_ACCESS_EXPIRES_IN!,
  jwt_refresh_expires_in: process.env.JWT_REFRESH_EXPIRES_IN!,
  google_client_id: process.env.GOOGLE_CLIENT_ID!,

  super_admin_email: process.env.SUPER_ADMIN_EMAIL!,
  super_admin_pass: process.env.SUPER_ADMIN_PASS!,

  admin_email: process.env.ADMIN_EMAIL!,
  admin_pass: process.env.ADMIN_PASS!,

  patian_email: process.env.PATIANT_EMAIL!,
  patian_pass: process.env.PATIANT_PASS!,

  doctor_email: process.env.DOCTOR_EMAIL!,
  doctor_pass: process.env.DOCTOR_PASS!,

  // REDIS CONFIG
  redis_user_name: process.env.REDIS_USER_NAME!,
  redis_pass: process.env.REDIS_PASS!,
  redis_host: process.env.REDIS_HOST!,
  redis_port: process.env.REDIS_PORT!,
};
