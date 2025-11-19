const Jimp = require("jimp");
const fs = require("fs");
const net = require("net");
const axios = require("axios");
const htmlToImage = require("./render_html_no_browser"); // file tôi viết thêm ở dưới

const API_URL = "https://dinhdungit.click/BackEndZaloFnB/api/in/in.php";
const PRINTER_IP = "192.168.1.110";
const PRINTER_PORT = 9100;

const CANVAS_WIDTH = 576;
const PRINT_WIDTH = 560;
const MACHINE_OFFSET = 12;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ========== API ==========
async function getPrintQueue() {
  try {
    const res = await axios.post(API_URL, { action: "get_all" });
    return res.data.data || [];
  } catch (err) {
    console.log("Lỗi API get_all:", err.message);
    return [];
  }
}

async function deletePrinted(id) {
  try {
    await axios.post(API_URL, { action: "delete", id });
    console.log(`Xóa job #${id}`);
    return true;
  } catch (err) {
    console.log("Lỗi delete:", err.message);
    return false;
  }
}

// ========== RENDER HTML → PNG (KHÔNG BROWSER) ==========
async function renderHTMLtoPNG(htmlString) {
  console.log("Render HTML không dùng browser...");

  const output = "label.png";
  await htmlToImage(htmlString, CANVAS_WIDTH, output);

  console.log("Đã tạo PNG:", output);
  return output;
}

// ========== PNG → TSPL ==========
async function printPNG_TSPL(pngFile) {
  const img = await Jimp.read(pngFile);

  img.greyscale().contrast(0.4).brightness(0.1);
  img.resize(PRINT_WIDTH, Jimp.AUTO);

  const canvas = new Jimp(CANVAS_WIDTH, img.bitmap.height, 0xffffffff);
  const center = Math.floor((CANVAS_WIDTH - PRINT_WIDTH) / 2) + MACHINE_OFFSET;

  canvas.composite(img, center, 0);

  const width = canvas.bitmap.width;
  const height = canvas.bitmap.height;

  const bytesPerRow = Math.ceil(width / 8);
  const bitmap = Buffer.alloc(bytesPerRow * height);

  // Convert pixel → mono bitmap
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      if (canvas.bitmap.data[idx] < 128) {
        bitmap[y * bytesPerRow + (x >> 3)] |= 0x80 >> x % 8;
      }
    }
  }

  const heightMM = Math.ceil(height / 8 + 10);

  const tsplHeader = `SIZE 80 mm,${heightMM} mm\r\nGAP 2 mm,0 mm\r\nCLS\r\nBITMAP 0,10,${bytesPerRow},${height},0,`;
  const header = Buffer.from(tsplHeader, "ascii");
  const footer = Buffer.from("\r\nPRINT 1\r\n", "ascii");

  const printCmd = Buffer.concat([header, bitmap, footer]);

  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    client.connect(PRINTER_PORT, PRINTER_IP, () => {
      console.log("Đang gửi TSPL...");
      client.write(printCmd, (err) => {
        if (err) reject(err);
        else {
          console.log("In xong");
          client.end();
          resolve();
        }
      });
    });

    client.on("error", reject);
  });
}

// ========== WORKER ==========
async function worker() {
  const queue = await getPrintQueue();
  if (!queue.length) return;

  for (const item of queue) {
    console.log(`Job #${item.id}`);

    await deletePrinted(item.id);
    await sleep(200);

    try {
      const png = await renderHTMLtoPNG(item.html);
      await printPNG_TSPL(png);
    } catch (err) {
      console.log("Lỗi in job:", err.message);
    }
  }
}

// ========== LOOP ==========
console.log("Worker TSPL đang chạy...");
worker();
setInterval(worker, 2000);
