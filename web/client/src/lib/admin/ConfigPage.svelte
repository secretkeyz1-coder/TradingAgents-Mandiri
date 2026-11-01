<script lang="ts">
  // The server's set-up, read only (GET /api/admin/config): what is switched on
  // and what still needs configuring. Values live in web/deploy/.env and apply
  // after the container restarts, so each row names its variable for the admin.
  import { api, type AdminConfig } from '../api';

  let cfg = $state<AdminConfig | null>(null);
  let error = $state('');
  api
    .adminConfig()
    .then((c) => (cfg = c))
    .catch((e) => (error = (e as Error).message));

  type Row = { label: string; on: boolean; value: string; env: string };
  const groups = $derived.by((): { title: string; rows: Row[] }[] => {
    if (!cfg) return [];
    return [
      {
        title: 'Akses',
        rows: [
          { label: 'Pendaftaran mandiri', on: cfg.signup, value: cfg.signup ? 'Terbuka' : 'Tertutup; hanya admin yang membuat akun', env: 'SIGNUP' },
          { label: 'Landing di alamat utama', on: cfg.publicSite, value: cfg.publicSite ? 'Tampil' : 'Alamat utama langsung membuka aplikasi', env: 'PUBLIC_SITE' },
          { label: 'Alamat publik', on: !!cfg.publicUrl, value: cfg.publicUrl ?? 'Belum diatur; tautan di email dan Telegram tidak lengkap', env: 'PUBLIC_URL' },
          { label: 'Masuk dengan Google', on: cfg.google, value: cfg.google ? 'Aktif' : 'Belum diatur', env: 'GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET' },
        ],
      },
      {
        title: 'Notifikasi',
        rows: [
          { label: 'Bot Telegram', on: cfg.telegram, value: cfg.telegram ? 'Aktif' : 'Belum diatur; notifikasi Telegram tidak terkirim', env: 'TELEGRAM_BOT_TOKEN' },
          { label: 'Email', on: cfg.mail, value: cfg.mail ? 'Aktif' : 'Belum diatur; email hanya tercatat di log', env: 'SMTP_URL, MAIL_FROM' },
          { label: 'Pengingat perpanjangan', on: cfg.reminders, value: cfg.reminders ? 'Aktif' : 'Dimatikan', env: 'REMINDERS' },
        ],
      },
      {
        title: 'Pembayaran',
        rows: [
          {
            label: 'Instruksi pembayaran',
            on: cfg.payments,
            value: cfg.payments ? 'Terisi; anggota bisa memesan paket' : 'Kosong; pemesanan paket belum dibuka',
            env: 'PAYMENT_INSTRUCTIONS',
          },
        ],
      },
      {
        title: 'Model AI',
        rows: [
          {
            label: 'Model bawaan (dipakai semua anggota)',
            on: !!cfg.models,
            value: cfg.models ? `${cfg.models.provider}: ${cfg.models.quick} (cepat), ${cfg.models.deep} (dalam)` : 'Katalog model belum termuat',
            env: 'TRADINGAGENTS_LLM_PROVIDER, TRADINGAGENTS_QUICK_THINK_LLM, TRADINGAGENTS_DEEP_THINK_LLM',
          },
          {
            label: 'Tujuan key LLM',
            on: cfg.backendLimit > 0,
            value: cfg.backendLimit > 0 ? `Dibatasi ke ${cfg.backendLimit} alamat` : 'Tidak dibatasi; admin bisa mengirim key ke alamat mana pun',
            env: 'ALLOWED_BACKEND_URLS',
          },
          { label: 'Ringkasan pasar AI', on: cfg.siteBrief, value: cfg.siteBrief ? 'Aktif, ditulis tiap 6 jam' : 'Dimatikan', env: 'SITE_BRIEF' },
          { label: 'Harga token', on: cfg.tokenCost, value: cfg.tokenCost ? 'Terisi' : 'Kosong; Ringkasan tidak menghitung biaya model', env: 'LLM_COST_IDR_PER_MTOK' },
        ],
      },
      {
        title: 'Pemantauan',
        rows: [
          {
            label: 'Peringatan server di Telegram',
            on: cfg.telegram && (cfg.opsAlerts.chat || cfg.opsAlerts.admins > 0),
            value: !cfg.telegram
              ? 'Bot Telegram belum diatur'
              : cfg.opsAlerts.chat
                ? 'Dikirim ke grup atau channel yang diatur'
                : cfg.opsAlerts.admins > 0
                  ? `Dikirim ke ${cfg.opsAlerts.admins} admin yang mengisi chat ID Telegram`
                  : 'Belum ada tujuan; isi chat ID Telegram di profil admin',
            env: 'ALERT_CHAT_ID',
          },
          { label: 'Metrik Prometheus (/metrics)', on: cfg.metrics, value: cfg.metrics ? 'Aktif, dengan token' : 'Mati', env: 'METRICS_TOKEN' },
        ],
      },
    ];
  });
</script>

<section class="flex flex-col gap-5" aria-labelledby="config-title">
  <div>
    <h1 id="config-title" class="text-2xl font-semibold">Pengaturan server</h1>
    <p class="text-sm text-base-content/70">
      Hanya baca. Ubah nilainya di <code class="font-mono">web/deploy/.env</code> di server, lalu jalankan ulang container. Kunci dan kata sandi tidak pernah tampil di sini.
    </p>
  </div>
  {#if error}<p role="alert" class="text-sm text-error">{error}</p>{/if}
  {#if !cfg && !error}<p class="text-sm text-base-content/70">Memuat…</p>{/if}
  {#each groups as group (group.title)}
    <div class="flex flex-col gap-2">
      <h2 class="text-base font-semibold">{group.title}</h2>
      <ul class="divide-y divide-base-300 rounded-box border border-base-300 bg-base-100">
        {#each group.rows as row (row.label)}
          <li class="flex flex-wrap items-start gap-x-4 gap-y-1 p-4">
            <span class="status mt-1.5 {row.on ? 'status-success' : 'status-neutral'}" aria-hidden="true"></span>
            <div class="flex min-w-0 flex-1 flex-col gap-0.5">
              <span class="font-medium">{row.label}</span>
              <span class="text-sm break-words text-base-content/80">{row.value}</span>
            </div>
            <code class="font-mono text-xs break-all text-base-content/70">{row.env}</code>
          </li>
        {/each}
      </ul>
    </div>
  {/each}
</section>
