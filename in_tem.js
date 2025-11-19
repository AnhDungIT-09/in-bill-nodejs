const Jimp = require("jimp");
const fs = require("fs");
const net = require("net");
const axios = require("axios");
const htmlToText = require("html-to-text");

// ==============================
// CONFIG
// ==============================
const API_URL = "https://dinhdungit.click/BackEndZaloFnB/api/in/in.php";
const PRINTER_IP = "192.168.1.110";
const PRINTER_PORT = 9100;

const CANVAS_WIDTH = 576; // 80mm
const PRINT_WIDTH = 540;
const PADDING_LEFT = 20;
const PADDING_TOP = 20;
const LINE_SPACING = 2;
const FONT_SIZE = 16; // Giảm từ 18 xuống 16

let FONT_NORMAL;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ==============================
// LOAD FONT - Dùng font built-in của Jimp
// ==============================
async function loadFonts() {
  // Load font built-in 16px của Jimp (hỗ trợ Latin cơ bản)
  FONT_NORMAL = await Jimp.loadFont(Jimp.FONT_SANS_16_BLACK);
  console.log("✔ Loaded Jimp built-in font 16px");

  // Test font
  try {
    const testImg = new Jimp(576, 150, 0xffffffff);
    const testLines = [
      "PHIEU XUAT KHO",
      "#REQ004",
      "Chi nhanh: Bun Bo 1991",
      "Ngay: 17/11/2025 12:56:22",
      "Trang thai: Hoan thanh",
    ];

    let y = 10;
    for (const line of testLines) {
      await testImg.print(FONT_NORMAL, 20, y, line);
      y += 22;
    }

    await testImg.writeAsync("test_font_preview.png");
    console.log("✔ Font test saved: test_font_preview.png");
  } catch (e) {
    console.log("⚠ Warning: Font test failed -", e.message);
  }
}

// ==============================
// API QUEUE
// ==============================
async function getPrintQueue() {
  try {
    const res = await axios.post(API_URL, { action: "get_all" });
    return res.data.data || [];
  } catch (e) {
    console.log("Lỗi API:", e.message);
    return [];
  }
}

async function deletePrinted(id) {
  try {
    await axios.post(API_URL, { action: "delete", id });
    console.log(`🗑 Đã xóa job #${id}`);
    return true;
  } catch (e) {
    console.log("Lỗi delete:", e.message);
    return false;
  }
}

// ==============================
// BỎ DẤU TIẾNG VIỆT
// ==============================
function removeDiacritics(str) {
  const diacriticsMap = {
    á: "a",
    à: "a",
    ả: "a",
    ã: "a",
    ạ: "a",
    ă: "a",
    ắ: "a",
    ằ: "a",
    ẳ: "a",
    ẵ: "a",
    ặ: "a",
    â: "a",
    ấ: "a",
    ầ: "a",
    ẩ: "a",
    ẫ: "a",
    ậ: "a",
    é: "e",
    è: "e",
    ẻ: "e",
    ẽ: "e",
    ẹ: "e",
    ê: "e",
    ế: "e",
    ề: "e",
    ể: "e",
    ễ: "e",
    ệ: "e",
    í: "i",
    ì: "i",
    ỉ: "i",
    ĩ: "i",
    ị: "i",
    ó: "o",
    ò: "o",
    ỏ: "o",
    õ: "o",
    ọ: "o",
    ô: "o",
    ố: "o",
    ồ: "o",
    ổ: "o",
    ỗ: "o",
    ộ: "o",
    ơ: "o",
    ớ: "o",
    ờ: "o",
    ở: "o",
    ỡ: "o",
    ợ: "o",
    ú: "u",
    ù: "u",
    ủ: "u",
    ũ: "u",
    ụ: "u",
    ư: "u",
    ứ: "u",
    ừ: "u",
    ử: "u",
    ữ: "u",
    ự: "u",
    ý: "y",
    ỳ: "y",
    ỷ: "y",
    ỹ: "y",
    ỵ: "y",
    đ: "d",
    Á: "A",
    À: "A",
    Ả: "A",
    Ã: "A",
    Ạ: "A",
    Ă: "A",
    Ắ: "A",
    Ằ: "A",
    Ẳ: "A",
    Ẵ: "A",
    Ặ: "A",
    Â: "A",
    Ấ: "A",
    Ầ: "A",
    Ẩ: "A",
    Ẫ: "A",
    Ậ: "A",
    É: "E",
    È: "E",
    Ẻ: "E",
    Ẽ: "E",
    Ẹ: "E",
    Ê: "E",
    Ế: "E",
    Ề: "E",
    Ể: "E",
    Ễ: "E",
    Ệ: "E",
    Í: "I",
    Ì: "I",
    Ỉ: "I",
    Ĩ: "I",
    Ị: "I",
    Ó: "O",
    Ò: "O",
    Ỏ: "O",
    Õ: "O",
    Ọ: "O",
    Ô: "O",
    Ố: "O",
    Ồ: "O",
    Ổ: "O",
    Ỗ: "O",
    Ộ: "O",
    Ơ: "O",
    Ớ: "O",
    Ờ: "O",
    Ở: "O",
    Ỡ: "O",
    Ợ: "O",
    Ú: "U",
    Ù: "U",
    Ủ: "U",
    Ũ: "U",
    Ụ: "U",
    Ư: "U",
    Ứ: "U",
    Ừ: "U",
    Ử: "U",
    Ữ: "U",
    Ự: "U",
    Ý: "Y",
    Ỳ: "Y",
    Ỷ: "Y",
    Ỹ: "Y",
    Ỵ: "Y",
    Đ: "D",
  };

  return str
    .split("")
    .map((char) => diacriticsMap[char] || char)
    .join("");
}

