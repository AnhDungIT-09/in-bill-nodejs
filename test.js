const axios = require("axios");
const escpos = require("escpos");
escpos.Network = require("escpos-network");
const Jimp = require("jimp");

const API_URL = "https://dinhdungit.click/BackEndZaloFnB/api/in/in.php";
const API_URL_SETTING =
  "https://dinhdungit.click/BackEndZaloFnB/api/in/setting.php";
const RENDER_URL = "https://dinhdungit.click/BackEndZaloFnB/renderNodejs";

const PRINTER_WIDTH = 576;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ============================================================
   LOAD PRINTER CONFIG
============================================================ */
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
    console.log("❌ Lỗi load máy in:", e.message);
  }
  return { ip: "192.168.1.250", port: 9100 };
}

/* ============================================================
   GET NEXT JOB (LOCKED)
============================================================ */
async function getNextJob() {
  try {
    const res = await axios.post(API_URL, { action: "get_next_job" });
    return res.data.data || null;
  } catch {
    return null;
  }
}

/* ============================================================
   UPDATE STATUS
============================================================ */
async function updateStatus(id, status) {
  try {
    await axios.post(API_URL, { action: "set_status", id, status });
    console.log(`⚙️ Job #${id} → ${status}`);
  } catch (e) {
    console.log(`❌ Lỗi update status job #${id}:`, e.message);
  }
}

/* ============================================================
   RENDER HTML TO PNG
============================================================ */
async function renderHTMLtoPNG(html) {
  try {
    const res = await axios.post(
      RENDER_URL,
      { html, width: PRINTER_WIDTH },
      { responseType: "arraybuffer", timeout: 30000 }
    );

    if (!res.data || res.data.byteLength === 0) return null;
    return Buffer.from(res.data);
  } catch (e) {
    console.log("❌ Render HTML lỗi:", e.message);
    return null;
  }
}

/* ============================================================
   PREPARE RASTER USING JIMP
============================================================ */
async function prepareRasterData(pngBuffer) {
  const image = await Jimp.read(pngBuffer);

  image.resize(PRINTER_WIDTH, Jimp.AUTO).greyscale();

  const width = image.bitmap.width;
  const height = image.bitmap.height;

  const bytesPerRow = Math.ceil(width / 8);
  const raster = Buffer.alloc(bytesPerRow * height);
  raster.fill(0);

  image.scan(0, 0, width, height, function (x, y, idx) {
    const red = this.bitmap.data[idx];
    if (red < 170) {
      raster[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
    }
  });

  return { raster, width, height, bytesPerRow };
}

/* ============================================================
   PRINT RAW
============================================================ */
async function printRaw(ip, port, rasterData) {
  return new Promise((resolve, reject) => {
    const { raster, height, bytesPerRow } = rasterData;

    const device = new escpos.Network(ip, port);
    const printer = new escpos.Printer(device);

    device.open((err) => {
      if (err) return reject(err);

      try {
        const header = Buffer.from([
          0x1d,
          0x76,
          0x30,
          0x00,
          bytesPerRow & 0xff,
          (bytesPerRow >> 8) & 0xff,
          height & 0xff,
          (height >> 8) & 0xff,
        ]);

        printer.align("ct");
        printer.raw(Buffer.concat([header, raster]));
        printer.newLine();
        printer.newLine();
        printer.cut();

        setTimeout(() => {
          printer.close();
          resolve(true);
        }, 800);
      } catch (e) {
        printer.close();
        reject(e);
      }
    });
  });
}

/* ============================================================
   WORKER
============================================================ */

let isRunning = false;

async function worker() {
  if (isRunning) return;
  isRunning = true;

  const job = await getNextJob();
  if (!job) {
    isRunning = false;
    return;
  }

  console.log(`➡ Job #${job.id}: Bắt đầu`);

  const { ip, port } = await loadPrinterConfig();

  try {
    const pngBuffer = await renderHTMLtoPNG(job.html);
    if (!pngBuffer) throw new Error("Render thất bại");

    const rasterData = await prepareRasterData(pngBuffer);

    await printRaw(ip, port, rasterData);

    await updateStatus(job.id, "done");
    console.log(`✅ Job #${job.id}: Hoàn thành`);
  } catch (e) {
    console.log(`❌ Job #${job.id} thất bại:`, e.message);
    await updateStatus(job.id, "pending");
  }

  isRunning = false;
}

/* ============================================================
   START
============================================================ */
(async () => {
  console.log("🚀 Worker (Jimp Version) đang chạy trên Android...");
  worker();
  setInterval(worker, 1000);
})();
