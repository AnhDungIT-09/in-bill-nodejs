const Jimp = require("jimp");
const net = require("net");
const axios = require("axios");

// ==========================
// CONFIG
// ==========================
const API_URL = "https://dinhdungit.click/BackEndZaloFnB/api/in/in.php";
const RENDER_API = "https://html-renderer.dinhdungit.cloud/render";

const PRINTER_IP = "192.168.1.110";
const PRINTER_PORT = 9100;

// Khổ in 80mm
const CANVAS_WIDTH = 576;
const PRINT_WIDTH = 560;
const MACHINE_OFFSET = 12;

// ==========================
// API QUEUE
// ==========================
async function getPrintQueue() {
  console.log("📡 Gọi API get_all...");
  const res = await axios.post(API_URL, { action: "get_all" });
  console.log("📥 Kết quả get_all:", res.data);
  return res.data.data || [];
}

async function deletePrinted(id) {
  console.log("🗑 Xóa job ID:", id);
  await axios.post(API_URL, { action: "delete", id });
}

async function setStatus(id, status) {
  console.log(`🔧 Update status ${id} → ${status}`);
  await axios.post(API_URL, { action: "set_status", id, status });
}

// ==========================
// RENDER KHÔNG DÙNG PUPPETEER
// ==========================
async function renderHTMLtoPNG(html) {
  console.log("🎨 Gửi HTML lên Cloud Render...");

  const res = await axios.post(RENDER_API, { html }, { timeout: 15000 });

  if (!res.data || !res.data.image) {
    throw new Error("Render API không trả về image");
  }

  console.log("✔ Nhận PNG base64 từ server");

  return Buffer.from(res.data.image, "base64");
}

// ==========================
// XỬ LÝ IN
// ==========================
async function printHTML(html) {
  console.log("\n===============================");
  console.log("🖨 BẮT ĐẦU QUY TRÌNH IN");
  console.log("===============================\n");

  try {
    console.log("1️⃣ Render HTML → PNG");

    const pngBuffer = await renderHTMLtoPNG(html);

    await Jimp.read(pngBuffer).then((img) => img.writeAsync("label.png"));
    console.log("✔ Đã lưu label.png");

    console.log("2️⃣ Load PNG + xử lý grayscale");
    const img = await Jimp.read("label.png");

    img
      .greyscale()
      .contrast(0.4)
      .brightness(0.1)
      .resize(PRINT_WIDTH, Jimp.AUTO);

    console.log("✔ Resize xong");

    console.log("3️⃣ Canh giữa → tạo canvas");

    const canvas = new Jimp(CANVAS_WIDTH, img.bitmap.height, 0xffffffff);

    const centerOffset = Math.floor((CANVAS_WIDTH - PRINT_WIDTH) / 2);
    const finalOffset = centerOffset + MACHINE_OFFSET;

    canvas.composite(img, finalOffset, 0);
    await canvas.writeAsync("debug_centered.png");

    console.log("✔ Xuất debug_centered.png OK");

    console.log("4️⃣ Convert sang bitmap mono...");

    const width = canvas.bitmap.width;
    const height = canvas.bitmap.height;
    const bytesPerRow = Math.ceil(width / 8);
    const bitmap = Buffer.alloc(bytesPerRow * height);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const pixel = canvas.bitmap.data[idx];
        if (pixel < 160) {
          bitmap[y * bytesPerRow + (x >> 3)] |= 0x80 >> x % 8;
        }
      }
    }

    console.log("✔ Convert bitmap xong");

    console.log("5️⃣ Chuẩn bị TSPL command");

    let tspl = "";
    tspl += "SIZE 80 mm,80 mm\r\n";
    tspl += "GAP 2 mm,0 mm\r\n";
    tspl += "CLS\r\n";
    tspl += `BITMAP 0,10,${bytesPerRow},${height},0,`;

    const header = Buffer.from(tspl, "ascii");
    const footer = Buffer.from("\r\nPRINT 1\r\n", "ascii");
    const printCmd = Buffer.concat([header, bitmap, footer]);

    console.log("6️⃣ Gửi tới máy in...");

    return await new Promise((resolve, reject) => {
      const client = new net.Socket();

      client.connect(PRINTER_PORT, PRINTER_IP, () => {
        console.log("📡 Đã kết nối máy in");
        client.write(printCmd, () => {
          console.log("✅ In xong!");
          client.end();
          resolve();
        });
      });

      client.on("error", (err) => {
        console.error("❌ Lỗi máy in:", err.message);
        reject(err);
      });
    });
  } catch (err) {
    console.error("🔥 LỖI TRONG printHTML:", err);
    throw err;
  }
}

// ==========================
// WORKER
// ==========================
async function worker() {
  console.log("\n⏳ Worker chạy...");

  let queue = [];

  try {
    queue = await getPrintQueue();
  } catch (err) {
    console.error("❌ Lỗi load queue:", err);
    return;
  }

  if (!queue.length) {
    console.log("→ Không có job");
    return;
  }

  console.log(`📦 Có ${queue.length} job mới`);

  for (const item of queue) {
    console.log("\n==============================");
    console.log("▶ Xử lý job", item.id);
    console.log("==============================");

    await setStatus(item.id, "printing");

    try {
      await printHTML(item.html);
      console.log("🗑 Xóa job:", item.id);
      await deletePrinted(item.id);
    } catch (err) {
      console.error("❌ In thất bại → trả về pending");
      await setStatus(item.id, "pending");
    }
  }
}

setInterval(worker, 2000);
