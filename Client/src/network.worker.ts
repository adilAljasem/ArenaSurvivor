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

    self.postMessage(rawState);
};