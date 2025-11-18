const axios = require("axios");
const { printData } = require("./print");

const API_URL = "https://dinhdungit.click/BackEndZaloFnB/api/in/in.php";
const PRINTER_IP = "192.168.1.110";
const PRINTER_PORT = 9100;

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
    await axios.post(API_URL, { action: "delete", id });
  } catch (err) {
    console.error("❌ Lỗi API deletePrinted:", err.message);
  }
}

async function setStatus(id, status) {
  try {
    await axios.post(API_URL, { action: "set_status", id, status });
  } catch (err) {
    console.error("❌ Lỗi API setStatus:", err.message);
  }
}

// ==========================
//  WORKER CHÍNH
// ==========================
async function worker() {
  try {
    const queue = await getPrintQueue();

    if (!queue.length) {
      return;
    }

    console.log(`📦 Có ${queue.length} job mới`);

    for (const item of queue) {
      console.log(`\n🔒 Đang xử lý job #${item.id}`);
      await setStatus(item.id, "printing");

      try {
        let data;

        console.log(`📋 Item #${item.id}:`, item.type);

        // Parse JSON string từ field "data"
        if (typeof item.data === "string") {
          try {
            data = JSON.parse(item.data);
            console.log("✅ Parse JSON thành công");
          } catch (e) {
            console.error("❌ Lỗi parse JSON:", e.message);
            console.log("Data content:", item.data.substring(0, 200));
            throw new Error("Không parse được JSON từ field data");
          }
        } else if (typeof item.data === "object") {
          data = item.data;
        } else {
          throw new Error("Field data không tồn tại hoặc sai format");
        }

        // Thêm type từ item vào data
        data.type = item.type || "order"; // Mặc định là order

        // Parse items nếu là string
        if (typeof data.items === "string") {
          try {
            data.items = JSON.parse(data.items);
          } catch (e) {
            console.warn("⚠️ Không parse được data.items, set mặc định = []");
            data.items = [];
          }
        }

        // Đảm bảo items là mảng
        if (!Array.isArray(data.items)) {
          console.warn("⚠️ data.items không phải mảng, set mặc định = []");
          data.items = [];
        }

        console.log(
          `📦 ${data.type === "request" ? "Phiếu xuất kho" : "Đơn hàng"} #${
            data.id
          }: ${data.items.length} ${
            data.type === "request" ? "vật tư" : "sản phẩm"
          }`
        );

        // Gọi hàm in từ print.js
        await printData(data, PRINTER_IP, PRINTER_PORT);

        console.log(`🗑 Xóa job #${item.id}`);
        await deletePrinted(item.id);
      } catch (err) {
        console.error(`❌ Lỗi in job #${item.id}:`, err.message);
        console.log("⚠️ Trả job về trạng thái pending");
        await setStatus(item.id, "pending");
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
console.log(`🖨 Printer: ${PRINTER_IP}:${PRINTER_PORT}\n`);

setInterval(worker, 1000);
worker();
