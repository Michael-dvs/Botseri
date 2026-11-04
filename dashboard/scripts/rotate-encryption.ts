import { PrismaClient } from '@prisma/client';
import { rotateSecret } from '../src/lib/crypto';

const prisma = new PrismaClient();

async function main() {
  if (!process.env.ENCRYPTION_KEY_PREVIOUS) {
    throw new Error('ENCRYPTION_KEY_PREVIOUS wajib diisi selama rotasi');
  }

  const configs = await prisma.llmConfig.findMany();
  for (const config of configs) {
    await prisma.llmConfig.update({
      where: { id: config.id },
      data: { api_key_enc: rotateSecret(config.api_key_enc, 'llm_configs.api_key_enc') },
    });
  }

  const tokens = await prisma.oAuthToken.findMany();
  for (const token of tokens) {
    await prisma.oAuthToken.update({
      where: { id: token.id },
      data: {
        client_secret_enc: token.client_secret_enc
          ? rotateSecret(token.client_secret_enc, 'oauth_tokens.client_secret_enc')
          : null,
        access_token_enc: token.access_token_enc
          ? rotateSecret(token.access_token_enc, 'oauth_tokens.access_token_enc')
          : null,
        refresh_token_enc: token.refresh_token_enc
          ? rotateSecret(token.refresh_token_enc, 'oauth_tokens.refresh_token_enc')
          : null,
      },
    });
  }

  console.log(`rotasi selesai: ${configs.length} llm_configs, ${tokens.length} oauth_tokens`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
