const axios = require("axios");
const escpos = require("escpos");
escpos.Network = require("escpos-network");
const Jimp = require("jimp");
const Pusher = require("pusher-js");
const net = require("net"); // [MỚI] Thư viện để check kết nối TCP

// ================= CẤU HÌNH ID CHI NHÁNH =================
const args = process.argv.slice(2);
const BRANCH_ID = args[0];
const VALID_IDS = [11, 12, 13, 14, 15, 16, 17, 18, 19];

if (!BRANCH_ID) {
  console.error("\n❌ LỖI: Bạn chưa nhập ID chi nhánh!");
  console.error("👉 Danh sách ID hợp lệ: " + VALID_IDS.join(", "));
  console.error("👉 Cách chạy: node index.js <ID>");
  process.exit(1);
}

console.log(`\n=========================================`);
console.log(`🚀 KHỞI ĐỘNG PRINT SERVER`);
console.log(`🏠 CHI NHÁNH ID: ${BRANCH_ID}`);
console.log(`=========================================\n`);

// ================= CẤU HÌNH HỆ THỐNG =================
const API_URL = "https://dinhdungit.click/BackEndZaloFnB/api/in/in.php";
const RENDER_URL = "https://dinhdungit.click/BackEndZaloFnB/renderNodejs";

// --- CẤU HÌNH PUSHER ---
const PUSHER_APP_KEY = "ff686e90b89e218ad92b";
const PUSHER_CLUSTER = "ap1";

const PRINTER_WIDTH = 576;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ============================================================
   HÀM MỚI: KIỂM TRA KẾT NỐI MÁY IN (PING)
============================================================ */
function checkPrinterConnection(ip, port, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let status = false;

    socket.setTimeout(timeout);

    socket.on("connect", () => {
      status = true;
      socket.destroy(); // Đóng kết nối ngay vì chỉ cần biết là thông
      resolve(true);
    });

    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("Timeout (Quá thời gian chờ)"));
    });

    socket.on("error", (err) => {
      socket.destroy();
      reject(err);
    });

    socket.connect(port, ip);
  });
}

/* ============================================================
   1. GET NEXT JOB
============================================================ */
async function getNextJob() {
  try {
    const res = await axios.post(API_URL, {
      action: "get_next_job",
      branch_id: BRANCH_ID,
    });
    return res.data.data || null;
  } catch (e) {
    return null;
  }
}

/* ============================================================
   2. UPDATE STATUS
============================================================ */
async function updateStatus(id, status) {
  try {
    await axios.post(API_URL, { action: "set_status", id, status });
  } catch (e) {
    console.log(`❌ Lỗi update status job #${id}:`, e.message);
  }
}

/* ============================================================
   3. RENDER HTML TO PNG
============================================================ */
async function renderHTMLtoPNG(html) {
  try {
    console.time("⏱️ Thời gian tải ảnh");
    const res = await axios.post(
      RENDER_URL,
      { html, width: PRINTER_WIDTH },
      { responseType: "arraybuffer", timeout: 30000 }
    );
    console.timeEnd("⏱️ Thời gian tải ảnh");

    if (!res.data || res.data.byteLength === 0) return null;
    return Buffer.from(res.data);
  } catch (e) {
    console.log("❌ Render HTML lỗi:", e.message);
    return null;
  }
}

