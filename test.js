const axios = require("axios");
const escpos = require("escpos");
escpos.Network = require("escpos-network");
const Jimp = require("jimp"); // Đổi từ sharp sang jimp

// ==============================
// CONFIG
// ==============================
const API_URL = "https://dinhdungit.click/BackEndZaloFnB/api/in/in.php";
const API_URL_SETTING =
  "https://dinhdungit.click/BackEndZaloFnB/api/in/setting.php";
const RENDER_URL = "https://dinhdungit.click/BackEndZaloFnB/renderNodejs";

const PRINTER_WIDTH = 576;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ==============================
// GET PRINTER CONFIG
// ==============================
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

// ==============================
// QUEUE API
// ==============================
async function getPendingJobs() {
  try {
    const res = await axios.post(API_URL, { action: "get_all" });
    return res.data.data || [];
  } catch (e) {
    // console.log("❌ Lỗi API queue:", e.message);
    return [];
  }
}

async function updateStatus(id, status) {
  try {
    await axios.post(API_URL, { action: "set_status", id, status });
    console.log(`⚙️ Job #${id} → ${status}`);
  } catch (e) {
    console.log(`❌ Lỗi update status job #${id}:`, e.message);
  }
}

// ==============================
// RENDER HTML → PNG buffer
// ==============================
async function renderHTMLtoPNG(html) {
  try {
    console.log("🔄 Đang render HTML...");
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

// ==============================
// 🛠️ XỬ LÝ ẢNH (DÙNG JIMP)
// ==============================
async function prepareRasterData(pngBuffer) {
  // Đọc ảnh bằng Jimp
  const image = await Jimp.read(pngBuffer);

  // Resize về đúng khổ giấy và chuyển sang đen trắng
  image.resize(PRINTER_WIDTH, Jimp.AUTO).greyscale();

  const width = image.bitmap.width;
  const height = image.bitmap.height;

  // Bit Packing
  const bytesPerRow = Math.ceil(width / 8);
  const raster = Buffer.alloc(bytesPerRow * height);
  raster.fill(0);

  // Jimp lưu pixel dạng RGBA liên tiếp [R, G, B, A, R, G, B, A...]
  // Vì đã greyscale nên R=G=B. Ta chỉ cần lấy giá trị R.

  image.scan(0, 0, width, height, function (x, y, idx) {
    // idx là vị trí bắt đầu của pixel trong buffer (gồm 4 byte RGBA)
    const red = this.bitmap.data[idx]; // Lấy giá trị màu (0-255)

    // Threshold thủ công: < 170 là đen (in), > 170 là trắng
    if (red < 170) {
      raster[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
    }
  });

  return { raster, width, height, bytesPerRow };
}

// ==============================
// 🖨️ GỬI LỆNH RAW
// ==============================
async function printRaw(ip, port, rasterData) {
  return new Promise((resolve, reject) => {
    const { raster, width, height, bytesPerRow } = rasterData;

    const device = new escpos.Network(ip, port);
    const printer = new escpos.Printer(device);

    device.open((err) => {
      if (err) {
        console.log(`❌ Không kết nối được máy in ${ip}:`, err.message);
        return reject(err);
      }

      console.log(`🖨 Đang gửi lệnh in...`);

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
        }, 1000);
      } catch (printErr) {
        printer.close();
        reject(printErr);
      }
    });
  });
}

// ==============================
// WORKER
// ==============================
async function worker() {
  const jobs = await getPendingJobs();
  if (!jobs.length) return;

  console.log(`📦 Có ${jobs.length} job cần xử lý`);
  const { ip, port } = await loadPrinterConfig();

  for (const job of jobs) {
    console.log(`➡ Job #${job.id}: Bắt đầu`);
    try {
      await updateStatus(job.id, "processing");

      const pngBuffer = await renderHTMLtoPNG(job.html);
      if (!pngBuffer) throw new Error("Render thất bại");

      const rasterData = await prepareRasterData(pngBuffer);

      await printRaw(ip, port, rasterData);

      console.log(`✅ Job #${job.id}: Hoàn thành`);
      await updateStatus(job.id, "done");
    } catch (e) {
      console.log(`❌ Job #${job.id} thất bại:`, e.message);
      await updateStatus(job.id, "pending");
    }
    await sleep(500);
  }
}

// ==============================
// START
// ==============================
(async () => {
  console.log("🚀 Worker (Jimp Version) đang chạy trên Android...");
  worker();
  setInterval(worker, 5000);
})();
