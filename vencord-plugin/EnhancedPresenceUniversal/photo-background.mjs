export async function prepareBackgroundPhoto(file) {
  if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size <= 0 || file.size > 4000000) {
    throw Error('Choose a PNG, JPEG or WebP image smaller than 4 MB.');
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 16000000) throw Error('Choose an image smaller than 16 megapixels.');
    const scale = Math.min(1, 1280 / image.naturalWidth, 960 / image.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw Error('Image processing is unavailable.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL('image/webp', 0.78);
    if (!data.startsWith('data:image/webp;base64,') || data.length > 650000) throw Error('This photo is too detailed. Choose a smaller image.');
    return { kind: 'photo', data };
  } finally { URL.revokeObjectURL(url); }
}
