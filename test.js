const axios = require("axios");
const escpos = require("escpos");
escpos.Network = require("escpos-network");
const Jimp = require("jimp");
const Pusher = require("pusher-js");

// ================= CẤU HÌNH HỆ THỐNG =================
const API_URL = "https://dinhdungit.click/BackEndZaloFnB/api/in/in.php";
// const API_URL_SETTING = ... (Đã bỏ vì không cần nữa)
const RENDER_URL = "https://dinhdungit.click/BackEndZaloFnB/renderNodejs";

// --- CẤU HÌNH PUSHER ---
const PUSHER_APP_KEY = "ff686e90b89e218ad92b";
const PUSHER_CLUSTER = "ap1";

const PRINTER_WIDTH = 576;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ============================================================
   1. GET NEXT JOB (Lấy job kèm IP và Port từ DB)
============================================================ */
async function getNextJob() {
  try {
    const res = await axios.post(API_URL, { action: "get_next_job" });
    // Dữ liệu trả về sẽ có dạng: { id, html, ip_may_in, port_may_in, ... }
    return res.data.data || null;
  } catch (e) {
    // console.log("Lỗi get job:", e.message); // Có thể ẩn log này để đỡ rối
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
    console.time("⏱️ Thời gian tải ảnh từ Server");
    const res = await axios.post(
      RENDER_URL,
      { html, width: PRINTER_WIDTH },
      { responseType: "arraybuffer", timeout: 30000 }
    );
    console.timeEnd("⏱️ Thời gian tải ảnh từ Server");

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
  console.time("⏱️ Thời gian xử lý ảnh (Jimp)");
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
  console.timeEnd("⏱️ Thời gian xử lý ảnh (Jimp)");

  return { raster, width, height, bytesPerRow };
}

/* ============================================================
   5. PRINT RAW (ESC/POS)
============================================================ */
async function printRaw(ip, port, rasterData) {
  return new Promise((resolve, reject) => {
    const { raster, height, bytesPerRow } = rasterData;

    console.log(`🖨️ Đang kết nối tới máy in: ${ip}:${port}`);
    const device = new escpos.Network(ip, port);
    const printer = new escpos.Printer(device);

    device.open((err) => {
      if (err) return reject(err);

      try {
        console.time("⏱️ Thời gian gửi lệnh in");
        const header = Buffer.from([
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
        printer.raw(Buffer.concat([header, raster]));
        printer.newLine();
        printer.newLine();
        printer.cut();

        setTimeout(() => {
          printer.close();
          console.timeEnd("⏱️ Thời gian gửi lệnh in");
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
    console.log("🔔 Kích hoạt in từ Pusher!");
  }

  if (isRunning) {
    if (triggeredBy === "pusher") console.log("⚠️ Worker bận, xếp hàng...");
    return;
  }

  isRunning = true;

  try {
    do {
      hasPendingRun = false;
      while (true) {
        const job = await getNextJob();
        if (!job) break;

        console.log(`\n➡ Job #${job.id}: Bắt đầu xử lý...`);

        // --- [SỬA ĐỔI QUAN TRỌNG] ---
        // Lấy IP và Port trực tiếp từ Job (Backend đã lưu sẵn)
        const printerIP = job.ip_may_in;
        const printerPort = job.port_may_in ? parseInt(job.port_may_in) : 9100;

        if (!printerIP) {
          console.log(`❌ Job #${job.id} bị lỗi: Không có địa chỉ IP máy in!`);
          await updateStatus(job.id, "error"); // Đánh dấu lỗi để không bị lặp
          continue;
        }
        // -----------------------------

        // Bước 1: Render
        const pngBuffer = await renderHTMLtoPNG(job.html);
        if (!pngBuffer) {
          await updateStatus(job.id, "error");
          continue;
        }

        // Bước 2: Xử lý ảnh & In
        try {
          const rasterData = await prepareRasterData(pngBuffer);
          // Truyền IP/Port lấy từ job vào hàm in
          await printRaw(printerIP, printerPort, rasterData);
          await updateStatus(job.id, "done");
          console.log(`✅ Job #${job.id}: Hoàn thành\n`);
        } catch (errPrint) {
          console.log(`❌ Lỗi in (Job #${job.id}):`, errPrint.message);
          // Tùy chọn: Có thể set status là 'pending' để thử lại sau, hoặc 'error' để bỏ qua
          await updateStatus(job.id, "error");
          break; // Break để chờ một chút trước khi thử lại vòng lặp
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
  console.log("🚀 Print Server (Smart Routing Version) đang chạy...");

  const pusher = new Pusher(PUSHER_APP_KEY, { cluster: PUSHER_CLUSTER });

  pusher.connection.bind("connected", () =>
    console.log("✅ PUSHER: Connected!")
  );
  pusher.connection.bind("error", (err) =>
    console.log("❌ PUSHER Error:", err)
  );

  const channel = pusher.subscribe("print_channel");
  channel.bind("new_print_job", function (data) {
    // Data trả về từ Pusher bây giờ cũng có thể chứa target ip nếu cần dùng ngay
    // console.log(`⚡ Pusher Event: Job ID ${data.id}`, data.target);
    console.log(`⚡ Pusher Event: Job ID ${data.id}`);
    setTimeout(() => worker("pusher"), 500);
  });

  worker("init");
  setInterval(() => worker("interval"), 5000);
})();
