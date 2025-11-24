const axios = require("axios");
const escpos = require("escpos");
escpos.Network = require("escpos-network");
const sharp = require("sharp");

// ==============================
// CONFIG
// ==============================
const API_URL = "https://dinhdungit.click/BackEndZaloFnB/api/in/in.php";
const API_URL_SETTING =
  "https://dinhdungit.click/BackEndZaloFnB/api/in/setting.php";
const RENDER_URL = "https://dinhdungit.click/BackEndZaloFnB/renderNodejs";

// Độ rộng chuẩn máy in 80mm là 576 dots (hoặc 512 tùy dòng, nhưng 576 phổ biến nhất cho Epson/Xprinter)
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
    console.log("❌ Lỗi API queue:", e.message);
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
// 🛠️ XỬ LÝ ẢNH (QUAN TRỌNG NHẤT)
// ==============================
async function prepareRasterData(pngBuffer) {
  // 1. Dùng sharp để chuyển về đen trắng tuyệt đối (0 và 255)
  // .threshold(180): Giá trị càng cao chữ càng đậm/dày, càng thấp chữ càng mảnh.
  // 160-180 là đẹp cho in nhiệt.
  const { data, info } = await sharp(pngBuffer)
    .resize({ width: PRINTER_WIDTH })
    .grayscale() // ⚠️ BẮT BUỘC: Để data trả về là 1 kênh màu (1 byte/pixel)
    .threshold(170) // Lọc nhiễu, làm sắc nét chữ
    .raw()
    .toBuffer({ resolveWithObject: true });

  const width = info.width;
  const height = info.height;

  // 2. Bit Packing: Gom 8 pixels (8 bytes 0/255) thành 1 byte (8 bit)
  const bytesPerRow = Math.ceil(width / 8);
  const raster = Buffer.alloc(bytesPerRow * height);
  raster.fill(0); // Xóa trắng buffer

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Vì đã grayscale & threshold nên data[i] chỉ là 0 (đen) hoặc 255 (trắng)
      // Trong máy in nhiệt: Bit 1 là in (đen), Bit 0 là không in (trắng)
      const pixelIdx = y * width + x;
      const isBlack = data[pixelIdx] === 0; // Lưu ý: sharp threshold: 0 là đen

      if (isBlack) {
        // Set bit tương ứng tại vị trí x
        // x >> 3 : Tìm vị trí byte (chia 8)
        // 0x80 >> (x % 8) : Tạo mask cho bit tại vị trí lẻ
        raster[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }

  return { raster, width, height, bytesPerRow };
}

// ==============================
// 🖨️ GỬI LỆNH RAW (GS v 0)
// ==============================
async function printRaw(ip, port, rasterData) {
  return new Promise((resolve, reject) => {
    const { raster, width, height, bytesPerRow } = rasterData;

    // Tạo device network
    const device = new escpos.Network(ip, port);
    const printer = new escpos.Printer(device);

    device.open((err) => {
      if (err) {
        console.log(`❌ Không kết nối được máy in ${ip}:`, err.message);
        return reject(err);
      }

      console.log(`🖨 Đang gửi ${raster.length} bytes tới máy in...`);

      try {
        // Cấu trúc lệnh GS v 0 (Print raster bit image)
        // Header: 1D 76 30 00 xL xH yL yH
        const header = Buffer.from([
          0x1d,
          0x76,
          0x30,
          0x00,
          bytesPerRow & 0xff,
          (bytesPerRow >> 8) & 0xff, // Width bytes (Little Endian)
          height & 0xff,
          (height >> 8) & 0xff, // Height dots (Little Endian)
        ]);

        // Gửi lệnh căn giữa (tùy chọn)
        printer.align("ct");

        // Gửi Header + Data Raster
        printer.raw(Buffer.concat([header, raster]));

        // Đẩy giấy và cắt
        printer.newLine();
        printer.newLine();
        printer.cut();

        // Đóng kết nối sau 1s để đảm bảo lệnh đi hết
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

      // 1. Render HTML -> PNG
      const pngBuffer = await renderHTMLtoPNG(job.html);
      if (!pngBuffer) throw new Error("Render thất bại");

      // 2. Xử lý ảnh sang Raster (Raw bytes)
      const rasterData = await prepareRasterData(pngBuffer);

      // 3. In
      await printRaw(ip, port, rasterData);

      // 4. Done
      console.log(`✅ Job #${job.id}: Hoàn thành`);
      await updateStatus(job.id, "done");
    } catch (e) {
      console.log(`❌ Job #${job.id} thất bại:`, e.message);
      await updateStatus(job.id, "pending"); // Hoặc 'failed' tùy logic
    }
    await sleep(500); // Nghỉ nhẹ giữa các job
  }
}

// ==============================
// START
// ==============================
(async () => {
  console.log("🚀 Worker Raw Printing đang chạy...");
  worker();
  setInterval(worker, 5000);
})();
