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

// 3. FUNGSI UTAMA BOT
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(200).send('Server Bot Aktif');

  const update = req.body;
  const token = process.env.TELEGRAM_TOKEN;
  const apiUrl = `https://api.telegram.org/bot${token}`;

  // Helper Pengirim Pesan
  const sendMessage = async (chatId, text, replyMarkup = null) => {
    const payload = { chat_id: chatId, text: text, parse_mode: 'HTML' };
    if (replyMarkup) payload.reply_markup = replyMarkup;
    await axios.post(`${apiUrl}/sendMessage`, payload);
  };

  const editMessage = async (chatId, messageId, text, replyMarkup = null) => {
    const payload = { chat_id: chatId, message_id: messageId, text: text, parse_mode: 'HTML' };
    if (replyMarkup) payload.reply_markup = replyMarkup;
    await axios.post(`${apiUrl}/editMessageText`, payload);
  };

  // Struktur Menu Permanen (Nempel di bawah dekat keyboard HP)
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
    // A. LOGIKA TOMBOL INLINE (Sub-menu & Konfirmasi)
    // ==========================================
    if (update.callback_query) {
      const callback = update.callback_query;
      const chatId = callback.message.chat.id;
      const messageId = callback.message.message_id;
      const data = callback.data;

      await axios.post(`${apiUrl}/answerCallbackQuery`, { callback_query_id: callback.id });

      // Logika Konfirmasi Reset Saldo
      if (data === 'konfirmasi_reset') {
        await editMessage(chatId, messageId, '⚠️ <b>PERINGATAN BAHAYA</b> ⚠️\n\nApakah Anda YAKIN ingin menghapus <b>SEMBARANG SELURUH CATATAN</b> dan me-reset saldo menjadi Rp0? Data yang dihapus tidak bisa dikembalikan.', {
          inline_keyboard: [
            [{ text: '✅ YA, HAPUS SEMUA DATA', callback_data: 'eksekusi_reset' }],
            [{ text: '❌ BATALKAN', callback_data: 'batal_reset' }]
          ]
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

      // Logika Kategori Riwayat
      else if (data.startsWith('riwayat_')) {
        const kategori = data.split('_')[1]; // masuk, keluar, kasbon, mutasi
        
        // Mengambil data dan memfilter di server agar aman dari limit index Firebase
        const snapshot = await db.collection('transaksi').orderBy('waktu', 'desc').get();
        let teksRiwayat = `<b>📋 10 RIWAYAT ${kategori.toUpperCase()} TERAKHIR</b>\n\n`;
        let count = 1;

        snapshot.forEach(doc => {
          const trx = doc.data();
          if (trx.jenis === kategori && count <= 10) {
            let ket = trx.keterangan || trx.nama_peminjam || `${trx.dari_rekening} -> ${trx.ke_rekening}`;
            let rek = trx.rekening ? trx.rekening.toUpperCase() : '';
            teksRiwayat += `${count}. <b>${rek}</b>: ${formatRp(trx.nominal)}\n   └ <i>Ket: ${ket}</i>\n\n`;
            count++;
          }
        });

        if (count === 1) teksRiwayat += "<i>Belum ada catatan di kategori ini.</i>";
        await editMessage(chatId, messageId, teksRiwayat);
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

      // Trigger memunculkan keyboard bawah
      if (text === '/start' || text === '/menu') {
        await sendMessage(chatId, '<b>MENU KASIR AKTIF</b>\n\nSilakan gunakan tombol di bawah (dekat kolom ketik) untuk navigasi, atau langsung ketik catatan Anda.', keyboardBawah);
        return res.status(200).send('OK');
      }

      // Reaksi Saat Tombol Bawah Ditekan
      if (rawText === '📥 Dana Masuk') {
        await sendMessage(chatId, '<b>PANDUAN DANA MASUK</b>\nKetik: <code>+[bank] [keterangan] [nominal]</code>\n\nContoh Brimo: <code>+b bos 5jt</code>\nContoh SeaBank: <code>+s jualan 500k</code>');
        return res.status(200).send('OK');
      }
      else if (rawText === '📤 Pengeluaran') {
        await sendMessage(chatId, '<b>PANDUAN PENGELUARAN</b>\nKetik: <code>-[bank] [keterangan] [nominal]</code>\n\nContoh: <code>-s spidol 20k</code>');
        return res.status(200).send('OK');
      }
      else if (rawText === '📝 Kasbon') {
        await sendMessage(chatId, '<b>PANDUAN CATAT KASBON</b>\nKetik: <code>bon [bank] [nama] [nominal]</code>\n\nContoh: <code>bon b alpin 300k</code>');
        return res.status(200).send('OK');
      }
      else if (rawText === '🔄 Mutasi') {
        await sendMessage(chatId, '<b>PANDUAN MUTASI / TRANSFER</b>\nKetik: <code>tf [dari] ke [tujuan] [nominal]</code>\n\nContoh: <code>tf b ke s 1jt</code>');
        return res.status(200).send('OK');
      }
      else if (rawText === '📋 Cek Riwayat') {
        await sendMessage(chatId, 'Pilih kategori riwayat yang ingin Anda cek:', {
          inline_keyboard: [
            [{ text: '📥 Dana Masuk', callback_data: 'riwayat_masuk' }, { text: '📝 Kasbon', callback_data: 'riwayat_kasbon' }],
            [{ text: '📤 Pengeluaran', callback_data: 'riwayat_keluar' }, { text: '🔄 Mutasi', callback_data: 'riwayat_mutasi' }]
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
            if (trx.jenis === 'kasbon') totalKasbon += nom;
          } else if (trx.jenis === 'mutasi') {
            if (trx.dari_rekening === 'b') saldoBrimo -= nom;
            if (trx.dari_rekening === 's') saldoSea -= nom;
            if (trx.ke_rekening === 'b') saldoBrimo += nom;
            if (trx.ke_rekening === 's') saldoSea += nom;
          }
        });

        const teksSaldo = `<b>💰 LAPORAN KEUANGAN KASIR</b>\n\n💳 <b>Sisa Saldo Brimo:</b> ${formatRp(saldoBrimo)}\n💳 <b>Sisa Saldo SeaBank:</b> ${formatRp(saldoSea)}\n\n📝 <b>Total Kasbon Beredar:</b> ${formatRp(totalKasbon)}`;
        
        // Tambahkan tombol Reset di bawah rincian Saldo
        await sendMessage(chatId, teksSaldo, { 
          inline_keyboard: [[{ text: '⚠️️ Reset Semua Saldo & Catatan', callback_data: 'konfirmasi_reset' }]] 
        });
        return res.status(200).send('OK');
      }

      // ==========================================
      // C. LOGIKA SHORTHAND (Parsing)
      // ==========================================
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
        const nama = args.slice(2, -1).join(' ');
        
        dataTransaksi = { ...dataTransaksi, jenis: 'kasbon', rekening: bank, nama_peminjam: nama };
        await db.collection('transaksi').add(dataTransaksi);
        
        await sendMessage(chatId, `📝 <b>KASBON TERCATAT!</b>\nNama: ${nama}\nDari: ${bank.toUpperCase()}\nNominal: ${formatRp(nominal)}`, keyboardBawah);
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