const Jimp = require("jimp");
const net = require("net");
const axios = require("axios");

// ==================== CONFIG ====================
const API_URL = "https://dinhdungit.click/BackEndZaloFnB/api/in/print.php";

const PRINTER_IP = "192.168.1.110";
const PRINTER_PORT = 9100;

const WIDTH = 576; // Khổ in 80mm chuẩn 203dpi
const PADDING = 20;

// ==================== HELPERS ====================
function price(num) {
  return Number(num).toLocaleString("vi-VN");
}

function drawSeparator(img, y) {
  img.scan(20, y, WIDTH - 40, 2, function (x, y2, idx) {
    this.bitmap.data[idx] = 0; // black
    this.bitmap.data[idx + 1] = 0;
    this.bitmap.data[idx + 2] = 0;
    this.bitmap.data[idx + 3] = 255; // opacity
  });
}

function printLine(img, font, text, y) {
  img.print(font, PADDING, y, text, WIDTH - PADDING * 2);
  return y + 30; // line height
}

function printSectionTitle(img, font, text, y) {
  img.print(
    font,
    0,
    y,
    { text, alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER },
    WIDTH
  );
  return y + 40;
}

// ==================== API QUEUE ====================
async function getPrintQueue() {
  const res = await axios.post(API_URL, { action: "get_all" });
  return res.data.data || [];
}

async function deletePrinted(id) {
  await axios.post(API_URL, { action: "delete", id });
}

async function setStatus(id, status) {
  await axios.post(API_URL, { action: "set_status", id, status });
}

// ==================== DRAW TEXT ====================
async function drawReceipt(data) {
  const fontTitle = await Jimp.loadFont(Jimp.FONT_SANS_32_BLACK);
  const fontNormal = await Jimp.loadFont(Jimp.FONT_SANS_16_BLACK);
  const fontBold = await Jimp.loadFont(Jimp.FONT_SANS_32_BLACK);

  let y = 20;

  // Tạo canvas lớn trước
  const img = new Jimp(WIDTH, 4000, 0xffffffff);

  // ===== TITLE =====
  img.print(
    fontTitle,
    0,
    y,
    { text: "HÓA ĐƠN BÁN HÀNG", alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER },
    WIDTH
  );
  y += 50;

  img.print(
    fontNormal,
    0,
    y,
    { text: `#${data.order_id}`, alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER },
    WIDTH
  );
  y += 40;

  drawSeparator(img, y);
  y += 20;

  // ===== ORDER INFORMATION =====
  y = printLine(img, fontNormal, `Chi nhánh: ${data.branch}`, y);
  y = printLine(img, fontNormal, `Ngày: ${data.time}`, y);
  y = printLine(img, fontNormal, `Trạng thái: ${data.status}`, y);

  drawSeparator(img, y);
  y += 20;

  // ===== CUSTOMER INFO =====
  y = printSectionTitle(img, fontNormal, "Thông tin khách hàng", y);
  y = printLine(img, fontNormal, `Tên: ${data.customer}`, y);
  y = printLine(img, fontNormal, `SĐT: ${data.phone}`, y);
  y = printLine(img, fontNormal, `Địa chỉ: ${data.address}`, y);

  drawSeparator(img, y);
  y += 20;

  // ===== ITEMS =====
  y = printSectionTitle(img, fontNormal, "Chi tiết đơn hàng", y);

  data.items.forEach((p) => {
    y = printLine(img, fontNormal, p.name, y);
    y = printLine(
      img,
      fontNormal,
      `${p.quantity} x ${price(p.price)} = ${price(p.price * p.quantity)}đ`,
      y
    );
    y += 10;
  });

  // ===== TOTAL =====
  drawSeparator(img, y);
  y += 20;

  img.print(
    fontBold,
    0,
    y,
    { text: "TỔNG CỘNG", alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER },
    WIDTH
  );
  y += 45;

  img.print(
    fontBold,
    0,
    y,
    { text: `${price(data.total)}đ`, alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER },
    WIDTH
  );
  y += 50;

  drawSeparator(img, y);
  y += 20;

  // ===== FOOTER =====
  y = printLine(img, fontNormal, "Nhân viên: ___________________", y);
  y = printLine(img, fontNormal, "Khách hàng: __________________", y);

  img.print(
    fontNormal,
    0,
    y,
    { text: "Cảm ơn quý khách!", alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER },
    WIDTH
  );
  y += 50;

  // Crop lại đúng chiều cao thực
  return img.crop(0, 0, WIDTH, y + 20);
}

// ==================== CONVERT TO BITMAP ====================
function convertToBitmap(img) {
  const width = img.bitmap.width;
  const height = img.bitmap.height;
  const bytesPerRow = Math.ceil(width / 8);

  const buffer = Buffer.alloc(bytesPerRow * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const pixel = img.bitmap.data[idx];

      if (pixel < 128) {
        buffer[y * bytesPerRow + (x >> 3)] |= 0x80 >> x % 8;
      }
    }
  }

  return { buffer, bytesPerRow, height };
}

// ==================== SEND TO PRINTER ====================
function sendToPrinter(bitmap, bytesPerRow, height) {
  return new Promise((resolve, reject) => {
    let cmd = "";
    cmd += "SIZE 80 mm,100 mm\r\n";
    cmd += "GAP 2 mm,0 mm\r\n";
    cmd += "CLS\r\n";
    cmd += `BITMAP 0,0,${bytesPerRow},${height},0,`;

    const header = Buffer.from(cmd, "ascii");
    const footer = Buffer.from("\r\nPRINT 1\r\n", "ascii");

    const sendData = Buffer.concat([header, bitmap, footer]);

    const client = new net.Socket();
    client.connect(PRINTER_PORT, PRINTER_IP, () => {
      client.write(sendData, () => {
        client.end();
        resolve();
      });
    });

    client.on("error", reject);
  });
}

// ==================== WORKER ====================
async function worker() {
  const queue = await getPrintQueue();
  if (!queue.length) return;
  console.log(queue);
  for (const item of queue) {
    const data = JSON.parse(item.data);

    await setStatus(item.id, "printing");

    try {
      const img = await drawReceipt(data);
      const { buffer, bytesPerRow, height } = convertToBitmap(img);
      await sendToPrinter(buffer, bytesPerRow, height);

      await deletePrinted(item.id);
    } catch (e) {
      console.error("❌ Lỗi khi in job:", item.id);
      console.error(e);
      await setStatus(item.id, "pending");
    }
  }
}

setInterval(worker, 2000);
