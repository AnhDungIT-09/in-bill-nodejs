const { createCanvas } = require("canvas");

const CANVAS_WIDTH = 576;
const PADDING = 12;
const LINE_HEIGHT = 22;

/**
 * Render hóa đơn bán hàng (ORDER)
 */
async function renderInvoiceCanvas(data) {
  console.log("🎨 Render hóa đơn bán hàng...");

  let y = PADDING;
  const tempCanvas = createCanvas(CANVAS_WIDTH, 2000);
  const ctx = tempCanvas.getContext("2d");

  // Hàm vẽ text có xuống dòng tự động
  function drawText(text, x, yPos, fontSize, align = "left", bold = false) {
    ctx.font = `${bold ? "bold" : "normal"} ${fontSize}px Arial`;
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = align;

    const maxWidth = CANVAS_WIDTH - PADDING * 2;
    const words = String(text).split(" ");
    let line = "";
    let currentY = yPos;

    for (let word of words) {
      const testLine = line + word + " ";
      const metrics = ctx.measureText(testLine);

      if (metrics.width > maxWidth && line !== "") {
        ctx.fillText(line.trim(), x, currentY);
        line = word + " ";
        currentY += LINE_HEIGHT;
      } else {
        line = testLine;
      }
    }
    ctx.fillText(line.trim(), x, currentY);
    return currentY + LINE_HEIGHT;
  }

  // Hàm vẽ đường kẻ ngang
  function drawLine(yPos) {
    ctx.strokeStyle = "#666666";
    ctx.setLineDash([5, 3]);
    ctx.beginPath();
    ctx.moveTo(PADDING, yPos);
    ctx.lineTo(CANVAS_WIDTH - PADDING, yPos);
    ctx.stroke();
    ctx.setLineDash([]);
    return yPos + 10;
  }

  // Background đen
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, CANVAS_WIDTH, 2000);

  // HEADER
  y = drawText(
    "HÓA ĐƠN BÁN HÀNG",
    CANVAS_WIDTH / 2,
    y + 10,
    26,
    "center",
    true
  );
  y = drawText(
    `#${data.id || "N/A"}`,
    CANVAS_WIDTH / 2,
    y,
    20,
    "center",
    false
  );
  y = drawLine(y + 5);

  // THÔNG TIN ĐƠN HÀNG
  y = drawText(
    `Chi nhánh: ${data.branch || "N/A"}`,
    PADDING,
    y,
    18,
    "left",
    false
  );
  y = drawText(
    `Ngày: ${data.delivery_time || "N/A"}`,
    PADDING,
    y,
    18,
    "left",
    false
  );
  y = drawText(
    `Trạng thái: ${data.status || "N/A"}`,
    PADDING,
    y,
    18,
    "left",
    false
  );
  y = drawLine(y + 5);

  // THÔNG TIN KHÁCH HÀNG
  y = drawText("THÔNG TIN KHÁCH HÀNG", PADDING, y, 18, "left", true);
  y = drawText(
    `Tên: ${data.customer_name || "N/A"}`,
    PADDING,
    y,
    18,
    "left",
    false
  );
  y = drawText(
    `SĐT: ${data.customer_sdt || "N/A"}`,
    PADDING,
    y,
    18,
    "left",
    false
  );
  y = drawText(
    `Địa chỉ: ${data.address || "N/A"}`,
    PADDING,
    y,
    18,
    "left",
    false
  );
  y = drawLine(y + 5);

  // CHI TIẾT ĐƠN HÀNG
  y = drawText("CHI TIẾT ĐƠN HÀNG", PADDING, y, 18, "left", true);

  const items = Array.isArray(data.items) ? data.items : [];

  if (items.length === 0) {
    y = drawText("(Không có sản phẩm)", PADDING, y, 16, "left", false);
  } else {
    for (let item of items) {
      // Tính chiều rộng tối đa cho tên món (trừ đi chỗ cho giá bên phải)
      const priceWidth = 100; // Khoảng 200px cho giá
      const maxWidthForName = CANVAS_WIDTH - PADDING * 2 - priceWidth;

      ctx.font = "normal 18px Arial";
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "left";

      const words = String(item.name).split(" ");
      let line = "";
      let lines = [];

      // Tách tên món thành nhiều dòng
      for (let word of words) {
        const testLine = line + word + " ";
        const metrics = ctx.measureText(testLine);

        if (metrics.width > maxWidthForName && line !== "") {
          lines.push(line.trim());
          line = word + " ";
        } else {
          line = testLine;
        }
      }
      lines.push(line.trim());

      // Vẽ từng dòng của tên món
      for (let i = 0; i < lines.length; i++) {
        ctx.font = "normal 18px Arial";
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "left";
        ctx.fillText(lines[i], PADDING, y);

        // Chỉ vẽ giá ở dòng đầu tiên
        if (i === 0) {
          const itemTotal = item.quantity * item.price;
          const priceText = `${item.quantity}x${item.price.toLocaleString(
            "vi-VN"
          )}đ = ${itemTotal.toLocaleString("vi-VN")}đ`;

          ctx.font = "normal 16px Arial";
          ctx.textAlign = "right";
          ctx.fillText(priceText, CANVAS_WIDTH - PADDING, y);
        }

        y += LINE_HEIGHT; // Xuống dòng sau mỗi dòng text
      }

      y += 5; // Khoảng cách giữa các item
    }
  }

  y = drawLine(y + 5);

  // TỔNG CỘNG
  y = drawText("TỔNG CỘNG", CANVAS_WIDTH / 2, y, 20, "center", true);
  const totalAmount = Number(data.total) || 0;
  y = drawText(
    `${totalAmount.toLocaleString("vi-VN")}đ`,
    CANVAS_WIDTH / 2,
    y,
    28,
    "center",
    true
  );
  y += 15;

  ctx.strokeStyle = "#666666";
  ctx.beginPath();
  ctx.moveTo(PADDING, y);
  ctx.lineTo(CANVAS_WIDTH - PADDING, y);
  ctx.stroke();
  y += 10;

  // FOOTER
  y = drawText("Nhân viên: _________________", PADDING, y, 16, "left", false);
  y = drawText("Khách hàng: _________________", PADDING, y, 16, "left", false);
  y = drawText(
    "Cảm ơn quý khách!",
    CANVAS_WIDTH / 2,
    y + 10,
    16,
    "center",
    false
  );

  y += 20;

  // Tạo canvas chính xác với chiều cao đúng
  const finalCanvas = createCanvas(CANVAS_WIDTH, y);
  const finalCtx = finalCanvas.getContext("2d");
  finalCtx.drawImage(tempCanvas, 0, 0);

  return finalCanvas.toBuffer("image/png");
}

module.exports = { renderInvoiceCanvas };
