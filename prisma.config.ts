import "dotenv/config";

import { definePrismaConfig } from "prisma/config";
import { defineConfig as definePostgresConfig } from "@prisma/orm-postgres/config";

declare const process: {
  env: { [key: string]: string | undefined };
};

export default definePrismaConfig({
  orm: definePostgresConfig({
    contract: "prisma/schema.prisma",
    output: "generated/prisma",
    migrations: {
      dir: "prisma/migrations",
    },
    db: {
      connection: process.env.DATABASE_URL,
    },
  }),
});