// ==============================
// XỬ LÝ FORMAT TEXT - Giống template HTML
// ==============================
function formatText(text) {
  const lines = text.split("\n");
  const result = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    const nextLine = lines[i + 1] ? lines[i + 1].trim() : "";

    // Nhận diện format: "1x50.000d = 50.000d" (cả 2 giá trên cùng dòng)
    if (nextLine.match(/^\d+x[\d.]+d\s*=\s*[\d.]+d$/)) {
      // Tên món bên trái, giá bên phải
      const maxWidth = 52;
      const itemName = line.length > 34 ? line.substring(0, 34) : line;
      const price = nextLine;

      const padding = maxWidth - itemName.length - price.length;
      const spaces = padding > 0 ? " ".repeat(padding) : " ";

      result.push(itemName + spaces + price);
      i++; // Bỏ qua dòng giá
    }
    // Nhận diện format riêng: "1x50.000d" trên 1 dòng, "= 50.000d" dòng sau
    else if (nextLine.match(/^\d+x[\d.]+d$/)) {
      const nextNextLine = lines[i + 2] ? lines[i + 2].trim() : "";

      // Nếu dòng thứ 3 là "= xxx"
      if (nextNextLine.match(/^=\s*[\d.]+d$/)) {
        const maxWidth = 52;
        const itemName = line.length > 34 ? line.substring(0, 34) : line;
        const combinedPrice = nextLine + " " + nextNextLine;

        const padding = maxWidth - itemName.length - combinedPrice.length;
        const spaces = padding > 0 ? " ".repeat(padding) : " ";

        result.push(itemName + spaces + combinedPrice);
        i += 2; // Bỏ qua 2 dòng giá
      } else {
        // Chỉ có giá đơn giản
        const maxWidth = 52;
        const itemName = line.length > 34 ? line.substring(0, 34) : line;
        const price = nextLine;

        const padding = maxWidth - itemName.length - price.length;
        const spaces = padding > 0 ? " ".repeat(padding) : " ";

        result.push(itemName + spaces + price);
        i++;
      }
    }
    // Nhận diện TỔNG CỘNG
    else if (line.match(/^TONG CONG$/i)) {
      result.push("");
      result.push(line);
      // Dòng tiếp theo là số tiền
      if (nextLine.match(/^[\d.]+d$/)) {
        result.push(nextLine);
        i++;
      }
    } else {
      result.push(line);
    }
  }

  return result.join("\n");
}

