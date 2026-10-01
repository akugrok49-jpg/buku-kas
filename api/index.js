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

  // Struktur Menu Utama
  const mainMenuMarkup = {
    inline_keyboard: [
      [{ text: '1. 📥 Masuk Brimo', callback_data: 'menu_1' }, { text: '2. 📥 Masuk SeaBank', callback_data: 'menu_2' }],
      [{ text: '3. 🔄 Mutasi Antar Rekening', callback_data: 'menu_3' }],
      [{ text: '4. 📝 Catat Kasbon', callback_data: 'menu_4' }, { text: '5. 📤 Pengeluaran Umum', callback_data: 'menu_5' }],
      [{ text: '6. 💰 Cek Saldo Total', callback_data: 'menu_6' }],
      [{ text: '7. 📋 Riwayat & Hapus Data', callback_data: 'menu_7' }]
    ]
  };

  try {
    // ==========================================
    // A. LOGIKA JIKA TOMBOL MENU DITEKAN
    // ==========================================
    if (update.callback_query) {
      const callback = update.callback_query;
      const chatId = callback.message.chat.id;
      const messageId = callback.message.message_id;
      const data = callback.data;

      // Hapus ikon loading pada tombol Telegram
      await axios.post(`${apiUrl}/answerCallbackQuery`, { callback_query_id: callback.id });

      // Balasan Panduan Format (Tombol 1-5)
      if (data === 'menu_1') await sendMessage(chatId, 'Ketik: <code>+b [keterangan] [nominal]</code>\nContoh: <code>+b bos 5jt</code>');
      else if (data === 'menu_2') await sendMessage(chatId, 'Ketik: <code>+s [keterangan] [nominal]</code>\nContoh: <code>+s jualan 500k</code>');
      else if (data === 'menu_3') await sendMessage(chatId, 'Ketik: <code>tf [dari] ke [tujuan] [nominal]</code>\nContoh: <code>tf b ke s 1jt</code>');
      else if (data === 'menu_4') await sendMessage(chatId, 'Ketik: <code>bon [bank] [nama] [nominal]</code>\nContoh: <code>bon b alpin 300k</code>');
      else if (data === 'menu_5') await sendMessage(chatId, 'Ketik: <code>-[bank] [keterangan] [nominal]</code>\nContoh: <code>-s spidol 20k</code>');
      
      // Hitung Saldo Real-Time (Tombol 6)
      else if (data === 'menu_6') {
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

        const teksSaldo = `<b>💰 INFORMASI SALDO SAAT INI</b>\n\n💳 <b>Brimo:</b> ${formatRp(saldoBrimo)}\n💳 <b>SeaBank:</b> ${formatRp(saldoSea)}\n\n📝 <b>Total Kasbon Beredar:</b> ${formatRp(totalKasbon)}`;
        await editMessage(chatId, messageId, teksSaldo, { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: 'back_menu' }]] });
      }
      
      // Tampilkan 10 Riwayat Terakhir & Tombol Hapus (Tombol 7)
      else if (data === 'menu_7') {
        const snapshot = await db.collection('transaksi').orderBy('waktu', 'desc').limit(10).get();
        
        if (snapshot.empty) {
          await editMessage(chatId, messageId, 'Data masih kosong.', { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: 'back_menu' }]] });
          return res.status(200).send('OK');
        }

        let teksRiwayat = '<b>📋 10 TRANSAKSI TERAKHIR</b>\n\n';
        let keyboardHapus = [];
        let i = 1;

        snapshot.forEach(doc => {
          const trx = doc.data();
          let icon = trx.jenis === 'masuk' ? '📥' : (trx.jenis === 'mutasi' ? '🔄' : '📤');
          let ket = trx.keterangan || trx.nama_peminjam || `${trx.dari_rekening} -> ${trx.ke_rekening}`;
          let rek = trx.rekening ? trx.rekening.toUpperCase() : '';
          
          teksRiwayat += `${i}. ${icon} <b>${trx.jenis.toUpperCase()} ${rek}</b>: ${formatRp(trx.nominal)}\n   └ <i>Ket: ${ket}</i>\n\n`;
          
          // Susun tombol hapus berdampingan (2 per baris)
          let btn = { text: `🗑 Hapus ${i}`, callback_data: `del_${doc.id}` };
          if (i % 2 !== 0) keyboardHapus.push([btn]); 
          else keyboardHapus[keyboardHapus.length - 1].push(btn);
          i++;
        });

        keyboardHapus.push([{ text: '🔙 Kembali ke Menu Utama', callback_data: 'back_menu' }]);
        await editMessage(chatId, messageId, teksRiwayat, { inline_keyboard: keyboardHapus });
      }

      // Eksekusi Penghapusan Data
      else if (data.startsWith('del_')) {
        const docId = data.split('_')[1];
        await db.collection('transaksi').doc(docId).delete();
        await editMessage(chatId, messageId, '✅ <b>Transaksi berhasil dihapus!</b>\nSaldo telah disesuaikan.', { inline_keyboard: [[{ text: '🔙 Kembali ke Menu', callback_data: 'back_menu' }]] });
      }

      // Navigasi Kembali ke Menu Utama
      else if (data === 'back_menu') {
        await editMessage(chatId, messageId, '<b>MENU UTAMA KASIR BOS</b>\nPilih operasional:', mainMenuMarkup);
      }

      return res.status(200).send('OK');
    }

    // ==========================================
    // B. LOGIKA JIKA MENGETIK PESAN (SHORTHAND)
    // ==========================================
    if (update.message && update.message.text) {
      const chatId = update.message.chat.id;
      const rawText = update.message.text.trim();
      const text = rawText.toLowerCase();
      
      // Panggil Menu Utama
      if (text === '/start' || text === '/menu') {
        await sendMessage(chatId, '<b>MENU UTAMA KASIR BOS</b>\nPilih operasional:', mainMenuMarkup);
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
        await sendMessage(chatId, `${simbol} <b>Tercatat!</b>\n${tipe.toUpperCase()} ${bank.toUpperCase()}: ${formatRp(nominal)}\nKet: ${keterangan}`);
      } 
      else if (command === 'bon') {
        const bank = args[1].toLowerCase();
        const nama = args.slice(2, -1).join(' ');
        
        dataTransaksi = { ...dataTransaksi, jenis: 'kasbon', rekening: bank, nama_peminjam: nama };
        await db.collection('transaksi').add(dataTransaksi);
        
        await sendMessage(chatId, `📝 <b>KASBON TERCATAT!</b>\nNama: ${nama}\nDari: ${bank.toUpperCase()}\nNominal: ${formatRp(nominal)}`);
      } 
      else if (command === 'tf') {
        const dari = args[1].toLowerCase();
        const ke = args[3].toLowerCase();
        
        dataTransaksi = { ...dataTransaksi, jenis: 'mutasi', dari_rekening: dari, ke_rekening: ke };
        await db.collection('transaksi').add(dataTransaksi);
        
        await sendMessage(chatId, `🔄 <b>MUTASI TERCATAT!</b>\n${formatRp(nominal)} dipindah dari ${dari.toUpperCase()} ke ${ke.toUpperCase()}.`);
      }
    }
  } catch (error) {
    console.error(error);
  }

  return res.status(200).send('OK');
};