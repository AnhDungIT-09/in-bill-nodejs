const puppeteer = require("puppeteer");
const Jimp = require("jimp");
const net = require("net");
const axios = require("axios");

const API_URL = "https://dinhdungit.click/BackEndZaloFnB/api/in/in.php";

const PRINTER_IP = "192.168.1.110";
const PRINTER_PORT = 9100;

// Khổ in 80mm
const CANVAS_WIDTH = 576; // printable max (203dpi * 72mm)
const PRINT_WIDTH = 560; // nội dung chuẩn
const MACHINE_OFFSET = 12; // bù lệch máy in (XPrinter/TSC lệch trái)

// ==========================
//  HÀM API
// ==========================
async function getPrintQueue() {
  const res = await axios.post(API_URL, { action: "get_all" });
  return res.data.data || [];
}

async function deletePrinted(id) {
  await axios.post(API_URL, { action: "delete", id });
}

async function setStatus(id, status) {
  await axios.post(API_URL, {
    action: "set_status",
    id,
    status,
  });
}

// ==========================
//  XỬ LÝ IN
// ==========================
async function printHTML(html) {
  console.log("🔄 Render HTML...");

  // 1. Render HTML → PNG
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    defaultViewport: { width: CANVAS_WIDTH, height: 800 },
  });

  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0" });

  await page.screenshot({ path: "label.png", fullPage: true });

  await browser.close();

  // 2. Xử lý PNG
  const img = await Jimp.read("label.png");

  img.greyscale().contrast(0.4).brightness(0.1).resize(PRINT_WIDTH, Jimp.AUTO);

  // Canvas 576px để canh giữa
  const canvas = new Jimp(CANVAS_WIDTH, img.bitmap.height, 0xffffffff);

  const centerOffset = Math.floor((CANVAS_WIDTH - PRINT_WIDTH) / 2);
  const finalOffset = centerOffset + MACHINE_OFFSET;

  canvas.composite(img, finalOffset, 0);

  // Debug hình đã canh giữa
  await canvas.writeAsync("debug_centered.png");

  const width = canvas.bitmap.width;
  const height = canvas.bitmap.height;

  const bytesPerRow = Math.ceil(width / 8);
  const bitmap = Buffer.alloc(bytesPerRow * height);

  // Convert sang bitmap mono
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const pixel = canvas.bitmap.data[idx];

      if (pixel < 160) {
        bitmap[y * bytesPerRow + (x >> 3)] |= 0x80 >> x % 8;
      }
    }
  }

  // 3. Gửi lệnh TSPL
  let tspl = "";
  tspl += "SIZE 80 mm,80 mm\r\n";
  tspl += "GAP 2 mm,0 mm\r\n";
  tspl += "CLS\r\n";

  tspl += `BITMAP 0,10,${bytesPerRow},${height},0,`;

  const header = Buffer.from(tspl, "ascii");
  const footer = Buffer.from("\r\nPRINT 1\r\n", "ascii");

  const printCmd = Buffer.concat([header, bitmap, footer]);

  // 4. Gửi tới máy in
  console.log("🖨 Đang gửi lệnh in...");

  return new Promise((resolve, reject) => {
    const client = new net.Socket();

    client.connect(PRINTER_PORT, PRINTER_IP, () => {
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
}

// ==========================
//  WORKER CHÍNH
// ==========================
async function worker() {
  const queue = await getPrintQueue();

  if (!queue.length) {
    return;
  }

  console.log(`📦 Có ${queue.length} job mới`);
  for (const item of queue) {
    console.log("🔒 Đánh dấu printing:", item.id);
    await setStatus(item.id, "printing");

    try {
      await printHTML(item.html);

      console.log("🗑 Xóa item:", item.id);
      await deletePrinted(item.id);
    } catch (err) {
      console.error("❌ Lỗi in → trả lại pending");
      await setStatus(item.id, "pending");
    }
  }
}

// chạy worker mỗi 2 giây
setInterval(worker, 1000);
