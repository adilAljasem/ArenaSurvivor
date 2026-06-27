import pako from 'pako';

self.onmessage = (e) => {
  const compressedBase64 = e.data;
  const binaryString = atob(compressedBase64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const decompressedBytes = pako.ungzip(bytes);
  const jsonString = new TextDecoder().decode(decompressedBytes);
  const rawState = JSON.parse(jsonString);

  // THIS LINE IS THE FIX: We must wrap it in an object so main.ts can destructure it!
  self.postMessage({ 
      rawState: rawState, 
      compressedSize: compressedBase64.length + 50, 
      uncompressedSize: new TextEncoder().encode(jsonString).length + 50 
  });
};