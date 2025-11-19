const { createCanvas } = require("canvas");
const fs = require("fs");
const htmlToText = require("html-to-text");

module.exports = async function renderHTML(html, width, outputFile) {
  const text = htmlToText.convert(html, {
    wordwrap: 120,
    preserveNewlines: true,
  });

  const fontSize = 24;
  const canvas = createCanvas(width, 2000);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, width, 2000);

  ctx.fillStyle = "#000000";
  ctx.font = `${fontSize}px Arial`;

  const lines = text.split("\n");
  let y = 40;
  for (const line of lines) {
    ctx.fillText(line, 20, y);
    y += fontSize + 6;
  }

  const buf = canvas.toBuffer("image/png");
  fs.writeFileSync(outputFile, buf);
};
