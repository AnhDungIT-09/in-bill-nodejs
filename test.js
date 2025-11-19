const net = require("net");
const axios = require("axios");
const htmlToText = require("html-to-text");
const iconv = require("iconv-lite");

// ==============================
// CONFIG
// ==============================
const API_URL = "https://dinhdungit.click/BackEndZaloFnB/api/in/in.php";
const API_URL_SETTING =
  "https://dinhdungit.click/BackEndZaloFnB/api/in/setting.php";
// const PRINTER_IP = "192.168.1.250";
// const PRINTER_PORT = 9100;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ==============================
// ESC/POS COMMANDS
// ==============================
const ESC = 0x1b;
const GS = 0x1d;

const COMMANDS = {
  INIT: Buffer.from([ESC, 0x40]), // Khởi tạo máy in
  ALIGN_LEFT: Buffer.from([ESC, 0x61, 0x00]),
  ALIGN_CENTER: Buffer.from([ESC, 0x61, 0x01]),
  ALIGN_RIGHT: Buffer.from([ESC, 0x61, 0x02]),
  BOLD_ON: Buffer.from([ESC, 0x45, 0x01]),
  BOLD_OFF: Buffer.from([ESC, 0x45, 0x00]),
  SIZE_NORMAL: Buffer.from([GS, 0x21, 0x00]),
  SIZE_DOUBLE: Buffer.from([GS, 0x21, 0x11]), // 2x chiều rộng và cao
  SIZE_LARGE: Buffer.from([GS, 0x21, 0x22]), // 3x
  LINE_FEED: Buffer.from([0x0a]), // Xuống dòng
  CUT_PAPER: Buffer.from([GS, 0x56, 0x00]), // Cắt giấy
};

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
    console.log("Lỗi load máy in:", e.message);
  }

  return { ip: "192.168.1.250", port: 9100 };
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
// FORMAT TEXT - Căn chỉnh giá bên phải
// ==============================
function formatBillText(html) {
  const text = htmlToText.convert(html, {
    wordwrap: false, // Không wrap tự động
    preserveNewlines: true,
  });

  let textNoDiacritics = removeDiacritics(text);

  // Loại bỏ khoảng trắng thừa
  textNoDiacritics = textNoDiacritics
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n");

  const lines = textNoDiacritics.split("\n");
  const result = [];
  const MAX_WIDTH = 48; // 48 ký tự cho giấy 80mm

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const nextLine = lines[i + 1] ? lines[i + 1].trim() : "";

    // Nhận diện tên món + giá
    if (nextLine.match(/^\d+x[\d.,]+d\s*=\s*[\d.,]+d$/)) {
      const itemName = line.substring(0, 30); // Tối đa 30 ký tự cho tên
      const price = nextLine;

      // Căn giá bên phải
      const padding = MAX_WIDTH - itemName.length - price.length;
      const spaces = padding > 1 ? " ".repeat(padding) : " ";

      result.push(itemName + spaces + price);
      i++; // Bỏ qua dòng giá
    }
    // Format giá 2 dòng: "1x50.000d" và "= 50.000d"
    else if (nextLine.match(/^\d+x[\d.,]+d$/)) {
      const nextNextLine = lines[i + 2] ? lines[i + 2].trim() : "";

      if (nextNextLine.match(/^=\s*[\d.,]+d$/)) {
        const itemName = line.substring(0, 30);
        const combinedPrice = nextLine + " " + nextNextLine;

        const padding = MAX_WIDTH - itemName.length - combinedPrice.length;
        const spaces = padding > 1 ? " ".repeat(padding) : " ";

        result.push(itemName + spaces + combinedPrice);
        i += 2;
      } else {
        const itemName = line.substring(0, 30);
        const price = nextLine;

        const padding = MAX_WIDTH - itemName.length - price.length;
        const spaces = padding > 1 ? " ".repeat(padding) : " ";

        result.push(itemName + spaces + price);
        i++;
      }
    }
    // TONG CONG - căn giữa
    else if (line.match(/^TONG CONG$/i)) {
      result.push("");
      result.push("CENTER:" + line); // Đánh dấu để căn giữa
      if (nextLine.match(/^[\d.,]+d$/)) {
        result.push("CENTER:" + nextLine);
        i++;
      }
    }
    // Header - căn giữa
    else if (line.match(/^HOA DON BAN HANG$/i)) {
      result.push("CENTER:BOLD:" + line);
    }
    // Mã đơn - căn giữa
    else if (line.match(/^#\w+$/)) {
      result.push("CENTER:" + line);
    }
    // Các dòng khác
    else {
      result.push(line);
    }
  }

  return result;
}

// ==============================
// IN ESC/POS
// ==============================
async function printESCPOS(html, ip, port) {
  const lines = formatBillText(html);

  const buffers = [COMMANDS.INIT];

  for (const line of lines) {
    // Bỏ qua dòng trống hoàn toàn
    if (!line || line.trim() === "") {
      continue; // Không xuống dòng thừa
    }

    // Xử lý format đặc biệt
    if (line.startsWith("CENTER:BOLD:")) {
      const text = line.replace("CENTER:BOLD:", "");
      buffers.push(
        COMMANDS.ALIGN_CENTER,
        COMMANDS.SIZE_DOUBLE,
        COMMANDS.BOLD_ON,
        Buffer.from(text + "\n", "ascii"),
        COMMANDS.BOLD_OFF,
        COMMANDS.SIZE_NORMAL,
        COMMANDS.ALIGN_LEFT
      );
    } else if (line.startsWith("CENTER:")) {
      const text = line.replace("CENTER:", "");
      buffers.push(
        COMMANDS.ALIGN_CENTER,
        Buffer.from(text + "\n", "ascii"),
        COMMANDS.ALIGN_LEFT
      );
    } else {
      buffers.push(Buffer.from(line + "\n", "ascii"));
    }
  }

  // Chỉ xuống 2 dòng trước khi cắt giấy
  // buffers.push(COMMANDS.LINE_FEED, COMMANDS.LINE_FEED, COMMANDS.CUT_PAPER);
  // Xuống nhiều dòng hơn để tránh cắt mất nội dung
  buffers.push(
    COMMANDS.LINE_FEED,
    COMMANDS.LINE_FEED,
    COMMANDS.LINE_FEED,
    COMMANDS.LINE_FEED,
    COMMANDS.LINE_FEED,
    COMMANDS.CUT_PAPER
  );
  const printData = Buffer.concat(buffers);

  console.log("🖨 Đang gửi lệnh ESC/POS...");

  return new Promise((resolve, reject) => {
    const client = new net.Socket();

    client.connect(port, ip, () => {
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
  const { ip, port } = await loadPrinterConfig();

  for (const job of queue) {
    console.log(`➡ Xử lý job #${job.id}`);

    try {
      await printESCPOS(job.html, ip, port);

      // Xóa job sau khi in thành công
      await deletePrinted(job.id);
      await sleep(200);
    } catch (err) {
      console.log("❌ Lỗi in job:", err.message);
    }
  }
}

// ==============================
// START
// ==============================
(async () => {
  worker();
  setInterval(worker, 2000);
})();
