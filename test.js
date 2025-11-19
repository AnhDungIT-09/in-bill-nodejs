const nodeHtmlToImage = require("node-html-to-image");
const Jimp = require("jimp");
const fs = require("fs");
const net = require("net");
const axios = require("axios");

const API_URL = "https://dinhdungit.click/BackEndZaloFnB/api/in/in.php";
const PRINTER_IP = "192.168.1.110";
const PRINTER_PORT = 9100;

const CANVAS_WIDTH = 576;
const PRINT_WIDTH = 560;
const MACHINE_OFFSET = 12;

// ==========================
//  HÀM API
// ==========================
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getPrintQueue() {
  try {
    const res = await axios.post(API_URL, { action: "get_all" });
    return res.data.data || [];
  } catch (err) {
    console.error("❌ Lỗi API getPrintQueue:", err.message);
    return [];
  }
}

async function deletePrinted(id) {
  try {
    const response = await axios.post(API_URL, { action: "delete", id });

    if (response.data.success) {
      console.log(`✅ Đã xóa job #${id} khỏi queue`);
      return true;
    } else {
      console.error(`⚠️ API báo lỗi xóa job #${id}:`, response.data.message);
      return false;
    }
  } catch (err) {
    console.error(`❌ Lỗi API deletePrinted #${id}:`, err.message);
    return false;
  }
}

async function setStatus(id, status) {
  try {
    await axios.post(API_URL, {
      action: "set_status",
      id,
      status,
    });
    console.log(`📝 Đã set status job #${id} = ${status}`);
  } catch (err) {
    console.error(`❌ Lỗi API setStatus #${id}:`, err.message);
  }
}

// ==========================
//  RENDER HTML → PNG
// ==========================
async function printHTML(html) {
  console.log("🔄 Render HTML...");

  try {
    // 1. Render HTML → PNG với node-html-to-image
    await nodeHtmlToImage({
      output: "./label.png",
      html: html,
      type: "png",
      puppeteerArgs: {
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      },
      beforeScreenshot: async (page) => {
        await page.setViewport({
          width: CANVAS_WIDTH,
          height: 100,
          deviceScaleFactor: 2,
        });

        await page.evaluateHandle("document.fonts.ready");
        await sleep(500);

        const dimensions = await page.evaluate(() => {
          const body = document.body;
          const html = document.documentElement;

          return {
            scrollHeight: Math.max(
              body.scrollHeight,
              body.offsetHeight,
              html.clientHeight,
              html.scrollHeight,
              html.offsetHeight
            ),
          };
        });

        const finalHeight = dimensions.scrollHeight + 50;

        console.log(`📏 Chiều cao tính được: ${dimensions.scrollHeight}px`);
        console.log(`📏 Chiều cao cuối cùng: ${finalHeight}px`);

        await page.setViewport({
          width: CANVAS_WIDTH,
          height: finalHeight,
          deviceScaleFactor: 2,
        });

        await sleep(300);
      },
    });

    console.log("✅ Đã render HTML → PNG");

    // 2. Xử lý ảnh với Jimp
    let img = await Jimp.read("label.png");
    img.greyscale().contrast(0.4).brightness(0.1);
    img.resize(PRINT_WIDTH, Jimp.AUTO);

    // 3. Tạo canvas lớn hơn để canh giữa
    const canvas = new Jimp(CANVAS_WIDTH, img.bitmap.height, 0xffffffff);
    const centerOffset = Math.floor((CANVAS_WIDTH - PRINT_WIDTH) / 2);
    const finalOffset = centerOffset + MACHINE_OFFSET;
    canvas.composite(img, finalOffset, 0);

    await canvas.writeAsync("debug_centered.png");
    console.log("✅ Đã lưu debug_centered.png");

    // 4. Convert sang bitmap mono
    const width = canvas.bitmap.width;
    const height = canvas.bitmap.height;
    const bytesPerRow = Math.ceil(width / 8);
    const bitmap = Buffer.alloc(bytesPerRow * height);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const pixel = canvas.bitmap.data[idx];

        if (pixel < 128) {
          bitmap[y * bytesPerRow + (x >> 3)] |= 0x80 >> x % 8;
        }
      }
    }

    // 5. Tạo lệnh TSPL
    const heightMM = Math.ceil(height / 8 + 10);
    console.log(`📏 Chiều cao ảnh: ${height}px`);
    console.log(`📏 Chiều cao giấy: ${heightMM}mm`);

    let tspl = `SIZE 80 mm,${heightMM} mm\r\nGAP 2 mm,0 mm\r\nCLS\r\nBITMAP 0,10,${bytesPerRow},${height},0,`;
    const header = Buffer.from(tspl, "ascii");
    const footer = Buffer.from("\r\nPRINT 1\r\n", "ascii");
    const printCmd = Buffer.concat([header, bitmap, footer]);

    // 6. Gửi tới máy in
    console.log("🖨 Đang gửi lệnh in...");

    return new Promise((resolve, reject) => {
      const client = new net.Socket();
      client.setTimeout(10000);

      client.connect(PRINTER_PORT, PRINTER_IP, () => {
        console.log("✅ Đã kết nối máy in");
        client.write(printCmd, (err) => {
          if (err) {
            console.error("❌ Lỗi ghi dữ liệu:", err.message);
            reject(err);
          } else {
            console.log("✅ In xong!");
            client.end();
            resolve();
          }
        });
      });

      client.on("error", (err) => {
        console.error("❌ Lỗi máy in:", err.message);
        reject(err);
      });

      client.on("timeout", () => {
        console.error("❌ Timeout kết nối máy in");
        client.destroy();
        reject(new Error("Printer timeout"));
      });
    });
  } catch (err) {
    console.error("❌ Lỗi printHTML:", err.message);
    throw err;
  }
}

// ==========================
//  WORKER CHÍNH (FIXED)
// ==========================
async function worker() {
  try {
    const queue = await getPrintQueue();

    if (!queue.length) {
      return;
    }

    console.log(`\n📦 Có ${queue.length} job mới`);

    for (const item of queue) {
      console.log(`\n${"=".repeat(50)}`);
      console.log(`🔒 Đang xử lý job #${item.id}`);

      try {
        // ✅ BƯỚC 1: XÓA JOB NGAY ĐỂ TRÁNH IN LẶP
        console.log(`🗑 Xóa job #${item.id} khỏi queue trước khi in...`);
        const deleted = await deletePrinted(item.id);

        if (!deleted) {
          console.error(`⚠️ Không xóa được job #${item.id}, bỏ qua`);
          continue;
        }

        // Đợi 300ms để DB update
        await sleep(300);

        // ✅ BƯỚC 2: IN
        await printHTML(item.html);

        console.log(`✅ Hoàn thành job #${item.id}`);
        console.log(`${"=".repeat(50)}\n`);
      } catch (err) {
        console.error(`❌ Lỗi in job #${item.id}:`, err.message);
        console.log(`${"=".repeat(50)}\n`);
        // Job đã bị xóa rồi nên không retry
      }
    }
  } catch (err) {
    console.error("❌ Lỗi worker:", err.message);
  }
}

// ==========================
//  CHẠY WORKER
// ==========================
console.log("🚀 Print Worker đang khởi động...");
console.log(`📡 API: ${API_URL}`);
console.log(`🖨 Printer: ${PRINTER_IP}:${PRINTER_PORT}`);
console.log(`📏 Canvas: ${CANVAS_WIDTH}px, Print: ${PRINT_WIDTH}px\n`);

// Chạy worker mỗi 2 giây
setInterval(worker, 2000);

// Chạy ngay lần đầu
worker();
