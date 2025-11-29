const axios = require("axios");
const escpos = require("escpos");
escpos.Network = require("escpos-network");
const Jimp = require("jimp");
const Pusher = require("pusher-js");

// ================= CẤU HÌNH HỆ THỐNG =================
const API_URL = "https://dinhdungit.click/BackEndZaloFnB/api/in/in.php";
const API_URL_SETTING =
  "https://dinhdungit.click/BackEndZaloFnB/api/in/setting.php";
const RENDER_URL = "https://dinhdungit.click/BackEndZaloFnB/renderNodejs";

// --- CẤU HÌNH PUSHER ---
const PUSHER_APP_KEY = "ff686e90b89e218ad92b";
const PUSHER_CLUSTER = "ap1";

const PRINTER_WIDTH = 576;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ============================================================
   1. LOAD PRINTER CONFIG
============================================================ */
async function loadPrinterConfig() {
  try {
    const res = await axios.post(API_URL_SETTING, { action: "get_printer" });
    if (res.data.success && res.data.data) {
      return {
        ip: res.data.data.ip,
        port: parseInt(res.data.data.port, 10),
      };
    }
  } catch (e) {
    console.log("❌ Lỗi load máy in:", e.message);
  }
  return { ip: "192.168.1.250", port: 9100 };
}

/* ============================================================
   2. GET NEXT JOB
============================================================ */
async function getNextJob() {
  try {
    const res = await axios.post(API_URL, { action: "get_next_job" });
    return res.data.data || null;
  } catch {
    return null;
  }
}

/* ============================================================
   3. UPDATE STATUS
============================================================ */
async function updateStatus(id, status) {
  try {
    await axios.post(API_URL, { action: "set_status", id, status });
  } catch (e) {
    console.log(`❌ Lỗi update status job #${id}:`, e.message);
  }
}

/* ============================================================
   4. RENDER HTML TO PNG
============================================================ */
async function renderHTMLtoPNG(html) {
  try {
    // Đo thời gian gọi Server Render
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
   5. PREPARE RASTER (JIMP)
============================================================ */
async function prepareRasterData(pngBuffer) {
  // Đo thời gian xử lý ảnh trên điện thoại
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
   6. PRINT RAW (ESC/POS)
============================================================ */
async function printRaw(ip, port, rasterData) {
  return new Promise((resolve, reject) => {
    const { raster, height, bytesPerRow } = rasterData;

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
   7. WORKER
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
        const { ip, port } = await loadPrinterConfig();

        // Bước 1: Render
        const pngBuffer = await renderHTMLtoPNG(job.html);
        if (!pngBuffer) {
          await updateStatus(job.id, "error");
          continue;
        }

        // Bước 2: Xử lý ảnh & In
        try {
          const rasterData = await prepareRasterData(pngBuffer);
          await printRaw(ip, port, rasterData);
          await updateStatus(job.id, "done");
          console.log(`✅ Job #${job.id}: Hoàn thành\n`);
        } catch (errPrint) {
          console.log(`❌ Lỗi in:`, errPrint.message);
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
   8. START
============================================================ */
(async () => {
  console.log("🚀 Print Server (Benchmark Version) đang chạy...");

  const pusher = new Pusher(PUSHER_APP_KEY, { cluster: PUSHER_CLUSTER });

  pusher.connection.bind("connected", () =>
    console.log("✅ PUSHER: Connected!")
  );
  pusher.connection.bind("error", (err) =>
    console.log("❌ PUSHER Error:", err)
  );

  const channel = pusher.subscribe("print_channel");
  channel.bind("new_print_job", function (data) {
    console.log(`⚡ Pusher Event: Job ID ${data.id}`);
    setTimeout(() => worker("pusher"), 500);
  });

  worker("init");
  setInterval(() => worker("interval"), 5000);
})();
