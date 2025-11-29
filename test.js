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

// --- CẤU HÌNH PUSHER (Thay Key của bạn vào đây) ---
const PUSHER_APP_KEY = "ff686e90b89e218ad92b";
const PUSHER_CLUSTER = "ap1";
// --------------------------------------------------

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
  // IP mặc định nếu không load được từ API
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
    console.log(`⚙️ Job #${id} → ${status}`);
  } catch (e) {
    console.log(`❌ Lỗi update status job #${id}:`, e.message);
  }
}

/* ============================================================
   4. RENDER HTML TO PNG
============================================================ */
async function renderHTMLtoPNG(html) {
  try {
    const res = await axios.post(
      RENDER_URL,
      { html, width: PRINTER_WIDTH },
      { responseType: "arraybuffer", timeout: 30000 }
    );

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
   7. WORKER - LOGIC XỬ LÝ THÔNG MINH
============================================================ */
let isRunning = false;
let hasPendingRun = false; // Cờ nhớ: Có lệnh in mới khi đang bận

async function worker(triggeredBy = "interval") {
  // 1. Nếu được gọi từ Pusher, đánh dấu có việc cần làm
  if (triggeredBy === "pusher") {
    hasPendingRun = true;
    console.log("🔔 Kích hoạt in từ Pusher!");
  }

  // 2. Nếu đang chạy, không làm phiền, nhưng cờ hasPendingRun đã được bật
  if (isRunning) {
    if (triggeredBy === "pusher") {
      console.log(
        "⚠️ Worker đang bận, đã xếp hàng đợi xử lý ngay sau job này."
      );
    }
    return;
  }

  isRunning = true;

  try {
    // 3. Vòng lặp Do-While: Đảm bảo xử lý hết sạch việc kể cả việc mới đến
    do {
      hasPendingRun = false; // Reset cờ trước khi bắt đầu quét

      // Vòng lặp quét sạch DB
      while (true) {
        const job = await getNextJob();
        if (!job) break; // Hết việc trong DB thì thoát vòng while nhỏ

        console.log(`➡ Job #${job.id}: Bắt đầu xử lý...`);
        const { ip, port } = await loadPrinterConfig();

        // A. Render ảnh
        const pngBuffer = await renderHTMLtoPNG(job.html);
        if (!pngBuffer) {
          console.log("❌ Render thất bại, đánh dấu lỗi.");
          // Update status error để không bị lặp lại mãi job lỗi này
          await updateStatus(job.id, "error");
          continue; // Chuyển sang job tiếp theo
        }

        // B. In ấn
        try {
          const rasterData = await prepareRasterData(pngBuffer);
          await printRaw(ip, port, rasterData);
          await updateStatus(job.id, "done");
          console.log(`✅ Job #${job.id}: Hoàn thành`);
        } catch (errPrint) {
          console.log(
            `❌ Lỗi kết nối máy in (${ip}:${port}):`,
            errPrint.message
          );
          // Nếu lỗi kết nối máy in, thoát vòng while để retry sau (giữ status pending)
          break;
        }
      }

      // Nếu trong lúc đang in ở trên mà Pusher bắn tin tới,
      // hasPendingRun sẽ lại thành true -> Vòng do-while lặp lại ngay lập tức.
    } while (hasPendingRun);
  } catch (e) {
    console.log(`❌ Lỗi Worker không mong muốn:`, e.message);
  }

  isRunning = false;
}

/* ============================================================
   8. KHỞI ĐỘNG HỆ THỐNG
============================================================ */
(async () => {
  console.log("🚀 Print Server (Pusher Optimized) đang chạy...");

  // A. Kết nối Pusher
  const pusher = new Pusher(PUSHER_APP_KEY, {
    cluster: PUSHER_CLUSTER,
  });

  // --- THÊM PHẦN LOG TRẠNG THÁI KẾT NỐI ---
  pusher.connection.bind("connected", () => {
    console.log("✅ PUSHER: Đã kết nối thành công tới Server!");
  });
  pusher.connection.bind("disconnected", () => {
    console.log("⚠️ PUSHER: Mất kết nối! Đang thử lại...");
  });
  pusher.connection.bind("error", (err) => {
    console.log("❌ PUSHER: Lỗi kết nối:", err.error ? err.error.data : err);
  });
  // ----------------------------------------

  const channel = pusher.subscribe("print_channel");

  // B. Lắng nghe sự kiện
  channel.bind("new_print_job", function (data) {
    console.log(`⚡ Nhận tín hiệu Pusher: Job ID ${data.id}`);

    // Quan trọng: Delay 500ms để đảm bảo PHP đã Commit dữ liệu vào DB xong
    setTimeout(() => {
      worker("pusher");
    }, 500);
  });

  // C. Chạy quét lần đầu
  worker("init");

  // D. Cơ chế Backup: 5 giây quét 1 lần phòng hờ rớt mạng Pusher
  setInterval(() => worker("interval"), 5000);
})();
