function svg(fill, glyph) {
    const body = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
        `<rect width="64" height="64" rx="12" fill="${fill}"/>` +
        `<text x="32" y="43" font-family="sans-serif" font-size="30" font-weight="700" text-anchor="middle" fill="#fff">${glyph}</text>` +
        `</svg>`;
    return [{ src: `data:image/svg+xml;base64,${Buffer.from(body).toString('base64')}`, mimeType: 'image/svg+xml', sizes: ['any'] }];
}
export const SCIX_ICONS = svg('#1f4e79', 'Sx');
export const ARXIV_ICONS = svg('#b31b1b', 'aX');
