const puppeteer = require("puppeteer");
const Jimp = require("jimp");
const net = require("net");
const axios = require("axios");

const API_URL = "https://dinhdungit.click/BackEndZaloFnB/api/in/in.php";

const PRINTER_IP = "192.168.1.110";
const PRINTER_PORT = 9100;

const CANVAS_WIDTH = 576;
const PRINT_WIDTH = 560;
const MACHINE_OFFSET = 12;

// ============== API ==============
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

// ============== IN HTML ==============
async function printHTML(html) {
  console.log("\n===============================");
  console.log("🖨 BẮT ĐẦU QUY TRÌNH IN");
  console.log("===============================\n");

  try {
    console.log("1️⃣  Render HTML bằng Puppeteer...");

    const browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      defaultViewport: { width: CANVAS_WIDTH, height: 800 },
    });

    const page = await browser.newPage();
    console.log("   → Set nội dung HTML");
    await page.setContent(html, { waitUntil: "networkidle0" });

    console.log("   → Chụp screenshot label.png");
    await page.screenshot({ path: "label.png", fullPage: true });

    await browser.close();
    console.log("   ✔ Render HTML xong");

    // =====================
    console.log("2️⃣  Load PNG + chuyển grayscale...");

    const img = await Jimp.read("label.png");
    console.log(
      "   → Kích thước PNG gốc:",
      img.bitmap.width,
      "x",
      img.bitmap.height
    );

    img
      .greyscale()
      .contrast(0.4)
      .brightness(0.1)
      .resize(PRINT_WIDTH, Jimp.AUTO);

    console.log("   ✔ Resize xong, width =", PRINT_WIDTH);

    // =====================
    console.log("3️⃣  Canh giữa với canvas 576px...");
    const canvas = new Jimp(CANVAS_WIDTH, img.bitmap.height, 0xffffffff);

    const centerOffset = Math.floor((CANVAS_WIDTH - PRINT_WIDTH) / 2);
    const finalOffset = centerOffset + MACHINE_OFFSET;

    console.log("   → Offset giữa =", centerOffset);
    console.log("   → Offset thực (bù lệch máy) =", finalOffset);

    canvas.composite(img, finalOffset, 0);

    await canvas.writeAsync("debug_centered.png");
    console.log("   ✔ Xuất debug_centered.png OK");

    // =====================
    console.log("4️⃣  Convert sang mono bitmap...");

    const width = canvas.bitmap.width;
    const height = canvas.bitmap.height;

    console.log("   → Canvas =", width, "x", height);

    const bytesPerRow = Math.ceil(width / 8);
    console.log("   → bytesPerRow =", bytesPerRow);

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

    console.log("   ✔ Convert bitmap xong, tổng bytes =", bitmap.length);

    // =====================
    console.log("5️⃣  Chuẩn bị lệnh TSPL...");

    let tspl = "";
    tspl += "SIZE 80 mm,80 mm\r\n";
    tspl += "GAP 2 mm,0 mm\r\n";
    tspl += "CLS\r\n";
    tspl += `BITMAP 0,10,${bytesPerRow},${height},0,`;

    const header = Buffer.from(tspl, "ascii");
    const footer = Buffer.from("\r\nPRINT 1\r\n", "ascii");
    const printCmd = Buffer.concat([header, bitmap, footer]);

    console.log("   → Tổng bytes gửi đến máy in =", printCmd.length);

    // =====================
    console.log("6️⃣  Gửi tới máy in...");

    return await new Promise((resolve, reject) => {
      const client = new net.Socket();

      client.connect(PRINTER_PORT, PRINTER_IP, () => {
        console.log("📡 Đã kết nối máy in !!!");
        client.write(printCmd, () => {
          console.log("✅ ĐÃ GỬI LỆNH IN XONG");
          client.end();
          resolve();
        });
      });

      client.on("error", (err) => {
        console.error("❌ LỖI MÁY IN:", err);
        reject(err);
      });
    });
  } catch (err) {
    console.error("🔥 LỖI TRONG printHTML:", err);
    throw err;
  }
}

// ============== WORKER ==============
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
    console.log(`\n==============================`);
    console.log(`▶ Xử lý job ID = ${item.id}`);
    console.log("==============================");

    await setStatus(item.id, "printing");

    try {
      await printHTML(item.html);

      console.log("🗑 Xóa job sau khi in:", item.id);
      await deletePrinted(item.id);
    } catch (err) {
      console.error("❌ In thất bại → trả về pending");
      await setStatus(item.id, "pending");
    }
  }
}

setInterval(worker, 2000);
