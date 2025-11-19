const Jimp = require("jimp");
const fs = require("fs");
const net = require("net");
const axios = require("axios");
const htmlToText = require("html-to-text");

const API_URL = "https://dinhdungit.click/BackEndZaloFnB/api/in/in.php";
const PRINTER_IP = "192.168.1.110";
const PRINTER_PORT = 9100;

const CANVAS_WIDTH = 576; // 80mm printer
const PRINT_WIDTH = 520; // nội dung
const PADDING = 20; // padding lề
const FONT_SIZE = 24; // cỡ chữ
const LINE_SPACING = 8;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/*************************************************************
 * 1) Lấy QUEUE từ API
 *************************************************************/
async function getPrintQueue() {
  try {
    const res = await axios.post(API_URL, { action: "get_all" });
    return res.data.data || [];
  } catch (err) {
    console.log("API lỗi:", err.message);
    return [];
  }
}

async function deletePrinted(id) {
  try {
    await axios.post(API_URL, { action: "delete", id });
    console.log(`Đã xóa job #${id}`);
    return true;
  } catch (err) {
    console.log("Lỗi xoá job:", err.message);
    return false;
  }
}

/*************************************************************
 * 2) HTML → TEXT → PNG bằng Jimp
 *************************************************************/
async function htmlToPNG(html, outputFile = "label.png") {
  console.log("Chuyển HTML → TEXT…");

  let text = htmlToText.convert(html, {
    wordwrap: 9999,
    preserveNewlines: true,
  });

  const font = await Jimp.loadFont(Jimp.FONT_SANS_32_BLACK);

  const lines = text.split("\n").map((l) => l.trimEnd());
  let height = PADDING;

  // tính chiều cao
  for (const line of lines) {
    height += FONT_SIZE + LINE_SPACING;
  }
  height += PADDING * 2;

  const img = new Jimp(CANVAS_WIDTH, height, 0xffffffff);

  let y = PADDING;

  for (const line of lines) {
    await img.print(font, PADDING, y, line, PRINT_WIDTH);
    y += FONT_SIZE + LINE_SPACING;
  }

  await img.writeAsync(outputFile);
  console.log("Đã tạo PNG:", outputFile);

  return outputFile;
}

/*************************************************************
 * 3) PNG → BITMAP → TSPL
 *************************************************************/
async function printPNG_TSPL(path) {
  console.log("Xử lý PNG để in TSPL...");

  const img = await Jimp.read(path);
  img.greyscale().contrast(0.4).brightness(0.05);

  const width = img.bitmap.width;
  const height = img.bitmap.height;

  const bytesPerRow = Math.ceil(width / 8);
  const bitmap = Buffer.alloc(bytesPerRow * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const pixel = img.bitmap.data[idx];
      if (pixel < 128) {
        bitmap[y * bytesPerRow + (x >> 3)] |= 0x80 >> x % 8;
      }
    }
  }

  const heightMM = Math.ceil(height / 8 + 6);

  let tspl =
    `SIZE 80 mm,${heightMM} mm\r\n` +
    `GAP 2 mm,0 mm\r\n` +
    `CLS\r\n` +
    `BITMAP 0,20,${bytesPerRow},${height},0,`;

  const header = Buffer.from(tspl, "ascii");
  const footer = Buffer.from("\r\nPRINT 1\r\n", "ascii");
  const printData = Buffer.concat([header, bitmap, footer]);

  console.log("Đang gửi lệnh TSPL...");

  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    client.connect(PRINTER_PORT, PRINTER_IP, () => {
      client.write(printData, (err) => {
        if (err) return reject(err);
        client.end();
        console.log("In thành công!");
        resolve();
      });
    });
    client.on("error", reject);
  });
}

/*************************************************************
 * 4) WORKER QUEUE
 *************************************************************/
async function worker() {
  const queue = await getPrintQueue();
  if (!queue.length) return;

  console.log(`Có ${queue.length} job`);

  for (const job of queue) {
    console.log(`Xử lý job #${job.id}`);

    await deletePrinted(job.id);
    await sleep(200);

    try {
      const png = await htmlToPNG(job.html);
      await printPNG_TSPL(png);
    } catch (err) {
      console.log("Lỗi in:", err.message);
    }
  }
}

/*************************************************************
 * 5) RUN LOOP
 *************************************************************/
console.log("=== WORKER JIMP + TSPL ===");
console.log("Printer:", PRINTER_IP);
console.log("Canvas:", CANVAS_WIDTH);

worker();
setInterval(worker, 2000);
