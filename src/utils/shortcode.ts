const ALPHA =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function mediaIdToCode(mediaId: bigint): string {
  let id = mediaId;
  let out = '';
  while (id > 0n) {
    out = ALPHA[Number(id & 63n)] + out;
    id >>= 6n;
  }
  return out;
}
