const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const priorityStack = [
  {
    rank: 1,
    label: 'Kritis',
    description: 'Eksekusi dekorasi dan pengiriman buket Hari-H atau besok.',
    rule_text: 'Gunakan untuk pekerjaan dengan deadline kurang dari 24 jam atau acara Hari-H.',
    color: '#dc2626',
  },
  {
    rank: 2,
    label: 'Penting dan mudah rusak',
    description: 'Belanja bunga segar dan conditioning bahan mudah layu.',
    rule_text: 'Gunakan untuk belanja bahan, perawatan bunga, dan pekerjaan yang rusak bila ditunda.',
    color: '#ea580c',
  },
  {
    rank: 3,
    label: 'Cashflow',
    description: 'Penagihan DP dan pelunasan invoice klien.',
    rule_text: 'Gunakan untuk penagihan, konfirmasi pembayaran, dan follow-up pelunasan.',
    color: '#ca8a04',
  },
  {
    rank: 4,
    label: 'Rutin',
    description: 'Operasional gudang, rekap admin, dan balas chat inquiry baru.',
    rule_text: 'Gunakan untuk pekerjaan rutin yang tidak memiliki tenggat mendesak.',
    color: '#2563eb',
  },
];

async function main() {
  await prisma.botSettings.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      brand_name: 'Toko Bunga Contoh',
      business_type: 'Florist',
      owner_name: 'Owner',
      timezone: 'Asia/Jakarta',
      work_hours_start: '08:00',
      work_hours_end: '17:00',
      early_brief_time: '06:00',
      working_days: [1, 2, 3, 4, 5, 6],
      behavior_mode: 'STRICT',
      prompt_mode: 'STACK',
      enable_orders: true,
      setup_completed: false,
    },
  });

  for (const level of priorityStack) {
    await prisma.priorityLevel.upsert({
      where: { rank: level.rank },
      update: {
        label: level.label,
        description: level.description,
        rule_text: level.rule_text,
        color: level.color,
      },
      create: level,
    });
  }

  console.log('seed selesai: bot_settings + 4 priority_levels');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
