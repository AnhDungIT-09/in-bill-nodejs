const Jimp = require("jimp");
const fs = require("fs");
const net = require("net");
const { renderInvoiceCanvas } = require("./renderInvoice");
const { renderRequestCanvas } = require("./renderRequest");

const CANVAS_WIDTH = 576;
const PRINT_WIDTH = 560;
const MACHINE_OFFSET = 12;

/**
 * In ấn dữ liệu ra máy in nhiệt
 * @param {Object} data - Dữ liệu cần in (order hoặc request)
 * @param {string} printerIP - IP máy in
 * @param {number} printerPort - Port máy in
 */
async function printData(data, printerIP, printerPort) {
  console.log("🔄 Bắt đầu xử lý in...");

  try {
    let pngBuffer;

    // Chọn template theo type
    if (data.type === "request") {
      pngBuffer = await renderRequestCanvas(data);
    } else if (data.type === "order") {
      pngBuffer = await renderInvoiceCanvas(data);
    } else {
      throw new Error(`Unknown type: ${data.type}`);
    }

    // Lưu debug
    fs.writeFileSync("label.png", pngBuffer);
    console.log("✅ Đã tạo label.png");

    // Xử lý ảnh với Jimp
    let img = await Jimp.read(pngBuffer);
    img.greyscale().contrast(0.4).brightness(0.1);
    img.resize(PRINT_WIDTH, Jimp.AUTO);

    // Tạo canvas canh giữa (background đen)
    const canvas = new Jimp(CANVAS_WIDTH, img.bitmap.height, 0x000000ff);
    const centerOffset = Math.floor((CANVAS_WIDTH - PRINT_WIDTH) / 2);
    const finalOffset = centerOffset + MACHINE_OFFSET;
    canvas.composite(img, finalOffset, 0);

    await canvas.writeAsync("debug_centered.png");
    console.log("✅ Đã lưu debug_centered.png");

    // Convert sang bitmap mono
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

    // Tạo lệnh TSPL
    const heightMM = Math.ceil(height / 8 + 10);
    console.log(`📏 Chiều cao ảnh: ${height}px`);
    console.log(`📏 Chiều cao giấy: ${heightMM}mm`);

    let tspl = `SIZE 80 mm,${heightMM} mm\r\nGAP 2 mm,0 mm\r\nCLS\r\nBITMAP 0,10,${bytesPerRow},${height},0,`;
    const header = Buffer.from(tspl, "ascii");
    const footer = Buffer.from("\r\nPRINT 1\r\n", "ascii");
    const printCmd = Buffer.concat([header, bitmap, footer]);

    // Gửi tới máy in
    console.log("🖨 Đang gửi lệnh in...");

    return new Promise((resolve, reject) => {
      const client = new net.Socket();
      client.setTimeout(10000);

      client.connect(printerPort, printerIP, () => {
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
    console.error("❌ Lỗi printData:", err.message);
    throw err;
  }
}

module.exports = { printData };
