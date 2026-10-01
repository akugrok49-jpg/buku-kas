const admin = require('firebase-admin');
const axios = require('axios');

// 1. Koneksi ke Firebase (Menggunakan Variabel Rahasia)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // Replace digunakan agar Vercel bisa membaca karakter baris baru (\n)
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    })
  });
}
const db = admin.firestore();

// 2. Fungsi membaca nominal (contoh: "5jt" -> 5000000, "20k" -> 20000)
const parseNominal = (str) => {
  let numStr = str.toLowerCase().replace(/jt/g, '000000').replace(/k/g, '000');
  return Number(numStr.replace(/[^0-9]/g, '')) || 0;
};

// 3. Fungsi Utama Bot
module.exports = async (req, res) => {
  // Hanya menerima metode POST dari Telegram Webhook
  if (req.method !== 'POST') return res.status(200).send('Server Bot Aktif!');

  const message = req.body.message;
  // Abaikan jika bukan pesan teks
  if (!message || !message.text) return res.status(200).send('OK');

  const chatId = message.chat.id;
  const text = message.text.toLowerCase().trim();
  const rawText = message.text.trim(); // Simpan huruf kapital aslinya untuk keterangan

  // Fungsi untuk membalas chat Telegram
  const balasPesan = async (teksBalasan) => {
    const url = `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`;
    await axios.post(url, { chat_id: chatId, text: teksBalasan });
  };

  try {
    const args = rawText.split(' ');
    const command = args[0].toLowerCase();
    const nominal = parseNominal(args[args.length - 1]);
    
    // Siapkan wadah data untuk disimpan
    let dataTransaksi = {
      waktu: admin.firestore.FieldValue.serverTimestamp(),
      nominal: nominal
    };

    // LOGIKA PARSING SHORTHAND
    if (command.startsWith('+') || command.startsWith('-')) {
      const tipe = command.charAt(0) === '+' ? 'masuk' : 'keluar';
      const bank = command.substring(1); // 'b' atau 's'
      const keterangan = args.slice(1, -1).join(' ');

      dataTransaksi = { ...dataTransaksi, jenis: tipe, rekening: bank, keterangan: keterangan };
      await db.collection('transaksi').add(dataTransaksi);
      
      let simbol = tipe === 'masuk' ? '✅' : '🔴';
      await balasPesan(`${simbol} Tercatat: ${tipe.toUpperCase()} Rp${nominal.toLocaleString('id-ID')} pada rek ${bank.toUpperCase()}.\nKet: ${keterangan}`);
    } 
    
    else if (command === 'bon') {
      const bank = args[1].toLowerCase();
      const nama = args.slice(2, -1).join(' ');
      
      dataTransaksi = { ...dataTransaksi, jenis: 'kasbon', rekening: bank, nama_peminjam: nama };
      await db.collection('transaksi').add(dataTransaksi);
      
      await balasPesan(`📝 KASBON TERCATAT!\nNama: ${nama}\nNominal: Rp${nominal.toLocaleString('id-ID')}\nDiambil dari: ${bank.toUpperCase()}`);
    } 
    
    else if (command === 'tf') {
      const dari = args[1].toLowerCase();
      const ke = args[3].toLowerCase(); // Karena formatnya: tf b ke s 1jt
      
      dataTransaksi = { ...dataTransaksi, jenis: 'mutasi', dari_rekening: dari, ke_rekening: ke };
      await db.collection('transaksi').add(dataTransaksi);
      
      await balasPesan(`🔄 MUTASI TERCATAT!\nRp${nominal.toLocaleString('id-ID')} dipindah dari ${dari.toUpperCase()} ke ${ke.toUpperCase()}.`);
    }

    else if (command === 'saldo') {
      await balasPesan('Menghitung saldo dari database... (Fitur rekap ini akan kita lengkapi nanti).');
    } 
    
    else {
      await balasPesan('⚠️ Format tidak dikenali. Gunakan format yang benar, contoh: +b bos 5jt');
    }

  } catch (error) {
    console.error("Error:", error);
    await balasPesan('❌ Terjadi kesalahan pada server saat menyimpan data.');
  }

  // Wajib merespons 'OK' ke Telegram agar pesan tidak diulang-ulang
  return res.status(200).send('OK');
};