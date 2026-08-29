// Compress the document into a shareable ?data= link, and read it back.
export async function compressText(text) {
  if (typeof CompressionStream === "undefined") {
    return "b64." + btoa(unescape(encodeURIComponent(text)));
  }
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  const buf = await new Response(stream).arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function decompressText(data) {
  if (data.startsWith("b64.")) {
    return decodeURIComponent(escape(atob(data.slice(4))));
  }
  const binary = atob(data.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return await new Response(stream).text();
}

export async function shareLink(text) {
  return location.origin + location.pathname + "?data=" + await compressText(text);
}

// Returns the shared text, or null when the URL carries no data.
export async function readShared() {
  const data = new URLSearchParams(location.search).get("data");
  if (!data) return null;
  try {
    return await decompressText(data);
  } catch (e) {
    console.error("Failed to decode ?data=", e);
    return null;
  }
}
