# Dokumentasi

Dokumentasi tingkat sistem untuk aplikasi web (`web/`). Cara menjalankan, fitur, rute, dan pengaturan ada di [`web/README.md`](../web/README.md); aturan kerja harian di [`CLAUDE.md`](../CLAUDE.md).

| Dokumen | Isinya | Diperbarui |
| --- | --- | --- |
| [architecture.md](architecture.md) | Gambaran sistem: konteks, container, modul server, alur satu analisa, kerja latar, deploy | Saat struktur berubah |
| [adr/](adr/) | Satu keputusan arsitektur per berkas: konteks, keputusan, konsekuensi | Setiap keputusan besar |
| [runbooks/deploy.md](runbooks/deploy.md) | Menyiapkan dan menjalankan deploy, rollback | Setelah prosedur berubah |
| [runbooks/restore.md](runbooks/restore.md) | Uji restore dan memulihkan database atau data | Setelah latihan atau pemulihan |
| [runbooks/incidents.md](runbooks/incidents.md) | Apa yang dilakukan untuk tiap peringatan server | Setelah tiap insiden |
| [api/openapi.json](api/openapi.json) | Referensi API, dibangkitkan dari route: jangan disunting tangan | `bun run openapi` di `web/server`; tes gagal kalau tertinggal |

ADR baru: salin bentuk ADR yang ada, beri nomor berikutnya, dan tulis statusnya (Diterima, Diganti oleh NNNN, Ditinggalkan). ADR yang sudah diterima tidak diubah isinya; keputusan baru yang menggantinya ditulis sebagai ADR baru.
