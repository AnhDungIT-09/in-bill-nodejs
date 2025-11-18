const { createCanvas } = require("canvas");

const CANVAS_WIDTH = 576;
const PADDING = 12;
const LINE_HEIGHT = 22;

/**
 * Render phiếu xuất kho (REQUEST)
 */
async function renderRequestCanvas(data) {
  console.log("🎨 Render phiếu xuất kho...");

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
  y = drawText("PHIẾU XUẤT KHO", CANVAS_WIDTH / 2, y + 10, 26, "center", true);
  y = drawText(
    `#${data.id || "N/A"}`,
    CANVAS_WIDTH / 2,
    y,
    20,
    "center",
    false
  );
  y = drawLine(y + 5);

  // THÔNG TIN PHIẾU
  y = drawText(
    `Chi nhánh: ${data.branch || "N/A"}`,
    PADDING,
    y,
    18,
    "left",
    false
  );
  y = drawText(
    `Ngày: ${data.created_at || "N/A"}`,
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

  // DANH SÁCH VẬT TƯ
  y = drawText("DANH SÁCH VẬT TƯ", PADDING, y, 18, "left", true);

  const items = Array.isArray(data.items) ? data.items : [];

  if (items.length === 0) {
    y = drawText("(Không có vật tư)", PADDING, y, 16, "left", false);
  } else {
    for (let item of items) {
      const maxWidthForName = CANVAS_WIDTH - 150; // Để chỗ cho số lượng
      ctx.font = "normal 18px Arial";
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "left";

      const words = String(item.name).split(" ");
      let line = "";
      let lines = [];

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

      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], PADDING, y);

        // Hiển thị số lượng ở dòng đầu tiên
        if (i === 0) {
          const qtyText = `${item.quantity} ${item.unit || ""}`;
          ctx.font = "500 16px Arial";
          ctx.textAlign = "right";
          ctx.fillText(qtyText, CANVAS_WIDTH - PADDING, y);
        }

        y += LINE_HEIGHT;
      }

      y += 3;
    }
  }

  y = drawLine(y + 5);

  // FOOTER
  y += 5;
  y = drawText("Người lập: _____________", PADDING, y, 16, "left", false);
  y = drawText("Người giao: ____________", PADDING, y, 16, "left", false);
  y = drawText("Người nhận: ____________", PADDING, y, 16, "left", false);

  y += 20;

  // Tạo canvas chính xác với chiều cao đúng
  const finalCanvas = createCanvas(CANVAS_WIDTH, y);
  const finalCtx = finalCanvas.getContext("2d");
  finalCtx.drawImage(tempCanvas, 0, 0);

  return finalCanvas.toBuffer("image/png");
}

module.exports = { renderRequestCanvas };