// ==============================
// HTML → TEXT → PNG bằng JIMP
// ==============================
async function htmlToPNG(html, output = "label.png") {
  console.log("🔄 Chuyển HTML → TEXT → PNG…");

  // Log HTML gốc để debug
  console.log("HTML gốc:", html.substring(0, 200) + "...");

  const text = htmlToText.convert(html, {
    wordwrap: 50, // Giảm xuống 50 để tên món dài tự xuống dòng
    preserveNewlines: true,
    formatters: {
      formatBlock: (elem, walk, builder, formatOptions) => {
        builder.addInline(elem.text || "", { leadingLineBreaks: 1 });
      },
    },
  });

  // BỎ DẤU TIẾNG VIỆT
  let textNoDiacritics = removeDiacritics(text);

  // LOẠI BỎ KHOẢNG TRẮNG THỪA (nhiều space thành 1 space)
  textNoDiacritics = textNoDiacritics
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n");

  console.log("========== TEXT TRƯỚC KHI FORMAT ==========");
  console.log(textNoDiacritics);
  console.log("===========================================");

  // FORMAT: Ghép giá với tên món
  const textFormatted = formatText(textNoDiacritics);

  console.log("========== TEXT SAU KHI FORMAT ==========");
  console.log(textFormatted);
  console.log("=========================================");

  const lines = textFormatted.split("\n").map((l) => l.trimEnd());

  // Tính chiều cao
  let height = PADDING_TOP;
  for (const line of lines) {
    if (line.trim() === "") {
      height += 5;
    } else {
      height += FONT_SIZE + LINE_SPACING;
    }
  }
  height += 20;

  if (height < 200) height = 200;

  const img = new Jimp(CANVAS_WIDTH, height, 0xffffffff);

  let y = PADDING_TOP;

  for (const line of lines) {
    if (line.trim() === "") {
      y += 5;
    } else {
      await img.print(FONT_NORMAL, PADDING_LEFT, y, line, PRINT_WIDTH);
      y += FONT_SIZE + LINE_SPACING;
    }
  }

  await img.writeAsync(output);
  console.log("✔ Đã tạo PNG:", output);

  return output;
}

// ==============================
// PNG → TSPL
// ==============================
async function printPNG_TSPL(path) {
  console.log("➡ Xử lý ảnh để in TSPL…");

  const img = await Jimp.read(path);

  // Tăng độ tương phản và làm chữ đậm hơn
  img.greyscale().contrast(0.6).posterize(2);

  const width = img.bitmap.width;
  const height = img.bitmap.height;

  const bytesPerRow = Math.ceil(width / 8);
  const bitmap = Buffer.alloc(bytesPerRow * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      if (img.bitmap.data[idx] < 128) {
        bitmap[y * bytesPerRow + (x >> 3)] |= 0x80 >> x % 8;
      }
    }
  }

  const heightMM = Math.ceil(height / 8 + 6);

  const headerText =
    `SIZE 80 mm,${heightMM} mm\r\n` +
    `GAP 2 mm,0 mm\r\nCLS\r\n` +
    `BITMAP 0,10,${bytesPerRow},${height},0,`;

  const header = Buffer.from(headerText, "ascii");
  const footer = Buffer.from("\r\nPRINT 1\r\n", "ascii");
  const printData = Buffer.concat([header, bitmap, footer]);

  console.log("🖨 Đang gửi lệnh TSPL…");

  return new Promise((resolve, reject) => {
    const client = new net.Socket();

    client.connect(PRINTER_PORT, PRINTER_IP, () => {
      client.write(printData, (err) => {
        if (err) return reject(err);
        client.end();
        console.log("✔ In thành công!");
        resolve();
      });
    });

    client.on("error", (err) => {
      console.log("❌ Lỗi kết nối máy in:", err.message);
      reject(err);
    });

    client.on("timeout", () => {
      console.log("⏱ Timeout kết nối máy in");
      client.destroy();
      reject(new Error("Connection timeout"));
    });

    client.setTimeout(5000);
  });
}

// ==============================
// WORKER
// ==============================
async function worker() {
  const queue = await getPrintQueue();
  if (!queue.length) return;

  console.log(`📦 Có ${queue.length} job mới`);

  for (const job of queue) {
    console.log(`➡ Xử lý job #${job.id}`);

    try {
      const png = await htmlToPNG(job.html, `label_${job.id}.png`);
      await printPNG_TSPL(png);

      // Xóa job sau khi in thành công
      await deletePrinted(job.id);
      await sleep(200);

      // KHÔNG xóa file PNG để kiểm tra
      console.log(`✅ File PNG đã lưu tại: ${png} (không xóa để kiểm tra)`);
    } catch (err) {
      console.log("❌ Lỗi in job:", err.message);
    }
  }
}

// ==============================
// START
// ==============================
(async () => {
  console.log("🚀 TSPL Printer Worker - Starting...");

  await loadFonts();

  console.log("✅ Worker TSPL đang chạy (BỎ DẤU TIẾNG VIỆT)…");
  console.log(`📡 API: ${API_URL}`);
  console.log(`🖨 Printer: ${PRINTER_IP}:${PRINTER_PORT}`);
  console.log("⏱ Polling interval: 2s\n");

  worker();
  setInterval(worker, 2000);
})();
