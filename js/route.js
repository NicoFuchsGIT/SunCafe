// ---------- Routenlinks zu Fuß (ohne DOM) ----------
export const isApple = (ua = '', platform = '', touchPoints = 0) =>
    /iPhone|iPad|iPod/.test(ua) || (platform === 'MacIntel' && touchPoints > 1); // iPadOS meldet sich als Mac

export const googleUrl = (lat, lng) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`;
export const appleUrl = (lat, lng) => `https://maps.apple.com/?daddr=${lat},${lng}&dirflg=w`;
