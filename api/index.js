const admin = require('firebase-admin');
const axios = require('axios');

// 1. Koneksi Database
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    })
  });
}
const db = admin.firestore();

// 2. Fungsi Pembantu
const parseNominal = (str) => {
  if (!str) return 0;
  let numStr = str.toLowerCase().replace(/jt/g, '000000').replace(/k/g, '000');
  return Number(numStr.replace(/[^0-9]/g, '')) || 0;
};

const formatRp = (angka) => {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(angka);
};

const formatTanggal = (timestamp) => {
  if (!timestamp) return 'Hari ini';
  const date = timestamp.toDate();
  return date.toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: '2-digit' });
};

// 3. FUNGSI UTAMA BOT
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(200).send('Server Bot Aktif');

  const update = req.body;
  const token = process.env.TELEGRAM_TOKEN;
  const apiUrl = `https://api.telegram.org/bot${token}`;

  const sendMessage = async (chatId, text, replyMarkup = null) => {
    const payload = { chat_id: chatId, text: text, parse_mode: 'HTML' };
    if (replyMarkup) payload.reply_markup = replyMarkup;
    await axios.post(`${apiUrl}/sendMessage`, payload);
  };

  const editMessage = async (chatId, messageId, text, replyMarkup = null) => {
    const payload = { chat_id: chatId, message_id: messageId, text: text, parse_mode: 'HTML' };
    if (replyMarkup) payload.reply_markup = replyMarkup;
    try {
      await axios.post(`${apiUrl}/editMessageText`, payload);
    } catch (e) {}
  };

  const keyboardBawah = {
    keyboard: [
      [{ text: '📥 Dana Masuk' }, { text: '📤 Pengeluaran' }],
      [{ text: '📝 Kasbon' }, { text: '🔄 Mutasi' }],
      [{ text: '💰 Cek Saldo Total' }, { text: '📋 Cek Riwayat' }]
    ],
    resize_keyboard: true,
    is_persistent: true
  };

  try {
    // ==========================================
    // A. LOGIKA TOMBOL INLINE (Hapus & Paginasi)
    // ==========================================
    if (update.callback_query) {
      const callback = update.callback_query;
      const chatId = callback.message.chat.id;
      const messageId = callback.message.message_id;
      const data = callback.data;

      await axios.post(`${apiUrl}/answerCallbackQuery`, { callback_query_id: callback.id });

      if (data === 'konfirmasi_reset') {
        await editMessage(chatId, messageId, '⚠️ <b>PERINGATAN BAHAYA</b> ⚠️\nApakah Anda YAKIN ingin menghapus <b>SELURUH CATATAN</b>?', {
          inline_keyboard: [[{ text: '✅ YA, HAPUS SEMUA DATA', callback_data: 'eksekusi_reset' }], [{ text: '❌ BATALKAN', callback_data: 'batal_reset' }]]
        });
      }
      else if (data === 'eksekusi_reset') {
        const snapshot = await db.collection('transaksi').get();
        const batch = db.batch();
        snapshot.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
        await editMessage(chatId, messageId, '✅ <b>DATABASE BERHASIL DIRESET</b>\nSeluruh catatan telah dihapus. Saldo kembali Rp0.');
      }
      else if (data === 'batal_reset') {
        await editMessage(chatId, messageId, '✅ Proses reset dibatalkan. Data Anda aman.');
      }
      
      // LOGIKA TOMBOL HAPUS DATA
      else if (data.startsWith('del_')) {
        const docId = data.split('_')[1];
        await db.collection('transaksi').doc(docId).delete();
        await editMessage(chatId, messageId, '✅ <b>Satu Transaksi berhasil dihapus!</b>\nJika ingin melihat perubahan, silakan buka ulang menu Riwayat.');
      }
      
      // LOGIKA HALAMAN RIWAYAT
      else if (data.startsWith('page_')) {
        const parts = data.split('_');
        const kategori = parts[1];
        const pageIndex = parseInt(parts[2]);

        const snapshot = await db.collection('transaksi').orderBy('waktu', 'desc').get();
        let items = [];
        snapshot.forEach(doc => {
          const trx = doc.data();
          if (trx.jenis === kategori) items.push({ id: doc.id, ...trx }); // Simpan ID untuk fungsi Hapus
        });

        const perPage = 10;
        const totalItems = items.length;
        const totalPages = Math.ceil(totalItems / perPage) || 1;
        const currentItems = items.slice(pageIndex * perPage, (pageIndex + 1) * perPage);

        let teksRiwayat = `<b>📋 RIWAYAT ${kategori.toUpperCase()} (Hal ${pageIndex + 1}/${totalPages})</b>\n\n`;
        let keyboardHapus = [];

        if (currentItems.length === 0) {
          teksRiwayat += "<i>Belum ada catatan di kategori ini.</i>";
        } else {
          currentItems.forEach((trx, idx) => {
            const nomor = pageIndex * perPage + idx + 1;
            const tgl = formatTanggal(trx.waktu);
            let ket = trx.keterangan || trx.nama_peminjam || `${trx.dari_rekening} -> ${trx.ke_rekening}`;
            let status = trx.status === 'lunas' ? ' <i>(Lunas)</i>' : '';
            let rek = trx.rekening ? trx.rekening.toUpperCase() : '';
            
            teksRiwayat += `${nomor}. [${tgl}] <b>${rek}</b>: ${formatRp(trx.nominal)}${status}\n   └ <i>Ket: ${ket}</i>\n\n`;

            // Susun 2 tombol hapus per baris agar rapi
            let btn = { text: `🗑 Hps ${nomor}`, callback_data: `del_${trx.id}` };
            if (keyboardHapus.length === 0 || keyboardHapus[keyboardHapus.length - 1].length === 2) {
              keyboardHapus.push([btn]);
            } else {
              keyboardHapus[keyboardHapus.length - 1].push(btn);
            }
          });
        }

        let navButtons = [];
        if (pageIndex > 0) navButtons.push({ text: '⬅️ Prev', callback_data: `page_${kategori}_${pageIndex - 1}` });
        if (pageIndex < totalPages - 1) navButtons.push({ text: 'Next ➡️', callback_data: `page_${kategori}_${pageIndex + 1}` });
        if (navButtons.length > 0) keyboardHapus.push(navButtons);

        await editMessage(chatId, messageId, teksRiwayat, { inline_keyboard: keyboardHapus });
      }

      return res.status(200).send('OK');
    }

    // ==========================================
    // B. LOGIKA KETIKAN & MENU BAWAH
    // ==========================================
    if (update.message && update.message.text) {
      const chatId = update.message.chat.id;
      const rawText = update.message.text.trim();
      const text = rawText.toLowerCase();

      if (text === '/start' || text === '/menu') {
        await sendMessage(chatId, '<b>MENU KASIR AKTIF</b>', keyboardBawah);
        return res.status(200).send('OK');
      }

      if (rawText === '📥 Dana Masuk') {
        await sendMessage(chatId, '<b>PANDUAN DANA MASUK</b>\nKetik: <code>+[bank] [ket] [nominal]</code>');
        return res.status(200).send('OK');
      }
      else if (rawText === '📤 Pengeluaran') {
        await sendMessage(chatId, '<b>PANDUAN PENGELUARAN</b>\nKetik: <code>-[bank] [ket] [nominal]</code>');
        return res.status(200).send('OK');
      }
      else if (rawText === '📝 Kasbon') {
        await sendMessage(chatId, '<b>PANDUAN KASBON</b>\nCatat Bon: <code>bon [bank] [nama] [nominal]</code>\n\nCek Semua Bon: <code>cekbon</code>\nCek Bon Khusus: <code>cekbon alpin</code>\nReset/Lunas Potong Gaji: <code>lunas alpin</code>');
        return res.status(200).send('OK');
      }
      else if (rawText === '🔄 Mutasi') {
        await sendMessage(chatId, '<b>PANDUAN MUTASI</b>\nKetik: <code>tf [dari] ke [tujuan] [nominal]</code>');
        return res.status(200).send('OK');
      }
      else if (rawText === '📋 Cek Riwayat') {
        await sendMessage(chatId, 'Pilih kategori riwayat yang ingin Anda cek:', {
          inline_keyboard: [
            [{ text: '📥 Dana Masuk', callback_data: 'page_masuk_0' }, { text: '📝 Kasbon', callback_data: 'page_kasbon_0' }],
            [{ text: '📤 Pengeluaran', callback_data: 'page_keluar_0' }, { text: '🔄 Mutasi', callback_data: 'page_mutasi_0' }]
          ]
        });
        return res.status(200).send('OK');
      }
      else if (rawText === '💰 Cek Saldo Total') {
        const snapshot = await db.collection('transaksi').get();
        let saldoBrimo = 0, saldoSea = 0, totalKasbon = 0;
        
        snapshot.forEach(doc => {
          const trx = doc.data();
          const nom = trx.nominal || 0;
          
          if (trx.jenis === 'masuk') {
            if (trx.rekening === 'b') saldoBrimo += nom;
            if (trx.rekening === 's') saldoSea += nom;
          } else if (trx.jenis === 'keluar' || trx.jenis === 'kasbon') {
            if (trx.rekening === 'b') saldoBrimo -= nom;
            if (trx.rekening === 's') saldoSea -= nom;
            
            // FIX: Menghitung kasbon lama (yg statusnya undefined) dan yg 'aktif'
            if (trx.jenis === 'kasbon' && trx.status !== 'lunas') totalKasbon += nom;
          } else if (trx.jenis === 'mutasi') {
            if (trx.dari_rekening === 'b') saldoBrimo -= nom;
            if (trx.dari_rekening === 's') saldoSea -= nom;
            if (trx.ke_rekening === 'b') saldoBrimo += nom;
            if (trx.ke_rekening === 's') saldoSea += nom;
          }
        });

        const teksSaldo = `<b>💰 LAPORAN KEUANGAN KASIR</b>\n\n💳 <b>Sisa Saldo Brimo:</b> ${formatRp(saldoBrimo)}\n💳 <b>Sisa Saldo SeaBank:</b> ${formatRp(saldoSea)}\n\n📝 <b>Total Kasbon Beredar:</b> ${formatRp(totalKasbon)}`;
        await sendMessage(chatId, teksSaldo, { inline_keyboard: [[{ text: '⚠ Reset Semua Saldo & Catatan', callback_data: 'konfirmasi_reset' }]] });
        return res.status(200).send('OK');
      }

      const args = rawText.split(' ');
      const command = args[0].toLowerCase();
      const nominal = parseNominal(args[args.length - 1]);

      let dataTransaksi = {
        waktu: admin.firestore.FieldValue.serverTimestamp(),
        nominal: nominal
      };

      if (command.startsWith('+') || command.startsWith('-')) {
        const tipe = command.charAt(0) === '+' ? 'masuk' : 'keluar';
        const bank = command.substring(1);
        const keterangan = args.slice(1, -1).join(' ');

        dataTransaksi = { ...dataTransaksi, jenis: tipe, rekening: bank, keterangan: keterangan };
        await db.collection('transaksi').add(dataTransaksi);
        
        let simbol = tipe === 'masuk' ? '✅' : '🔴';
        await sendMessage(chatId, `${simbol} <b>Tercatat!</b>\n${tipe.toUpperCase()} ${bank.toUpperCase()}: ${formatRp(nominal)}\nKet: ${keterangan}`, keyboardBawah);
      } 
      else if (command === 'bon') {
        const bank = args[1].toLowerCase();
        const nama = args.slice(2, -1).join(' ').toLowerCase(); 
        
        dataTransaksi = { ...dataTransaksi, jenis: 'kasbon', rekening: bank, nama_peminjam: nama, status: 'aktif' };
        await db.collection('transaksi').add(dataTransaksi);
        
        await sendMessage(chatId, `📝 <b>KASBON TERCATAT!</b>\nNama: ${nama}\nDari: ${bank.toUpperCase()}\nNominal: ${formatRp(nominal)}`, keyboardBawah);
      } 
      else if (command === 'lunas') {
        const namaTarget = args.slice(1).join(' ').toLowerCase();
        // FIX: Mengambil semua kasbon dengan nama terkait (baik lama maupun baru)
        const snapshot = await db.collection('transaksi').where('jenis', '==', 'kasbon').where('nama_peminjam', '==', namaTarget).get();
        
        let totalDilunasi = 0;
        const batch = db.batch();
        
        snapshot.docs.forEach(doc => {
          const trx = doc.data();
          if (trx.status !== 'lunas') {
            totalDilunasi += trx.nominal;
            batch.update(doc.ref, { status: 'lunas' });
          }
        });

        if (totalDilunasi === 0) {
          await sendMessage(chatId, `⚠️ Tidak ada catatan kasbon aktif untuk <b>${namaTarget}</b>.`);
          return res.status(200).send('OK');
        }

        await batch.commit();
        await sendMessage(chatId, `✅ <b>KASBON SELESAI (POTONG GAJI)</b>\nSeluruh kasbon <b>${namaTarget}</b> senilai total ${formatRp(totalDilunasi)} telah dilunaskan.`, keyboardBawah);
      }
      else if (command === 'cekbon') {
        const namaTarget = args.slice(1).join(' ').toLowerCase();
        // FIX: Mengambil semua data kasbon tanpa memfilter status 'aktif' dari database
        let query = db.collection('transaksi').where('jenis', '==', 'kasbon');
        if (namaTarget) query = query.where('nama_peminjam', '==', namaTarget);
        
        const snapshot = await query.get();
        
        let totalSeluruh = 0;
        let rekapNama = {};
        let teksBalasan = namaTarget ? `<b>📋 RINCIAN KASBON: ${namaTarget.toUpperCase()}</b>\n\n` : `<b>📋 REKAP SELURUH KASBON AKTIF</b>\n\n`;

        snapshot.forEach(doc => {
          const trx = doc.data();
          // Filter data yang lunas dilewati di sini agar data lama tetap terbaca
          if (trx.status === 'lunas') return; 

          const n = trx.nama_peminjam;
          const nom = trx.nominal;
          totalSeluruh += nom;
          
          if (!rekapNama[n]) rekapNama[n] = 0;
          rekapNama[n] += nom;

          if (namaTarget) {
            teksBalasan += `- [${formatTanggal(trx.waktu)}] : ${formatRp(nom)}\n`;
          }
        });

        if (totalSeluruh === 0) {
          await sendMessage(chatId, namaTarget ? `Tidak ada kasbon aktif untuk ${namaTarget}.` : `Semua kasbon karyawan sudah lunas/kosong.`);
          return res.status(200).send('OK');
        }

        if (!namaTarget) {
          for (const [p, nom] of Object.entries(rekapNama)) {
            teksBalasan += `👤 <b>${p.toUpperCase()}</b>: ${formatRp(nom)}\n`;
          }
        }

        teksBalasan += `\n💰 <b>Total Terhutang:</b> ${formatRp(totalSeluruh)}`;
        await sendMessage(chatId, teksBalasan);
      }
      else if (command === 'tf') {
        const dari = args[1].toLowerCase();
        const ke = args[3].toLowerCase();
        
        dataTransaksi = { ...dataTransaksi, jenis: 'mutasi', dari_rekening: dari, ke_rekening: ke };
        await db.collection('transaksi').add(dataTransaksi);
        
        await sendMessage(chatId, `🔄 <b>MUTASI TERCATAT!</b>\n${formatRp(nominal)} dipindah dari ${dari.toUpperCase()} ke ${ke.toUpperCase()}.`, keyboardBawah);
      }
    }
  } catch (error) {
    console.error(error);
  }

  return res.status(200).send('OK');
};