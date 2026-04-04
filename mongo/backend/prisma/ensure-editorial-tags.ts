import "./load-env.js";
import { PrismaClient } from "@prisma/client";
import { EXTRA_EDITORIAL_TAGS } from "./extra-tags.js";

const prisma = new PrismaClient();

async function main() {
  for (const t of EXTRA_EDITORIAL_TAGS) {
    await prisma.tag.upsert({
      where: { slug: t.slug },
      update: { name: t.name },
      create: { name: t.name, slug: t.slug },
    });
  }
  console.log(`Etiquetas listas: ${EXTRA_EDITORIAL_TAGS.map((x) => x.slug).join(", ")}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
