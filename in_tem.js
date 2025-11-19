const net = require("net");
const axios = require("axios");
const htmlToText = require("html-to-text");

// ==============================
// CONFIG
// ==============================
const API_URL = "https://dinhdungit.click/BackEndZaloFnB/api/in/in.php";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ==============================
// ESC/POS COMMANDS
// ==============================
const ESC = 0x1b;
const GS = 0x1d;

const COMMANDS = {
  INIT: Buffer.from([ESC, 0x40]),
  ALIGN_LEFT: Buffer.from([ESC, 0x61, 0x00]),
  ALIGN_CENTER: Buffer.from([ESC, 0x61, 0x01]),
  ALIGN_RIGHT: Buffer.from([ESC, 0x61, 0x02]),
  BOLD_ON: Buffer.from([ESC, 0x45, 0x01]),
  BOLD_OFF: Buffer.from([ESC, 0x45, 0x00]),
  SIZE_NORMAL: Buffer.from([GS, 0x21, 0x00]),
  SIZE_DOUBLE: Buffer.from([GS, 0x21, 0x11]),
  LINE_FEED: Buffer.from([0x0a]),
  CUT_PAPER: Buffer.from([GS, 0x56, 0x00]),
};

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
    console.log(`🗑 Xóa job #${id}`);
  } catch (e) {
    console.log("Lỗi xóa job:", e.message);
  }
}

// ==============================
// LẤY IP & PORT TỪ DATABASE
// ==============================
async function loadPrinterConfig() {
  try {
    const res = await axios.post(API_URL, { action: "get_printer" });
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
// BỎ DẤU TIẾNG VIỆT
// ==============================
function removeDiacritics(str) {
  const map = {
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
    đ: "d",
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
  };

  return str.replace(/[^A-Za-z0-9 ]/g, (c) => map[c] || c);
}

// ==============================
// FORMAT HÓA ĐƠN
// ==============================
function formatBillText(html) {
  let text = htmlToText.convert(html, {
    wordwrap: false,
    preserveNewlines: true,
  });

  text = removeDiacritics(text);

  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const result = [];
  const MAX = 48;

  for (let line of lines) {
    if (line.match(/^HOA DON BAN HANG/i)) {
      result.push("CENTER:BOLD:" + line);
      continue;
    }

    if (line.match(/^#\w+/)) {
      result.push("CENTER:" + line);
      continue;
    }

    result.push(line);
  }
  return result;
}

// ==============================
// IN ESC/POS
// ==============================
async function printESCPOS(html, ip, port) {
  const lines = formatBillText(html);

  const buffers = [COMMANDS.INIT];

  for (let line of lines) {
    if (line.startsWith("CENTER:BOLD:")) {
      line = line.replace("CENTER:BOLD:", "");
      buffers.push(
        COMMANDS.ALIGN_CENTER,
        COMMANDS.SIZE_DOUBLE,
        COMMANDS.BOLD_ON,
        Buffer.from(line + "\n", "ascii"),
        COMMANDS.BOLD_OFF,
        COMMANDS.SIZE_NORMAL,
        COMMANDS.ALIGN_LEFT
      );
    } else if (line.startsWith("CENTER:")) {
      line = line.replace("CENTER:", "");
      buffers.push(
        COMMANDS.ALIGN_CENTER,
        Buffer.from(line + "\n", "ascii"),
        COMMANDS.ALIGN_LEFT
      );
    } else {
      buffers.push(Buffer.from(line + "\n", "ascii"));
    }
  }

  buffers.push(COMMANDS.LINE_FEED, COMMANDS.LINE_FEED, COMMANDS.CUT_PAPER);

  const data = Buffer.concat(buffers);

  console.log(`🖨 In đến ${ip}:${port}...`);

  return new Promise((resolve, reject) => {
    const client = new net.Socket();

    client.connect(port, ip, () => {
      client.write(data, () => {
        client.end();
        console.log("✔ In thành công!");
        resolve();
      });
    });

    client.on("error", (err) => {
      console.log("❌ Lỗi máy in:", err.message);
      reject(err);
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

  const { ip, port } = await loadPrinterConfig();
  console.log("🖨 Cấu hình máy in:", ip, port);

  for (const job of queue) {
    console.log(`➡ In job #${job.id}`);
    try {
      await printESCPOS(job.html, ip, port);
      await deletePrinted(job.id);
      await sleep(300);
    } catch (e) {
      console.log("❌ Lỗi job:", e.message);
    }
  }
}

// ==============================
// START SERVICE
// ==============================
(async () => {
  worker();
  setInterval(worker, 2000);
})();
