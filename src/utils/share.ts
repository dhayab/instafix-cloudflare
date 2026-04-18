export async function getSharePostID(input: string): Promise<string> {
  const res = await fetch(
    `https://www.instagram.com/share/reel/${encodeURIComponent(input)}/`,
    { method: 'HEAD', redirect: 'manual' },
  );
  const loc = res.headers.get('Location');
  if (!loc) throw new Error('share: no Location header');
  const pathname = new URL(loc, 'https://www.instagram.com').pathname;
  const id = pathname.split('/').filter(Boolean).pop();
  if (!id) throw new Error('share: empty path');
  if (id === 'login') throw new Error('share: redirected to login');
  return id;
}