/* ============================================================
   4. PREPARE RASTER (JIMP)
============================================================ */
async function prepareRasterData(pngBuffer) {
  console.time("⏱️ Thời gian xử lý ảnh");
  const image = await Jimp.read(pngBuffer);

  image.resize(PRINTER_WIDTH, Jimp.AUTO).greyscale();

  const width = image.bitmap.width;
  const height = image.bitmap.height;

  const bytesPerRow = Math.ceil(width / 8);
  const raster = Buffer.alloc(bytesPerRow * height);
  raster.fill(0);

  image.scan(0, 0, width, height, function (x, y, idx) {
    const red = this.bitmap.data[idx];
    if (red < 170) {
      raster[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
    }
  });
  console.timeEnd("⏱️ Thời gian xử lý ảnh");

  return { raster, width, height, bytesPerRow };
}

/* ============================================================
   5. PRINT RAW (ESC/POS)
============================================================ */
async function printRaw(ip, port, rasterData) {
  return new Promise((resolve, reject) => {
    const { raster, height, bytesPerRow } = rasterData;

    console.log(`🖨️ Đang gửi lệnh in tới: ${ip}:${port}`);
    const device = new escpos.Network(ip, port);
    const printer = new escpos.Printer(device);

    device.open((err) => {
      if (err) return reject(err);

      try {
        console.time("⏱️ Thời gian in");
        // Header chuẩn ESC/POS cho in raster bit image (GS v 0)
        const rasterHeader = Buffer.from([
          0x1d,
          0x76,
          0x30,
          0x00,
          bytesPerRow & 0xff,
          (bytesPerRow >> 8) & 0xff,
          height & 0xff,
          (height >> 8) & 0xff,
        ]);

        printer.align("ct");
        printer.raw(Buffer.concat([rasterHeader, raster]));
        printer.newLine();
        printer.newLine();
        printer.cut();

        setTimeout(() => {
          printer.close();
          console.timeEnd("⏱️ Thời gian in");
          resolve(true);
        }, 800);
      } catch (e) {
        printer.close();
        reject(e);
      }
    });
  });
}

/* ============================================================
   6. WORKER
============================================================ */
let isRunning = false;
let hasPendingRun = false;

async function worker(triggeredBy = "interval") {
  if (triggeredBy === "pusher") {
    hasPendingRun = true;
    console.log("🔔 Kích hoạt từ Pusher!");
  }

  if (isRunning) {
    if (triggeredBy === "pusher") console.log("⚠️ Worker bận, đã xếp hàng...");
    return;
  }

  isRunning = true;

  try {
    do {
      hasPendingRun = false;
      while (true) {
        const job = await getNextJob();
        if (!job) break; // Hết việc

        console.log(`\n➡ Job #${job.id}: Đã nhận. IP: ${job.ip_may_in}`);

        const printerIP = job.ip_may_in;
        const printerPort = job.port_may_in ? parseInt(job.port_may_in) : 9100;

        if (!printerIP) {
          console.log(`❌ Lỗi: Job không có IP máy in.`);
          await updateStatus(job.id, "error");
          continue;
        }

        // --- [MỚI] KIỂM TRA KẾT NỐI TRƯỚC ---
        try {
          // console.log(`📡 Đang kiểm tra kết nối...`);
          await checkPrinterConnection(printerIP, printerPort);
          console.log(`✅ Kết nối OK. Bắt đầu xử lý...`);
        } catch (connErr) {
          console.log(`⚠️ KHÔNG KẾT NỐI ĐƯỢC MÁY IN (${printerIP}).`);
          console.log(`↩️ Trả job #${job.id} về trạng thái 'pending'.`);

          // Trả trạng thái về pending để lần sau quét lại (hoặc để worker khác xử lý nếu có)
          await updateStatus(job.id, "pending");

          // Break loop hoặc continue tùy logic. Ở đây continue để xem có job khác không,
          // nhưng thực tế getNextJob lấy LIMIT 1 nên nó sẽ lấy lại job cũ nếu không cẩn thận.
          // Tốt nhất là break luôn lần quét này, đợi 5s sau quét lại.
          break;
        }
        // -------------------------------------

        // Bước 1: Render HTML
        const pngBuffer = await renderHTMLtoPNG(job.html);
        if (!pngBuffer) {
          console.log("❌ Lỗi render ảnh.");
          await updateStatus(job.id, "error");
          continue;
        }

        // Bước 2: Xử lý ảnh & In
        try {
          const rasterData = await prepareRasterData(pngBuffer);
          await printRaw(printerIP, printerPort, rasterData);
          await updateStatus(job.id, "done");
          console.log(`🎉 Job #${job.id}: Hoàn thành\n`);
        } catch (errPrint) {
          console.log(
            `❌ Lỗi trong quá trình in (Job #${job.id}):`,
            errPrint.message
          );
          // Nếu in lỗi (ví dụ đang in thì mất mạng), set về error hoặc pending tùy bạn
          await updateStatus(job.id, "error");
          break;
        }
      }
    } while (hasPendingRun);
  } catch (e) {
    console.log(`❌ Lỗi Worker:`, e.message);
  }

  isRunning = false;
}

/* ============================================================
   7. START
============================================================ */
(async () => {
  const pusher = new Pusher(PUSHER_APP_KEY, { cluster: PUSHER_CLUSTER });

  pusher.connection.bind("connected", () =>
    console.log("✅ PUSHER: Connected!")
  );
  pusher.connection.bind("error", (err) =>
    console.log("❌ PUSHER Error:", err)
  );

  const channelName = `print_channel_${BRANCH_ID}`;
  const channel = pusher.subscribe(channelName);

  console.log(`📡 Đang lắng nghe kênh: ${channelName}`);

  channel.bind("new_print_job", function (data) {
    console.log(`⚡ Pusher Event: Job ID ${data.id}`);
    setTimeout(() => worker("pusher"), 500);
  });

  worker("init");
  setInterval(() => worker("interval"), 5000);
})();
