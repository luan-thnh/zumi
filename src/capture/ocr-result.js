// SPDX-License-Identifier: GPL-3.0-or-later

/** Convert Tesseract TSV words into text lines and OCR-space rectangles. */
export function parseOcrTsv(tsv) {
    const words = [];
    const lines = [];
    let lineKey = null;
    let line = [];
    let imageWidth = 0;
    let imageHeight = 0;

    for (const row of String(tsv).split(/\r?\n/).slice(1)) {
        if (!row) continue;
        const columns = row.split('\t');
        if (columns.length < 12) continue;
        const [level, page, block, paragraph, lineNo, , x, y, width, height, confidence] = columns;
        const rect = [x, y, width, height].map(Number);
        if (Number(level) === 1) {
            imageWidth = rect[2];
            imageHeight = rect[3];
        }
        if (Number(level) !== 5 || !Number.isFinite(Number(confidence)) || Number(confidence) < 0)
            continue;
        if (!rect.every(Number.isFinite) || rect[2] <= 0 || rect[3] <= 0)
            continue;
        const text = columns.slice(11).join('\t').trim();
        if (!text) continue;
        const key = `${page}/${block}/${paragraph}/${lineNo}`;
        if (key !== lineKey) {
            if (line.length) lines.push(line.join(' '));
            line = [];
            lineKey = key;
        }
        line.push(text);
        words.push({text, x: rect[0], y: rect[1], width: rect[2], height: rect[3]});
    }
    if (line.length) lines.push(line.join(' '));
    return {text: lines.join('\n'), words, imageWidth, imageHeight};
}

/** Tesseract coordinates are physical image pixels; GNOME stage uses logical pixels. */
export function stageOcrRects(result, rect) {
    if (!result.imageWidth || !result.imageHeight) return [];
    const sx = rect.width / result.imageWidth;
    const sy = rect.height / result.imageHeight;
    return result.words.map(word => ({
        x: rect.x + word.x * sx,
        y: rect.y + word.y * sy,
        width: word.width * sx,
        height: word.height * sy,
    })).filter(word => Number.isFinite(word.x + word.y + word.width + word.height) &&
        word.width > 0 && word.height > 0);
}
